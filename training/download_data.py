"""Download Quick Draw numpy_bitmap data for every category in categories.json.

The full per-category files on GCS are 50-300 MB (11+ GB total), but training
only uses the first N samples of each. Since .npy stores samples contiguously,
an HTTP Range request for the header plus N rows fetches exactly what we need
(~2 GB total instead of 11+). Each file is re-saved as a valid .npy of shape
(N, 784) in training/data/<category>.npy and skipped on re-run.

Usage:
    python download_data.py               # everything missing, 25k samples each
    python download_data.py --limit 2     # first N categories only (smoke test)
"""

from __future__ import annotations

import argparse
import ast
import io
import json
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

BASE_URL = "https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap/"
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR / "data"
ROW_BYTES = 28 * 28  # one uint8 drawing per row
NPY_PREAMBLE = 10  # magic(6) + version(2) + header_len(2) for .npy v1


def load_category_names() -> list[str]:
    with open(SCRIPT_DIR / "categories.json", encoding="utf-8") as f:
        return [c["name"] for c in json.load(f)["categories"]]


def fetch_range(url: str, start: int, end: int) -> bytes:
    req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def download(category: str, samples: int) -> bool:
    """Fetch the first `samples` drawings of one category. True on success."""
    dest = DATA_DIR / f"{category}.npy"
    if dest.exists():
        print(f"  {category}: already downloaded, skipping")
        return True

    url = BASE_URL + urllib.parse.quote(category) + ".npy"
    try:
        # Parse the .npy header to find where row data starts and how many
        # rows the file has (files can theoretically hold fewer than we want).
        preamble = fetch_range(url, 0, NPY_PREAMBLE - 1)
        if preamble[:6] != b"\x93NUMPY":
            print(f"  {category}: not a .npy file?")
            return False
        header_len = struct.unpack("<H", preamble[8:10])[0]
        header = fetch_range(url, NPY_PREAMBLE, NPY_PREAMBLE + header_len - 1).decode("latin1")
        shape = ast.literal_eval(header)["shape"]
        n_rows = min(samples, shape[0])

        data_start = NPY_PREAMBLE + header_len
        raw = fetch_range(url, data_start, data_start + n_rows * ROW_BYTES - 1)
        arr = np.frombuffer(raw, dtype=np.uint8).reshape(n_rows, ROW_BYTES)

        buf = io.BytesIO()
        np.save(buf, arr)
        dest.write_bytes(buf.getvalue())
        print(f"  {category}: {n_rows:,} samples ({len(raw) / 1e6:.0f} MB)")
        return True
    except urllib.error.HTTPError as e:
        print(f"  {category}: HTTP {e.code} — name must exactly match the official category list")
        return False
    except (urllib.error.URLError, OSError) as e:
        print(f"  {category}: failed ({e}) — re-run to resume")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, help="only download the first N categories")
    parser.add_argument("--samples", type=int, default=25_000,
                        help="samples per category (default 25k ≈ 20 MB each)")
    args = parser.parse_args()

    categories = load_category_names()
    if args.limit:
        categories = categories[: args.limit]

    DATA_DIR.mkdir(exist_ok=True)
    print(f"Downloading {len(categories)} categories into {DATA_DIR}")
    failures = [c for c in categories if not download(c, args.samples)]

    if failures:
        print(f"\n{len(failures)} categories failed: {', '.join(failures)}")
        return 1
    print("\nAll categories downloaded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
