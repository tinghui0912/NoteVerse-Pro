"""Generate immutable original Recording media admission projections using only stdlib."""

import argparse
import difflib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = "contracts/practice/recording-media-admission.json"
TS_PATH = "apps/customer-web/src/lib/practice/recording/generated/media-admission.ts"
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


def load_admission(path):
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=unique_object,
        parse_constant=invalid_constant,
    )


def validate(admission):
    if not isinstance(admission, dict) or set(admission) != {
        "schemaVersion",
        "originalRecordingContainers",
    }:
        raise ValueError("Recording admission requires exact top-level fields")
    if type(admission["schemaVersion"]) is not int or admission["schemaVersion"] != 1:
        raise ValueError("Recording admission schemaVersion must be 1")
    containers = admission["originalRecordingContainers"]
    if not isinstance(containers, list) or not containers:
        raise ValueError("originalRecordingContainers must be a non-empty array")
    mimes = set()
    for entry in containers:
        if not isinstance(entry, dict) or set(entry) != {
            "kind",
            "mimeType",
            "extension",
            "signature",
        }:
            raise ValueError("Original recording container requires exact descriptor fields")
        kind, mime = entry["kind"], entry["mimeType"]
        if not isinstance(kind, str) or kind not in {"AUDIO", "VIDEO"}:
            raise ValueError("Recording kind must be AUDIO or VIDEO")
        if (
            not isinstance(mime, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*", mime)
            or not mime.startswith(kind.lower() + "/")
        ):
            raise ValueError("Recording MIME must be canonical, parameter-free and match its kind")
        if mime in mimes:
            raise ValueError(f"Duplicate recording MIME: {mime}")
        mimes.add(mime)
        extension = entry["extension"]
        if not isinstance(extension, str) or not re.fullmatch(r"[a-z][a-z0-9]*", extension):
            raise ValueError("Recording extension must be non-empty safe lowercase text")
        if not isinstance(entry["signature"], str) or entry["signature"] not in SIGNATURES:
            raise ValueError("Unsupported recording signature family")


def projections(admission):
    validate(admission)
    ts = [f"// {NOTICE}", "export const ORIGINAL_RECORDING_CONTAINERS = Object.freeze(["]
    py = [
        f'"""{NOTICE}"""',
        "",
        "from typing import NamedTuple",
        "",
        "",
        "class RecordingContainer(NamedTuple):",
        "    kind: str",
        "    mime_type: str",
        "    extension: str",
        "    signature: str",
        "",
        "",
        "ORIGINAL_RECORDING_CONTAINERS = (",
    ]
    for entry in admission["originalRecordingContainers"]:
        ts.append("  Object.freeze({")
        for key in ["kind", "mimeType", "extension", "signature"]:
            ts.append(f"    {key}: {json.dumps(entry[key])},")
        ts.append("  } as const),")
        fields = ", ".join(
            json.dumps(entry[key]) for key in ["kind", "mimeType", "extension", "signature"]
        )
        py.append(f"    RecordingContainer({fields}),")
    ts.extend(
        [
            "] as const);",
            "",
            "export type RecordingMediaKind = (typeof ORIGINAL_RECORDING_CONTAINERS)[number]['kind'];",
            "",
        ]
    )
    py.extend([")", ""])
    return {
        TS_PATH: "\n".join(ts),
        f"{PY_DIRECTORY}/__init__.py": f'"""{NOTICE}"""\n',
        f"{PY_DIRECTORY}/recording_media_admission.py": "\n".join(py),
    }


def generate(root, *, check=False):
    outputs = projections(load_admission(root / CONTRACT))
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
        raise SystemExit("Original Recording Media Admission projections differ; run the generator")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generate(ROOT, check=args.check)
    print("Original Recording Media Admission projections agree.")


if __name__ == "__main__":
    main()
