"""Download one paired audio+MIDI item from MAESTRO without downloading the full zip."""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
from pathlib import Path
import urllib.request
import zipfile


DEFAULT_DATASET_DIR = Path("data/work/datasets/maestro-v3.0.0")
DEFAULT_METADATA_URL = (
    "https://storage.googleapis.com/magentadata/datasets/maestro/v3.0.0/"
    "maestro-v3.0.0.csv"
)
DEFAULT_ZIP_URL = (
    "https://storage.googleapis.com/magentadata/datasets/maestro/v3.0.0/"
    "maestro-v3.0.0.zip"
)
ZIP_PREFIX = "maestro-v3.0.0"


class HttpRangeReader(io.RawIOBase):
    """Minimal seekable HTTP byte-range reader for Python's zipfile module."""

    def __init__(self, url: str, *, block_size: int = 1024 * 1024) -> None:
        self.url = url
        self.block_size = block_size
        self.pos = 0
        self._cache_start = -1
        self._cache = b""
        request = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(request, timeout=30) as response:
            self.length = int(response.headers["Content-Length"])
            accept_ranges = response.headers.get("Accept-Ranges", "")
        if accept_ranges.lower() != "bytes":
            raise RuntimeError(f"Remote zip does not advertise byte ranges: {url}")

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = os.SEEK_SET) -> int:
        if whence == os.SEEK_SET:
            new_position = offset
        elif whence == os.SEEK_CUR:
            new_position = self.pos + offset
        elif whence == os.SEEK_END:
            new_position = self.length + offset
        else:
            raise ValueError(f"Unsupported whence: {whence}")
        if new_position < 0:
            raise ValueError("Cannot seek before the beginning of the remote file")
        self.pos = new_position
        return self.pos

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            size = self.length - self.pos
        if size == 0 or self.pos >= self.length:
            return b""
        size = min(size, self.length - self.pos)
        start = self.pos
        end = start + size
        cache_end = self._cache_start + len(self._cache)
        if not (self._cache_start <= start and end <= cache_end):
            fetch_end = min(self.length, max(end, start + self.block_size)) - 1
            request = urllib.request.Request(
                self.url,
                headers={"Range": f"bytes={start}-{fetch_end}"},
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.status != 206:
                    raise RuntimeError(f"Expected HTTP 206 for range request, got {response.status}")
                self._cache = response.read()
                self._cache_start = start
        relative_start = start - self._cache_start
        data = self._cache[relative_start : relative_start + size]
        self.pos += len(data)
        return data


def main() -> int:
    args = parse_args()
    dataset_dir = args.dataset_dir
    metadata_path = dataset_dir / "maestro-v3.0.0.csv"
    if not metadata_path.exists() or args.force_metadata:
        dataset_dir.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(args.metadata_url, metadata_path)

    row = select_metadata_row(
        metadata_path,
        audio_filename=args.audio_filename,
        split=args.split,
    )
    targets = [
        f"{ZIP_PREFIX}/{row['audio_filename']}",
        f"{ZIP_PREFIX}/{row['midi_filename']}",
    ]
    reader = HttpRangeReader(args.zip_url)
    extracted: dict[str, dict[str, object]] = {}
    with zipfile.ZipFile(reader) as archive:
        names = set(archive.namelist())
        for target in targets:
            if target not in names:
                raise RuntimeError(f"Target not found in MAESTRO archive: {target}")
        for target in targets:
            output_path = dataset_dir / Path(target).relative_to(ZIP_PREFIX)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            if output_path.exists() and not args.force:
                extracted[target] = {
                    "path": str(output_path),
                    "bytes": output_path.stat().st_size,
                    "skipped_existing": True,
                }
                continue
            copied = extract_member(archive, target, output_path)
            extracted[target] = {
                "path": str(output_path),
                "bytes": copied,
                "skipped_existing": False,
            }

    print(
        json.dumps(
            {
                "source": "MAESTRO v3.0.0",
                "selection": {
                    "official_split": row.get("split"),
                    "canonical_composer": row.get("canonical_composer"),
                    "canonical_title": row.get("canonical_title"),
                    "duration": float(row["duration"]),
                    "audio_filename": row["audio_filename"],
                    "midi_filename": row["midi_filename"],
                },
                "remote_zip_bytes": reader.length,
                "extracted": extracted,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, default=DEFAULT_DATASET_DIR)
    parser.add_argument("--metadata-url", default=DEFAULT_METADATA_URL)
    parser.add_argument("--zip-url", default=DEFAULT_ZIP_URL)
    parser.add_argument(
        "--audio-filename",
        default=None,
        help=(
            "Specific metadata audio_filename to extract. Without this, the script "
            "selects the shortest track in --split."
        ),
    )
    parser.add_argument(
        "--split",
        choices=("train", "validation", "test", "all"),
        default="test",
        help=(
            "Official MAESTRO split to sample from. Defaults to test so formal "
            "shootouts do not accidentally use likely training material."
        ),
    )
    parser.add_argument("--force", action="store_true", help="Overwrite extracted files.")
    parser.add_argument(
        "--force-metadata",
        action="store_true",
        help="Re-download metadata CSV even if it already exists.",
    )
    return parser.parse_args()


def select_metadata_row(
    metadata_path: Path,
    *,
    audio_filename: str | None,
    split: str,
) -> dict[str, str]:
    with metadata_path.open("r", encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))
    if audio_filename is not None:
        for row in rows:
            if row["audio_filename"] == audio_filename and (split == "all" or row["split"] == split):
                return row
        raise RuntimeError(f"audio_filename not found in MAESTRO {split} split: {audio_filename}")
    if split != "all":
        rows = [row for row in rows if row["split"] == split]
    if not rows:
        raise RuntimeError(f"No MAESTRO metadata rows found for split: {split}")
    return min(rows, key=lambda row: float(row["duration"]))


def extract_member(archive: zipfile.ZipFile, target: str, output_path: Path) -> int:
    copied = 0
    with archive.open(target) as source, output_path.open("wb") as destination:
        while chunk := source.read(1024 * 1024):
            destination.write(chunk)
            copied += len(chunk)
    return copied


if __name__ == "__main__":
    raise SystemExit(main())
