"""Offline non-root, read-only and four-runtime qualification of one core image."""

from __future__ import annotations

import argparse
import subprocess

RUNTIMES = ("customer-api", "control-plane", "beat", "migrator")


def smoke(image: str) -> None:
    base = [
        "docker",
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--tmpfs",
        "/tmp:rw,exec,nosuid,nodev,size=2g,mode=1777",
    ]
    identity = subprocess.run(
        ["docker", "image", "inspect", image, "--format", "{{.Config.User}}"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if identity != "10001:10001":
        raise RuntimeError("Core image requires numeric USER 10001:10001")
    probe = """import errno, os
from pathlib import Path
assert os.getuid() == os.getgid() == 10001
try:
    Path('/read-only-probe').write_text('forbidden')
except OSError as exc:
    assert exc.errno == errno.EROFS, exc
else:
    raise AssertionError('Root filesystem is writable')
Path('/tmp/scratch-probe').write_text('bounded scratch works')
"""
    subprocess.run([*base, "--entrypoint", "python", image, "-c", probe], check=True)
    for runtime in RUNTIMES:
        subprocess.run([*base, image, "contract", "--runtime", runtime], check=True)
    subprocess.run([*base, image, "contract"], check=True)
    refused = subprocess.run([*base, image, "invalid-runtime"], check=False)
    if refused.returncode != 64:
        raise RuntimeError("Core entrypoint must reject unknown runtime commands")
    print("Core smoke passed: UID:GID 10001:10001, root writes denied, four isolated offline modes")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    smoke(parser.parse_args().image)


if __name__ == "__main__":
    main()
