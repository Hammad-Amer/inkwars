"""Export the trained checkpoint to ONNX and install it into the client.

Writes:
    client/public/model/quickdraw.onnx
    client/public/model/manifest.json   (class order, tiers, val accuracy)

Verifies the ONNX model against PyTorch on random inputs before installing.

Usage:
    python export_onnx.py
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

# torch's exporter prints emoji; Windows consoles default to cp1252 and crash
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

import numpy as np
import onnxruntime
import torch

from model import QuickDrawCNN

SCRIPT_DIR = Path(__file__).resolve().parent
CHECKPOINT = SCRIPT_DIR / "checkpoints" / "best.pt"
CLIENT_MODEL_DIR = SCRIPT_DIR.parent / "client" / "public" / "model"
OPSET = 17


def main() -> None:
    if not CHECKPOINT.exists():
        raise SystemExit(f"{CHECKPOINT} not found — run train.py first")

    ckpt = torch.load(CHECKPOINT, map_location="cpu", weights_only=True)
    categories: list[str] = ckpt["categories"]
    model = QuickDrawCNN(len(categories))
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    CLIENT_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    onnx_path = CLIENT_MODEL_DIR / "quickdraw.onnx"
    example = torch.zeros(1, 1, 28, 28)
    torch.onnx.export(
        model,
        (example,),
        str(onnx_path),
        input_names=["drawing"],
        output_names=["logits"],
        dynamic_axes={"drawing": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=OPSET,
        # keep weights inside the .onnx file — ORT-web can't auto-fetch
        # a sibling .onnx.data file in the browser
        external_data=False,
    )

    # sanity check: ONNX Runtime must agree with PyTorch
    session = onnxruntime.InferenceSession(str(onnx_path))
    rng = np.random.default_rng(0)
    x = rng.random((4, 1, 28, 28), dtype=np.float32)
    with torch.no_grad():
        expected = model(torch.from_numpy(x)).numpy()
    actual = session.run(["logits"], {"drawing": x})[0]
    max_diff = float(np.abs(expected - actual).max())
    if max_diff > 1e-3:
        raise SystemExit(f"ONNX output mismatch (max diff {max_diff}) — export is broken")

    # tier lookup comes from categories.json; the checkpoint stores only names
    with open(SCRIPT_DIR / "categories.json", encoding="utf-8") as f:
        tiers = {c["name"]: c["tier"] for c in json.load(f)["categories"]}
    manifest = {
        "modelFile": "quickdraw.onnx",
        "inputSize": 28,
        "categories": [{"name": n, "tier": tiers.get(n, "medium")} for n in categories],
        "valTop1": ckpt.get("val_top1"),
        "valTop5": ckpt.get("val_top5"),
        "exportedAt": date.today().isoformat(),
    }
    with open(CLIENT_MODEL_DIR / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    size_mb = onnx_path.stat().st_size / 1e6
    print(f"Exported {onnx_path} ({size_mb:.1f} MB), max diff vs PyTorch: {max_diff:.2e}")
    print(f"Manifest: {len(categories)} categories, val top-1 "
          f"{ckpt.get('val_top1', 0):.1%}, top-5 {ckpt.get('val_top5', 0):.1%}")
    print("Open the client's /model-test page to try it live.")


if __name__ == "__main__":
    main()
