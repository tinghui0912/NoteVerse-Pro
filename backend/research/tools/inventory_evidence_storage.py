"""Read-only, deterministic inventory of committed research evidence.

Read Git blobs, not checkout bytes. No network, inference or storage mutation.
References are literal paths (including unambiguous basenames), not a proof that
dynamic consumers do not exist. Candidate classifications authorize no migration.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from contextlib import AbstractContextManager
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import subprocess
import sys
from typing import Any


REPORTS = "backend/research/reports/"
HISTORY = "backend/research/history/"
COMPACT_BYTES = 512 * 1024
TEXT_EXTENSIONS = {
    ".py", ".js", ".mjs", ".ts", ".tsx", ".ps1", ".sh", ".json", ".md",
    ".txt", ".log", ".tap", ".csv", ".yaml", ".yml", ".toml", ".ini", ".xml",
}
EXECUTABLE_EXTENSIONS = {".py", ".js", ".mjs", ".ts", ".tsx", ".ps1", ".sh"}
PATH_TOKEN = re.compile(
    r"[A-Za-z0-9_.:/\\-]+\.(?:json|f32|wav|md|mjs|js|txt|log|tap|csv)(?![A-Za-z0-9_.-])"
)
TRACE_KEYS = {
    "trace", "traces", "events", "receipts", "frames", "requests", "responses",
    "publications", "observations", "diagnostics", "sourceblocks", "transactions",
    "capturetrace", "executiontrace", "inferences", "timings", "eventlog",
}
EXECUTION_FIELDS = {
    "processingStartTimestamp", "publicationFinishTimestamp", "ortSessionRunStartTimestamp",
    "ortSessionRunFinishTimestamp", "captureToPublicationAgeMs", "enqueueToStartQueueDelayMs",
    "scheduledReadyTimestamp", "groupProcessingStartTimestamp",
}


def git(root: Path, *args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(root), *args])


def tracked_tree(root: Path, revision: str) -> list[dict[str, Any]]:
    records = []
    for entry in git(root, "ls-tree", "-rlz", revision).split(b"\0"):
        if not entry:
            continue
        metadata, path = entry.split(b"\t", 1)
        mode, kind, oid, size = metadata.split()
        if kind != b"blob":
            continue
        records.append({"path": path.decode("utf-8"), "bytes": int(size),
                        "gitBlobSha": oid.decode("ascii"), "mode": mode.decode("ascii")})
    return sorted(records, key=lambda row: row["path"])


class Blobs(AbstractContextManager):
    """One git cat-file process; keep only one blob in memory at a time."""

    def __init__(self, root: Path):
        self.process = subprocess.Popen(
            ["git", "-C", str(root), "cat-file", "--batch"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        )

    def read(self, oid: str) -> bytes:
        assert self.process.stdin is not None and self.process.stdout is not None
        self.process.stdin.write((oid + "\n").encode("ascii"))
        self.process.stdin.flush()
        header = self.process.stdout.readline().split()
        if len(header) != 3 or header[1] != b"blob":
            raise ValueError(f"Unavailable Git blob: {oid}")
        payload = self.process.stdout.read(int(header[2]))
        if len(payload) != int(header[2]) or self.process.stdout.read(1) != b"\n":
            raise ValueError(f"Incomplete Git blob: {oid}")
        return payload

    def __exit__(self, *args: Any) -> None:
        assert self.process.stdin is not None
        self.process.stdin.close()
        self.process.wait()
        assert self.process.stdout is not None
        self.process.stdout.close()


def family(path: str) -> str:
    relative = path.removeprefix(REPORTS)
    if "/" in relative:
        return relative.split("/", 1)[0]
    # Group dated flat reports by their stable prefix, without using phase names
    # to infer their nature, liveness or retention classification.
    return re.sub(r"_\d{4}-\d{2}-\d{2}$", "", PurePosixPath(relative).stem)


def json_profile(document: Any, identities: dict[str, list[dict[str, Any]]] | None = None
                 ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Structural weights use compact UTF-8 JSON bytes, not original indentation.

    Nested trace weights are disjoint. Large arrays alone are not sufficient to
    classify a final metrics document as bulk.
    """
    arrays: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    summary_keys: set[str] = set()

    def visit(value: Any, pointer: str, key: str = "") -> tuple[int, int, int]:
        if isinstance(value, dict):
            size, raw_bytes, trace_bytes = 2, 0, 0
            if identities:
                sizes = [v for k, v in value.items()
                         if k.lower() in {"bytes", "bytesize", "sizebytes", "filesize"}
                         and isinstance(v, int) and not isinstance(v, bool)]
                for k, v in value.items():
                    if isinstance(v, str) and k.lower().endswith("sha256") and v in identities:
                        for target in identities[v]:
                            if target["bytes"] in sizes:
                                records.append({"target": target["path"], "jsonPointer": pointer,
                                                "recordedPath": value.get("path", value.get("file"))})
            for i, (child_key, child) in enumerate(value.items()):
                normalized = re.sub(r"[^a-z]", "", child_key.lower())
                if normalized in {"verdict", "decision", "summary", "final", "conclusion", "metrics"}:
                    summary_keys.add(normalized)
                child_size, raw, trace = visit(child, pointer + "/" + child_key, child_key)
                size += len(json.dumps(child_key, ensure_ascii=False).encode("utf-8")) + 1 + child_size + bool(i)
                raw_bytes += raw
                trace_bytes += trace
            return size, raw_bytes, trace_bytes
        if isinstance(value, list):
            size, raw_bytes, trace_bytes = 2, 0, 0
            for i, child in enumerate(value):
                child_size, raw, trace = visit(child, pointer + "[]", key)
                size += child_size + bool(i)
                raw_bytes += raw
                trace_bytes += trace
            normalized = re.sub(r"[^a-z]", "", key.lower())
            numeric = bool(value) and all(isinstance(v, (float, int)) and not isinstance(v, bool) for v in value)
            raw = numeric and (len(value) >= 256 or (len(value) >= 32 and any(
                token in normalized for token in ["tensor", "pcm", "values", "onset", "frame", "data"])))
            trace = len(value) >= 32 and all(isinstance(v, dict) for v in value) and (
                normalized in TRACE_KEYS or len(EXECUTION_FIELDS.intersection(value[0])) >= 2)
            if len(value) >= 16:
                arrays.append({"jsonPointer": pointer, "items": len(value), "compactBytes": size,
                               "nature": "RAW_NUMERIC_ARRAY" if raw else "GENERATED_TRACE" if trace else "ARRAY",
                               "sampleFields": sorted(value[0])[:16] if isinstance(value[0], dict) else []})
            return size, size if raw else raw_bytes, size if trace else trace_bytes
        return len(json.dumps(value, ensure_ascii=False).encode("utf-8")), 0, 0

    compact, raw, trace = visit(document, "$")
    top_conclusions = sorted(set(document).intersection({"final", "verdict", "decision", "conclusion"})) if isinstance(document, dict) else []
    return {"compactBytes": compact, "rawNumericBytes": raw, "generatedTraceBytes": trace,
            "rawNumericRatio": round(raw / max(compact, 1), 6),
            "generatedTraceRatio": round(trace / max(compact, 1), 6),
            "conclusionKeys": sorted(summary_keys),
            "topLevelConclusionKeys": top_conclusions,
            "largestArrays": sorted(arrays, key=lambda row: (-row["compactBytes"], row["jsonPointer"]))[:10]}, records


def classify(path: str, profile: dict[str, Any] | None) -> tuple[str, str]:
    extension = PurePosixPath(path).suffix.lower()
    if extension in {".f32", ".wav", ".pcm", ".npy", ".npz", ".bin"}:
        return "BULK_PAYLOAD", "Raw tensor, numerical or audio bytes; size is not the criterion."
    if profile:
        if profile["topLevelConclusionKeys"]:
            return "REPORT", "Canonical conclusion, possibly bundled with generated detail; preserve report semantics and review mixed content."
        if profile["rawNumericRatio"] >= .65:
            return "BULK_PAYLOAD", "Raw numerical arrays dominate compact JSON content."
        if profile["generatedTraceRatio"] >= .65:
            return "BULK_PAYLOAD", "Generated per-event/frame/receipt records dominate compact JSON content."
        return "REPORT", "Structured report; size alone does not establish bulk. Mixed/large content needs review."
    if extension in {".json", ".md"}:
        return "REPORT", "Conclusion, manifest or human-readable report."
    return "SUPPORTING_EVIDENCE", "Supporting source, log, text or metadata artifact."


def consumer_kind(path: str) -> str:
    if path.startswith((REPORTS, HISTORY)):
        return "EVIDENCE_REFERENCE"
    suffix = PurePosixPath(path).suffix
    if path.startswith("backend/research/") and suffix in EXECUTABLE_EXTENSIONS | {".json"}:
        return "ACTIVE_SOURCE_REFERENCE"
    if (suffix in EXECUTABLE_EXTENSIONS or path.startswith(("docker/", ".github/workflows/"))) and not path.endswith(".md"):
        return "ACTIVE_SOURCE_REFERENCE"
    return "OTHER_TRACKED_REFERENCE"


def summarize(rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for row in rows:
        bucket = result.setdefault(row[key], {"count": 0, "bytes": 0})
        bucket["count"] += 1
        bucket["bytes"] += row["bytes"]
    return dict(sorted(result.items()))


def inventory(root: Path, revision: str = "HEAD") -> dict[str, Any]:
    revision = git(root, "rev-parse", "--verify", revision + "^{commit}").decode().strip()
    tree = tracked_tree(root, revision)
    rows = [{k: v for k, v in entry.items() if k != "mode"} for entry in tree if entry["path"].startswith(REPORTS)]
    by_path = {r["path"]: r for r in rows}
    basenames: dict[str, list[str]] = defaultdict(list)
    for entry in tree:
        basenames[PurePosixPath(entry["path"]).name].append(entry["path"])
    hashes: dict[str, list[dict[str, Any]]] = defaultdict(list)
    profiles = {}
    with Blobs(root) as blobs:
        for row in rows:
            data = blobs.read(row["gitBlobSha"])
            row.update(extension=PurePosixPath(row["path"]).suffix.lower(),
                       sha256=hashlib.sha256(data).hexdigest(), reportFamily=family(row["path"]))
            profile = None
            if row["extension"] == ".json":
                try:
                    profile, _ = json_profile(json.loads(data))
                except (ValueError, UnicodeDecodeError):
                    row["parseWarning"] = "JSON could not be structurally classified."
            row["payloadKind"], row["classificationReason"] = classify(row["path"], profile)
            if profile:
                profiles[row["path"]] = profile
                if row["bytes"] >= 1024 * 1024:
                    row["jsonStructure"] = profile
            hashes[row["sha256"]].append(row)

        consumers: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
        identity_records: dict[str, list[dict[str, Any]]] = defaultdict(list)
        # Only compact REPORT JSON can serve as retained identity evidence for candidates.
        for entry in tree:
            path = entry["path"]
            suffix = PurePosixPath(path).suffix.lower()
            if suffix not in TEXT_EXTENSIONS and PurePosixPath(path).name not in {".gitattributes", "Dockerfile"}:
                continue
            data = blobs.read(entry["gitBlobSha"])
            if b"\0" in data:
                continue
            try:
                text = data.decode("utf-8-sig")
            except UnicodeDecodeError:
                continue
            # Also recognize straightforward Path('backend') / 'research' / 'reports' joins.
            normalized = re.sub(r'''["']\s*/\s*["']''', "/", text).replace("\\", "/")
            normalized = re.sub(r"/{2,}", "/", normalized)
            targets = set()
            for token in PATH_TOKEN.findall(normalized):
                candidate = token.lstrip("./")
                if REPORTS in candidate:
                    candidate = REPORTS + candidate.split(REPORTS, 1)[1]
                options = [candidate]
                if "/" in token:
                    options += [REPORTS + candidate, str(PurePosixPath(path).parent / token)]
                elif str(PurePosixPath(path).parent) != REPORTS.rstrip("/"):
                    options += [str(PurePosixPath(path).parent / token)]
                if "/" not in token and len(basenames.get(token, [])) == 1:
                    options += basenames[token]
                targets.update(p for option in options if (p := posixpath.normpath(option)) in by_path and p != path)
            kind = consumer_kind(path)
            for target in targets:
                consumers[target][kind].add(path)
            owner = by_path.get(path)
            if owner and owner["extension"] == ".json" and owner["bytes"] <= COMPACT_BYTES and owner["payloadKind"] == "REPORT":
                try:
                    _, found = json_profile(json.loads(data), hashes)
                except ValueError:
                    continue
                for record in found:
                    target = record.pop("target")
                    if target != path:
                        identity_records[target].append({"manifest": path, **record})

    for row in rows:
        path = row["path"]
        references = {k: sorted(v) for k, v in sorted(consumers[path].items())}
        row["references"] = references
        row["referenceStatus"] = next((k for k in ["ACTIVE_SOURCE_REFERENCE", "EVIDENCE_REFERENCE", "OTHER_TRACKED_REFERENCE"] if references.get(k)), "NO_TRACKED_REFERENCE")
        row["activeConsumerCount"] = len(references.get("ACTIVE_SOURCE_REFERENCE", []))
        row["evidenceOnlyConsumerCount"] = len(references.get("EVIDENCE_REFERENCE", []))
        row["compactIdentityRecords"] = sorted(identity_records[path], key=lambda r: (r["manifest"], r["jsonPointer"]))
        active_tests = [p for p in references.get("ACTIVE_SOURCE_REFERENCE", []) if p.startswith("backend/research/tests/")]
        if row["payloadKind"] == "BULK_PAYLOAD" and not row["activeConsumerCount"] and row["compactIdentityRecords"]:
            row["migrationCandidate"] = "EXTERNALIZATION_CANDIDATE"
            row["candidateReason"] = "Bulk; no detected literal active consumer; SHA-256 and size recorded in retained compact REPORT JSON. Destination and dynamic consumers still require verification."
        elif row["payloadKind"] == "REPORT" and row["bytes"] <= COMPACT_BYTES and "parseWarning" not in row:
            row["migrationCandidate"] = "KEEP_IN_GIT"
            row["candidateReason"] = "Compact report/manifest/summary evidence."
        elif active_tests and row["bytes"] <= 64 * 1024:
            row["migrationCandidate"] = "KEEP_IN_GIT"
            row["candidateReason"] = "Small artifact with a detected current research test reference."
        else:
            row["migrationCandidate"] = "NEEDS_MANUAL_CLASSIFICATION"
            row["candidateReason"] = "Identity, nature, size, current dependencies or retention semantics need manual review."
        if row["extension"] == ".f32":
            row["survivingJsonManifestRecordsIdentity"] = bool(row["compactIdentityRecords"])
            row["currentReproducibility"] = "NOT_ESTABLISHED"
            row["reproducibilityReason"] = "Literal references and recorded hashes do not prove an executable current producer or byte-identical reproduction."
            row["sourceReferences"] = sorted(p for group in references.values() for p in group if PurePosixPath(p).suffix in EXECUTABLE_EXTENSIONS)

    duplicates = []
    for sha, group in sorted(hashes.items()):
        if len(group) > 1:
            duplicates.append({"sha256": sha, "paths": sorted(r["path"] for r in group),
                               "bytesPerFile": group[0]["bytes"], "trackedBytes": sum(r["bytes"] for r in group),
                               "redundantBytes": sum(r["bytes"] for r in group[1:]),
                               "sealReview": "Distinct paths may be intentional sealed copies; no automatic deduplication."})
    large_json = sorted([r for r in rows if r["extension"] == ".json" and r["bytes"] >= 1024 * 1024], key=lambda r: (-r["bytes"], r["path"]))
    candidates = [r for r in rows if r["migrationCandidate"] == "EXTERNALIZATION_CANDIDATE"]
    return {"schemaVersion": 1, "revision": revision, "scope": REPORTS,
            "method": {"bytes": "Committed Git blob bytes, not worktree bytes.",
                       "references": "Literal full/report-relative/source-relative paths and globally unique basenames; unique files per consumer class. No dynamic import/data-flow inference.",
                       "identity": "Matching SHA-256 and byte count in the same JSON object inside a REPORT <=512KiB; recordedPath is exposed for manual verification.",
                       "jsonWeights": "Disjoint structural compact UTF-8 byte estimates; original files are not serialized or written.",
                       "duplicates": "Redundant bytes are logical tracked-path bytes, not physical Git savings; Git already content-deduplicates identical blobs. Sealed-copy semantics require review.",
                       "candidateLimit": "Candidates only. Durable destination NOT SELECTED; dynamic dependencies, seals and recovery must be reviewed. NO_TRACKED_REFERENCE never authorizes deletion.",
                       "otherReferences": "Non-executable tracked documentation/config references outside reports/history are explicit OTHER_TRACKED_REFERENCE, never falsely called active or absent."},
            "summary": {"files": len(rows), "bytes": sum(r["bytes"] for r in rows),
                        "byExtension": summarize(rows, "extension"), "byPayloadKind": summarize(rows, "payloadKind"),
                        "byReferenceStatus": summarize(rows, "referenceStatus"), "byMigrationCandidate": summarize(rows, "migrationCandidate"),
                        "f32": {"count": sum(r["extension"] == ".f32" for r in rows), "bytes": sum(r["bytes"] for r in rows if r["extension"] == ".f32")},
                        "largeJson": {"count": len(large_json), "bytes": sum(r["bytes"] for r in large_json)},
                        "duplicates": {"groups": len(duplicates), "fileCount": sum(len(g["paths"]) for g in duplicates),
                                       "trackedBytes": sum(g["trackedBytes"] for g in duplicates),
                                       "potentialRedundantBytes": sum(g["redundantBytes"] for g in duplicates)},
                        "externalizationFamilies": summarize(candidates, "reportFamily")},
            "files": rows, "duplicateContentGroups": duplicates,
            "top50": [r["path"] for r in sorted(rows, key=lambda r: (-r["bytes"], r["path"]))[:50]],
            "largeJsonTop50": [r["path"] for r in large_json[:50]],
            "largeJsonPaths": [r["path"] for r in large_json]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--revision", default="HEAD", help="Committed snapshot; default HEAD (untracked/unstaged files excluded).")
    parser.add_argument("--output", type=Path, help="Optional diagnostic file outside reports/history; defaults to stdout.")
    args = parser.parse_args()
    root = Path(git(args.repo_root, "rev-parse", "--show-toplevel").decode().strip())
    if args.output:
        output = args.output.resolve()
        protected = [root / "backend/research/reports", root / "backend/research/history"]
        if any(output.is_relative_to(p.resolve()) for p in protected):
            parser.error("--output must be outside reports/history")
        if output.exists():
            parser.error("--output must not overwrite an existing file")
    result = json.dumps(inventory(root, args.revision), ensure_ascii=False, indent=2) + "\n"
    if args.output:
        with args.output.open("x", encoding="utf-8", newline="\n") as file:
            file.write(result)
    else:
        sys.stdout.buffer.write(result.encode("utf-8"))


if __name__ == "__main__":
    main()
