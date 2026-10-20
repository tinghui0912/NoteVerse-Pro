"""Patch an installed Aria-AMT package to read WAV segments via soundfile.

This is a benchmark-container compatibility patch for environments where
torchaudio 2.5 cannot load the available FFmpeg extension. It changes only
Aria-AMT's audio segmentation adapter and leaves model weights, model execution,
and MIDI decoding unchanged.
"""

from __future__ import annotations

from pathlib import Path


def main() -> int:
    path = Path("/usr/local/lib/python3.11/site-packages/amt/data.py")
    text = path.read_text(encoding="utf-8")
    if "import soundfile as sf" not in text:
        text = text.replace("import torchaudio\n", "import torchaudio\nimport soundfile as sf\n")

    start = text.index("def get_wav_segments(")
    end = text.index("\ndef get_paired_wav_mid_segments(", start)
    replacement = '''def get_wav_segments(
    audio_path: str,
    stride_factor: int | None = None,
    pad_last=False,
    segment: Tuple[int, int] | None = None,
):
    assert os.path.isfile(audio_path), "Audio file not found"
    config = load_config()
    sample_rate = config["audio"]["sample_rate"]
    chunk_len = config["audio"]["chunk_len"]

    if not stride_factor:
        stride_factor = config["data"]["stride_factor"]

    chunk_samples = int(sample_rate * chunk_len)
    stride_samples = int(chunk_samples // stride_factor)
    assert chunk_samples % stride_samples == 0, "Invalid stride"

    wav_np, orig_sample_rate = sf.read(audio_path, always_2d=True, dtype="float32")
    wav = torch.from_numpy(wav_np).mean(dim=1)

    if segment is not None:
        assert segment[0] < segment[1], "Invalid segment: start must be less than end"
        start_time_s, end_time_s = segment
        orig_start_sample = int(start_time_s * orig_sample_rate)
        orig_end_sample = int(end_time_s * orig_sample_rate)
        wav = wav[orig_start_sample:orig_end_sample]

    if int(orig_sample_rate) != int(sample_rate):
        wav = torchaudio.functional.resample(
            wav,
            orig_freq=int(orig_sample_rate),
            new_freq=int(sample_rate),
        )

    seg_len_s = len(wav) / sample_rate

    if seg_len_s <= chunk_len:
        if pad_last is True:
            yield torch.nn.functional.pad(wav, (0, chunk_samples - len(wav)))
        else:
            yield wav
        return

    buffer = torch.tensor([], dtype=torch.float32)
    offset = 0
    while offset < len(wav):
        seg_chunk = wav[offset : offset + stride_samples]
        offset += stride_samples

        if seg_chunk.shape[0] < stride_samples:
            seg_chunk = F.pad(
                seg_chunk,
                (0, stride_samples - seg_chunk.shape[0]),
                mode="constant",
                value=0.0,
            )

        if buffer.shape[0] < chunk_samples:
            buffer = torch.cat((buffer, seg_chunk), dim=0)
        else:
            buffer = torch.cat((buffer[stride_samples:], seg_chunk), dim=0)

        if buffer.shape[0] == chunk_samples:
            yield buffer

    if pad_last and buffer.shape[0] > stride_samples:
        yield torch.nn.functional.pad(
            buffer[stride_samples:],
            (0, chunk_samples - len(buffer[stride_samples:])),
        )

'''
    path.write_text(text[:start] + replacement + text[end + 1 :], encoding="utf-8")
    print(f"patched {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
