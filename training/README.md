# Training the Quick Draw guesser

Everything runs locally on your RTX 4060. One-time setup, then three scripts in order.

## 1. Environment setup (once)

From the `training/` directory, in PowerShell. (A `venv/` with CPU-only torch may already
exist from pipeline verification — the CUDA install below simply replaces it.)

```powershell
python -m venv venv          # skip if venv/ already exists
.\venv\Scripts\Activate.ps1

# PyTorch with CUDA (~2.5 GB download). cu126 works with any recent NVIDIA driver.
pip install torch --index-url https://download.pytorch.org/whl/cu126 --force-reinstall

pip install -r requirements.txt
```

Verify the GPU is visible:

```powershell
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
# expected: True NVIDIA GeForce RTX 4060 ...
```

If it prints `False`, update your NVIDIA driver, then reinstall torch with the same command.

## 2. Download the dataset

```powershell
python download_data.py
```

Fetches the 100 curated categories (`categories.json`) as 28×28 bitmap archives from
Google's public bucket into `training/data/` (gitignored). The full files would be 11+ GB,
so the script uses HTTP Range requests to grab only the first 25k samples per category
(~2 GB total, ~20 MB per file). Safe to interrupt and re-run — finished files are skipped.

## 3. Train

Smoke test first (~1 minute, verifies CUDA + the whole pipeline):

```powershell
python download_data.py --limit 2   # if you haven't downloaded everything yet
python train.py --smoke
```

Then the real run:

```powershell
python train.py
```

Expect roughly 1–2 minutes per epoch on the 4060, 12 epochs by default. The best
checkpoint (by validation top-1 accuracy) is saved to `training/checkpoints/best.pt`.
A healthy full run lands around **~90% top-1 / ~98% top-5** validation accuracy.

## 4. Export to the browser

```powershell
python export_onnx.py
```

Converts the checkpoint to ONNX, verifies ONNX Runtime output matches PyTorch, and
installs `quickdraw.onnx` + `manifest.json` into `client/public/model/`. Then open the
client dev server's `/model-test` page and draw — the model guesses live.

The exported model (~6 MB) is committed to git so the client works without retraining.
