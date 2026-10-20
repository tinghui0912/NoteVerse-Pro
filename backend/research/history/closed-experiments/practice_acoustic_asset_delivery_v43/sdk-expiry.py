"""Read-only pinned SDK inspection; characterization never uses real credentials."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
import datetime
import importlib
import inspect
import socket
from unittest.mock import patch
from urllib.parse import urlsplit, parse_qs

import alibabacloud_oss_v2 as oss

REAL_DATETIME = datetime.datetime
UTC = datetime.timezone.utc
TTL = 300


def installed_sources():
    version = importlib.metadata.version("alibabacloud-oss-v2")
    if version != "1.4.0":
        raise RuntimeError("PINNED_OSS_SDK_VERSION_REQUIRED")
    root = Path(oss.__file__).parent
    records = []
    for path in sorted(root.rglob("*.py")):
        raw = path.read_bytes()
        records.append({"subject": str(path), "relativePath": str(path.relative_to(root)),
                        "domain": "EXTERNAL_LOCAL_DEPENDENCY", "representation": "RAW_BYTES_SHA256",
                        "byteSize": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    return root, records


def identity():
    root, records = installed_sources()
    critical = [r for r in records if r["relativePath"] in (
        "presigner.py", "signer/v4.py", "client.py", "_client.py", "signer/__init__.py")]
    presigner = importlib.import_module("alibabacloud_oss_v2.presigner")
    signer = importlib.import_module("alibabacloud_oss_v2.signer.v4")
    presign_text = inspect.getsource(presigner.presign_inner)
    deserialize_text = inspect.getsource(presigner._deserialize_output)
    signer_text = inspect.getsource(signer.SignerV4)
    facts = {
        "absoluteExpirationFromFirstClock": "now + expires" in presign_text and "datetime.datetime.now(datetime.timezone.utc)" in presign_text,
        "separateSignerClock": "datetime.datetime.now(datetime.timezone.utc)" in signer_text,
        "integerTruncatedDuration": "int((expiration_time - datetime_now).total_seconds())" in signer_text,
        "wholeSecondSigningDate": "strftime('%Y%m%dT%H%M%SZ')" in signer_text,
        "resultKeepsOriginalExpirationMetadata": "result.expiration = op_output.op_metadata.get('expiration_time', None)" in deserialize_text,
        "v4LimitSevenDays": "datetime.timedelta(days=7)" in deserialize_text,
    }
    if not all(facts.values()):
        raise RuntimeError("OSS_EXPIRY_SOURCE_CONTRACT_UNRESOLVED")
    compact = [{"relativePath": r["relativePath"], "byteSize": r["byteSize"], "sha256": r["sha256"]} for r in records]
    witnesses = []
    for function in (presigner.presign_inner, presigner._deserialize_output, signer.SignerV4):
        text, line = inspect.getsourcelines(function)
        witnesses.append({"symbol": function.__qualname__, "sourceFile": inspect.getsourcefile(function),
                          "firstLine": line, "lineCount": len(text), "sourceSha256": hashlib.sha256("".join(text).encode()).hexdigest()})
    return {"version": "1.4.0", "domain": "EXTERNAL_LOCAL_DEPENDENCY", "packageRoot": str(root),
            "packageFiles": len(records), "packageTreeRepresentation": "SHA256_CANONICAL_RELATIVE_SOURCE_RECORDS",
            "packageTreeSha256": hashlib.sha256(json.dumps(compact, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "criticalSources": critical, "sourceWitnesses": witnesses, "facts": facts}


def characterize():
    source_identity = identity()
    base = REAL_DATETIME(2030, 1, 2, 3, 4, 5, tzinfo=UTC)
    cfg = oss.config.load_default()
    cfg.region = "cn-shenzhen"
    cfg.credentials_provider = oss.credentials.StaticCredentialsProvider("v43-synthetic-id", "v43-synthetic-secret")
    client = oss.Client(cfg)
    samples, all_clock_modules = [], set()
    network_attempts = 0

    def denied(*_args, **_kwargs):
        nonlocal network_attempts
        network_attempts += 1
        raise RuntimeError("HERMETIC_NETWORK_FORBIDDEN")

    def sample(fraction_us, delay_us):
        now0 = base + datetime.timedelta(microseconds=fraction_us)
        now1 = now0 + datetime.timedelta(microseconds=delay_us)
        presigner_reads = 0
        reads = []

        class Clock(REAL_DATETIME):
            @classmethod
            def now(cls, tz=None):
                nonlocal presigner_reads
                frame = inspect.currentframe().f_back
                module = frame.f_globals.get("__name__", "")
                reads.append({"module": module, "function": frame.f_code.co_name})
                all_clock_modules.add(module)
                if module == "alibabacloud_oss_v2.presigner":
                    value = now0 if presigner_reads == 0 else now1
                    presigner_reads += 1
                else:
                    value = now1
                return cls.fromtimestamp(value.timestamp(), tz=tz)

        with patch.object(datetime, "datetime", Clock):
            result = client.presign(oss.models.GetObjectRequest(bucket="noteverse-model-assets", key="models/continuous/robust-browser-v1/4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3/model.onnx"), expires=datetime.timedelta(seconds=TTL))
        url = urlsplit(result.url)
        query = parse_qs(url.query)
        stamp = query["x-oss-date"][0]
        duration = query["x-oss-expires"][0]
        signed_time = REAL_DATETIME.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
        effective = signed_time + datetime.timedelta(seconds=int(duration))
        delta_us = (result.expiration - effective) // datetime.timedelta(microseconds=1)
        assert result.expiration == now0 + datetime.timedelta(seconds=TTL)
        assert duration.isdigit() and 0 < int(duration) <= 604800
        assert 0 <= delta_us < 2000000
        assert effective > now1 and result.expiration > now1
        assert any(r["module"] == "alibabacloud_oss_v2.signer.v4" for r in reads)
        return {"descriptorExpiry": result.expiration.isoformat(), "xOssDate": stamp, "xOssExpires": duration,
                "effectiveSignedExpiry": effective.isoformat(), "deltaMs": delta_us / 1000,
                "generationTime": now1.isoformat(), "fractionUs": fraction_us, "signingDelayUs": delay_us,
                "https": url.scheme == "https", "hostname": url.hostname, "pathname": url.path,
                "signatureVersion": query["x-oss-signature-version"][0],
                "oss4FieldPresence": {name: name in query for name in ("x-oss-signature-version", "x-oss-date", "x-oss-expires", "x-oss-credential", "x-oss-signature")},
                "awsSigningAbsent": not any(k.lower().startswith("x-amz-") for k in query)}

    with patch.object(socket.socket, "connect", denied), patch.object(socket, "create_connection", denied), patch.object(socket, "getaddrinfo", denied):
        for fraction in (0, 1, 999, 1000, 10000, 250000, 500000, 750000, 998999, 999000, 999998, 999999):
            for delay in (0, 1, 10, 1000, 150000, 900000, 1200000):
                samples.append(sample(fraction, delay))
    assert network_attempts == 0
    assert min(s["deltaMs"] for s in samples) == 0
    assert max(s["deltaMs"] for s in samples) > 1999
    return {"identity": source_identity, "result": "LOCAL_PASS_NOT_CI_HERMETIC_NOT_DELIVERY_EVIDENCE",
            "networkAttempts": network_attempts, "syntheticCredentialsOnly": True, "clockRestored": datetime.datetime is REAL_DATETIME,
            "sampleCount": len(samples), "minimumDeltaMs": min(s["deltaMs"] for s in samples),
            "maximumDeltaMs": max(s["deltaMs"] for s in samples), "clockModules": sorted(all_clock_modules),
            "proof": {"effective": "floorToSecond(signingTime) + floor(expiration - signingTime) seconds",
                      "delta": "frac(signingTime seconds) + frac(expiration - signingTime seconds)",
                      "precondition": "expiration - signingTime > 0; int truncation is floor for positive duration",
                      "bound": "0 <= deltaMs < 2000", "normalSdkQuantizationNotProductionDefect": True},
            "samples": samples}


def inspect_source():
    root, records = installed_sources()
    print(json.dumps({"version": "1.4.0", "files": len(records), "packageTreeSha256": hashlib.sha256(
        json.dumps(records, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}))
    for record in records:
        text = Path(record["subject"]).read_text()
        if "def presign_inner" in text or "x-oss-expires" in text or "class PresignResult" in text:
            print(json.dumps(record))
            lines = text.splitlines()
            positions = [i for i, line in enumerate(lines) if any(term in line for term in (
                "def presign_inner", "x-oss-expires", "expiration=", "expiration =", "expiration_time",
                "class PresignResult", "datetime.now", "strftime", "iso8601"))]
            selected = set()
            for position in positions:
                selected.update(range(max(0, position - 5), min(len(lines), position + 14)))
            for index in sorted(selected):
                print(f"{index + 1}: {lines[index]}")


if __name__ == "__main__":
    if sys.argv[1:] == ["inspect"]:
        inspect_source()
    elif sys.argv[1:] == ["identity"]:
        print(json.dumps(identity(), separators=(",", ":")))
    elif sys.argv[1:] == ["characterize"]:
        print(json.dumps(characterize(), separators=(",", ":")))
    else:
        raise RuntimeError("EXPLICIT_INSPECTION_MODE_REQUIRED")
