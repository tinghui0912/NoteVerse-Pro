"""Download one PianoVAM audio+MIDI pair from Hugging Face.

Set HF_TOKEN in the environment before running this script. The token is used
only for HTTP authorization and is never written to disk by the script.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import urllib.parse
import urllib.request


DATASET_ID = "PianoVAM/PianoVAM_v1.0"
DEFAULT_DATASET_DIR = Path("data/work/datasets/pianovam-v1.0")
MODALITIES = ("Audio", "MIDI")


def main() -> int:
    args = parse_args()
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is required to download PianoVAM files")
    headers = {"Authorization": f"Bearer {token}"}
    pairs = list_pairs(headers)
    basename = args.basename or sorted(pairs)[0]
    if basename not in pairs:
        raise RuntimeError(f"PianoVAM pair not found: {basename}")

    downloaded = {}
    for rel_path in pairs[basename]:
        output_path = args.dataset_dir / rel_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if output_path.exists() and not args.force:
            downloaded[rel_path] = {
                "path": str(output_path),
                "bytes": output_path.stat().st_size,
                "skipped_existing": True,
            }
            continue
        copied = download_file(rel_path, output_path, headers=headers)
        downloaded[rel_path] = {
            "path": str(output_path),
            "bytes": copied,
            "skipped_existing": False,
        }

    print(
        json.dumps(
            {
                "source": "PianoVAM v1.0",
                "dataset_id": DATASET_ID,
                "basename": basename,
                "extracted": downloaded,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIR)
    parser.add_argument(
        "--basename",
        default=None,
        help="Pair basename such as 2024-02-14_19-10-09; defaults to the first pair.",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing files.")
    return parser.parse_args()


def list_pairs(headers: dict[str, str]) -> dict[str, tuple[str, str]]:
    api_url = "https://huggingface.co/api/datasets/" + urllib.parse.quote(DATASET_ID, safe="/")
    with urllib.request.urlopen(urllib.request.Request(api_url, headers=headers), timeout=60) as response:
        dataset = json.load(response)
    paths = [sibling["rfilename"] for sibling in dataset.get("siblings", [])]
    audio_by_name = _paths_by_stem(paths, root="Audio", suffix=".wav")
    midi_by_name = _paths_by_stem(paths, root="MIDI", suffix=".mid")
    common = sorted(set(audio_by_name).intersection(midi_by_name))
    return {stem: (audio_by_name[stem], midi_by_name[stem]) for stem in common}


def _paths_by_stem(paths: list[str], *, root: str, suffix: str) -> dict[str, str]:
    return {
        PurePosixPath(path).stem: path
        for path in paths
        if path.startswith(f"{root}/") and path.endswith(suffix)
    }


def download_file(rel_path: str, output_path: Path, *, headers: dict[str, str]) -> int:
    url = (
        "https://huggingface.co/datasets/"
        + urllib.parse.quote(DATASET_ID, safe="/")
        + "/resolve/main/"
        + urllib.parse.quote(rel_path, safe="/")
    )
    copied = 0
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response, output_path.open("wb") as file:
        while chunk := response.read(1024 * 1024):
            file.write(chunk)
            copied += len(chunk)
    return copied


if __name__ == "__main__":
    raise SystemExit(main())
