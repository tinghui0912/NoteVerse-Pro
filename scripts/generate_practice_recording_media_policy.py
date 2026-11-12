"""Generate immutable original Recording container policy projections using only stdlib."""

import argparse
import difflib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = "contracts/practice/recording-media-policy.json"
TS_PATH = "apps/customer-web/src/lib/practice/recording/generated/media-policy.ts"
PY_DIRECTORY = "backend/app/modules/performance_takes/generated"
NOTICE = f"Generated from {CONTRACT}. Do not edit."
SIGNATURES = {"EBML", "OGG", "RIFF_WAVE", "ISO_BMFF_FTYP"}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError(f"Non-JSON numeric constant: {value}")


def load_policy(path):
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=unique_object,
        parse_constant=invalid_constant,
    )


def validate(policy):
    if not isinstance(policy, dict) or set(policy) != {
        "schemaVersion",
        "captureContainers",
        "videoRecorderCandidates",
    }:
        raise ValueError("Recording policy requires exact top-level fields")
    if type(policy["schemaVersion"]) is not int or policy["schemaVersion"] != 1:
        raise ValueError("Recording policy schemaVersion must be 1")
    containers = policy["captureContainers"]
    if not isinstance(containers, list) or not containers:
        raise ValueError("captureContainers must be a non-empty array")
    mimes = set()
    video_mimes = set()
    for entry in containers:
        if not isinstance(entry, dict) or set(entry) != {
            "kind",
            "mimeType",
            "extension",
            "signature",
        }:
            raise ValueError("Capture container requires exact descriptor fields")
        kind, mime = entry["kind"], entry["mimeType"]
        if not isinstance(kind, str) or kind not in {"AUDIO", "VIDEO"}:
            raise ValueError("Capture kind must be AUDIO or VIDEO")
        if (
            not isinstance(mime, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*", mime)
            or not mime.startswith(kind.lower() + "/")
        ):
            raise ValueError("Capture MIME must be canonical, parameter-free and match its kind")
        if mime in mimes:
            raise ValueError(f"Duplicate capture MIME: {mime}")
        mimes.add(mime)
        if kind == "VIDEO":
            video_mimes.add(mime)
        extension = entry["extension"]
        if not isinstance(extension, str) or not re.fullmatch(r"[a-z][a-z0-9]*", extension):
            raise ValueError("Capture extension must be non-empty safe lowercase text")
        if not isinstance(entry["signature"], str) or entry["signature"] not in SIGNATURES:
            raise ValueError("Unsupported capture signature family")
    candidates = policy["videoRecorderCandidates"]
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("videoRecorderCandidates must be a non-empty array")
    seen = set()
    for candidate in candidates:
        if (
            not isinstance(candidate, str)
            or not candidate
            or candidate != candidate.strip()
            or any(ord(character) < 32 for character in candidate)
            or candidate.split(";", 1)[0].strip().lower() not in video_mimes
        ):
            raise ValueError("VIDEO candidate must normalize to an admitted VIDEO MIME")
        if candidate in seen:
            raise ValueError(f"Duplicate VIDEO candidate: {candidate}")
        seen.add(candidate)


def projections(policy):
    validate(policy)
    ts = [f"// {NOTICE}", "export const CAPTURE_CONTAINERS = Object.freeze(["]
    py = [
        f'"""{NOTICE}"""',
        "",
        "from typing import NamedTuple",
        "",
        "",
        "class CaptureContainer(NamedTuple):",
        "    kind: str",
        "    mime_type: str",
        "    extension: str",
        "    signature: str",
        "",
        "",
        "CAPTURE_CONTAINERS = (",
    ]
    for entry in policy["captureContainers"]:
        ts.append("  Object.freeze({")
        for key in ["kind", "mimeType", "extension", "signature"]:
            ts.append(f"    {key}: {json.dumps(entry[key])},")
        ts.append("  } as const),")
        fields = ", ".join(
            json.dumps(entry[key]) for key in ["kind", "mimeType", "extension", "signature"]
        )
        py.append(f"    CaptureContainer({fields}),")
    ts.extend(["] as const);", "", "export const VIDEO_CAPTURE_MIME_CANDIDATES = Object.freeze(["])
    py.extend([")", "", "VIDEO_CAPTURE_MIME_CANDIDATES = ("])
    for candidate in policy["videoRecorderCandidates"]:
        ts.append(f"  {json.dumps(candidate)},")
        py.append(f"    {json.dumps(candidate)},")
    ts.extend(
        [
            "] as const);",
            "",
            "export type CaptureMediaKind = (typeof CAPTURE_CONTAINERS)[number]['kind'];",
            "",
        ]
    )
    py.extend([")", ""])
    return {
        TS_PATH: "\n".join(ts),
        f"{PY_DIRECTORY}/__init__.py": f'"""{NOTICE}"""\n',
        f"{PY_DIRECTORY}/recording_media_policy.py": "\n".join(py),
    }


def generate(root, *, check=False):
    outputs = projections(load_policy(root / CONTRACT))
    drift = False
    for name, expected in outputs.items():
        path = root / name
        if check:
            actual = path.read_text(encoding="utf-8") if path.exists() else ""
            if actual != expected:
                drift = True
                print(
                    "".join(
                        difflib.unified_diff(
                            actual.splitlines(keepends=True),
                            expected.splitlines(keepends=True),
                            fromfile=name,
                            tofile=f"{name} (generated)",
                        )
                    )
                )
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8", newline="\n")
    if drift:
        raise SystemExit("Recording Media Policy projections differ; run the generator")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generate(ROOT, check=args.check)
    print("Recording Media Policy projections agree.")


if __name__ == "__main__":
    main()
