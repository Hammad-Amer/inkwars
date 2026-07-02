"""Train the Quick Draw guesser CNN.

Expects training/data/<category>.npy files (run download_data.py first).
Saves the best checkpoint (by validation top-1) to training/checkpoints/best.pt.

Usage:
    python train.py --smoke     # 2 categories, 1 epoch, tiny sample — verifies the setup
    python train.py             # full run (~10-20 min on an RTX 4060)

The whole dataset (100 classes x 20k samples of 784 uint8) is ~1.6 GB and is
held in RAM as a single uint8 tensor; batches are normalized and augmented on
the GPU, so no DataLoader workers are needed (a win on Windows, where worker
processes would each copy the arrays).
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from model import QuickDrawCNN

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR / "data"
CHECKPOINT_DIR = SCRIPT_DIR / "checkpoints"
VAL_FRACTION = 0.1


def load_categories() -> list[str]:
    with open(SCRIPT_DIR / "categories.json", encoding="utf-8") as f:
        return [c["name"] for c in json.load(f)["categories"]]


def load_dataset(
    categories: list[str], samples_per_class: int
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """Returns (train_x, train_y, val_x, val_y); x is uint8 NxHxW, y is int64.

    The split is per-class so every category appears in validation at the
    same rate regardless of how many samples it has.
    """
    train_parts, val_parts = [], []
    for label, name in enumerate(categories):
        path = DATA_DIR / f"{name}.npy"
        if not path.exists():
            raise FileNotFoundError(f"{path} missing — run download_data.py first")
        arr = np.load(path)[:samples_per_class]
        n_val = max(1, int(len(arr) * VAL_FRACTION))
        x = torch.from_numpy(arr.reshape(-1, 28, 28).copy())
        y = torch.full((len(arr),), label, dtype=torch.int64)
        train_parts.append((x[n_val:], y[n_val:]))
        val_parts.append((x[:n_val], y[:n_val]))
        print(f"\r  loaded {label + 1}/{len(categories)}: {name} ({len(arr)} samples)", end="")
    print()
    train_x = torch.cat([p[0] for p in train_parts])
    train_y = torch.cat([p[1] for p in train_parts])
    val_x = torch.cat([p[0] for p in val_parts])
    val_y = torch.cat([p[1] for p in val_parts])
    return train_x, train_y, val_x, val_y


def augment(batch: torch.Tensor, generator: torch.Generator) -> torch.Tensor:
    """Small random translations (±2px) on the GPU.

    Browser drawings won't be perfectly centered the way the dataset is, so a
    little positional jitter makes the model tolerant of that. Kept minimal —
    Quick Draw has plenty of data, heavy augmentation just slows convergence.
    """
    shifts = torch.randint(-2, 3, (batch.shape[0], 2), generator=generator, device=batch.device)
    padded = torch.nn.functional.pad(batch, (2, 2, 2, 2))
    out = torch.empty_like(batch)
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            mask = (shifts[:, 0] == dy) & (shifts[:, 1] == dx)
            if mask.any():
                out[mask] = padded[mask, 2 + dy : 30 + dy, 2 + dx : 30 + dx]
    return out


@torch.no_grad()
def evaluate(
    model: nn.Module, val_x: torch.Tensor, val_y: torch.Tensor, device: torch.device, batch_size: int
) -> tuple[float, float]:
    model.eval()
    top1 = top5 = 0
    for i in range(0, len(val_x), batch_size):
        x = val_x[i : i + batch_size].to(device).float().div_(255).unsqueeze(1)
        y = val_y[i : i + batch_size].to(device)
        logits = model(x)
        top = logits.topk(min(5, logits.shape[1]), dim=1).indices
        top1 += (top[:, 0] == y).sum().item()
        top5 += (top == y[:, None]).any(dim=1).sum().item()
    return top1 / len(val_x), top5 / len(val_x)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--samples-per-class", type=int, default=20_000)
    parser.add_argument("--smoke", action="store_true",
                        help="2 categories, 1 epoch, 1000 samples/class — setup check")
    args = parser.parse_args()

    categories = load_categories()
    if args.smoke:
        categories = categories[:2]
        args.epochs, args.samples_per_class = 1, 1000

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}"
          + (f" ({torch.cuda.get_device_name(0)})" if device.type == "cuda" else " — WARNING: no CUDA, this will be slow"))

    print(f"Loading {len(categories)} categories (up to {args.samples_per_class}/class)")
    train_x, train_y, val_x, val_y = load_dataset(categories, args.samples_per_class)
    print(f"Train {len(train_x):,} / val {len(val_x):,} samples")

    model = QuickDrawCNN(len(categories)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    steps_per_epoch = (len(train_x) + args.batch_size - 1) // args.batch_size
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=args.lr, total_steps=args.epochs * steps_per_epoch
    )
    scaler = torch.amp.GradScaler(enabled=device.type == "cuda")
    loss_fn = nn.CrossEntropyLoss()
    gen = torch.Generator(device=device.type).manual_seed(0)

    CHECKPOINT_DIR.mkdir(exist_ok=True)
    best_top1 = 0.0

    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = torch.randperm(len(train_x))
        epoch_loss, t0 = 0.0, time.time()
        for step in range(steps_per_epoch):
            idx = perm[step * args.batch_size : (step + 1) * args.batch_size]
            x = train_x[idx].to(device, non_blocking=True)
            x = augment(x, gen).float().div_(255).unsqueeze(1)
            y = train_y[idx].to(device, non_blocking=True)

            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device.type, enabled=device.type == "cuda"):
                loss = loss_fn(model(x), y)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            scheduler.step()
            epoch_loss += loss.item()

        top1, top5 = evaluate(model, val_x, val_y, device, args.batch_size)
        marker = ""
        if top1 > best_top1:
            best_top1 = top1
            torch.save(
                {
                    "model_state": model.state_dict(),
                    "categories": categories,
                    "val_top1": top1,
                    "val_top5": top5,
                },
                CHECKPOINT_DIR / "best.pt",
            )
            marker = "  <- saved"
        print(
            f"epoch {epoch:2d}/{args.epochs}  loss {epoch_loss / steps_per_epoch:.4f}  "
            f"val top-1 {top1:.1%}  top-5 {top5:.1%}  ({time.time() - t0:.0f}s){marker}"
        )

    print(f"\nDone. Best val top-1: {best_top1:.1%}. Checkpoint: {CHECKPOINT_DIR / 'best.pt'}")
    print("Next: python export_onnx.py")


if __name__ == "__main__":
    main()
