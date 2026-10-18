"""One fail-closed repository path contract. Never repairs old manifests."""
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
from contracts import ROOT, canonical, digest

SCHEMA = 'REPO_RELATIVE_POSIX_V1'


def validate_path(value):
    if not isinstance(value, str) or not value or '\\' in value or '\x00' in value:
        raise ValueError('NONPORTABLE_PATH')
    value.encode('utf-8', errors='strict')
    if ':' in value or PureWindowsPath(value).drive or PurePosixPath(value).is_absolute():
        raise ValueError('ABSOLUTE_OR_DRIVE_PATH')
    if any(p in ('', '.', '..') for p in value.split('/')) or PurePosixPath(value).as_posix() != value:
        raise ValueError('AMBIGUOUS_OR_TRAVERSAL_PATH')
    return value


def repo_relative_posix(path):
    if isinstance(path, str):
        validate_path(path)
        path = ROOT / path
    if not isinstance(path, Path): raise ValueError('PATH_TYPE_REQUIRED')
    if '..' in path.parts: raise ValueError('PARENT_TRAVERSAL')
    absolute = path if path.is_absolute() else ROOT / path
    relative = absolute.relative_to(ROOT)
    absolute.resolve().relative_to(ROOT.resolve())
    return validate_path(relative.as_posix())


def validate_portable_freeze_manifest(value):
    if value.get('pathSchema') != SCHEMA: raise ValueError('PATH_SCHEMA_REQUIRED')
    payload = dict(value); claimed = payload.pop('freezeCanonicalSha256')
    if digest(canonical(payload)) != claimed: raise ValueError('FREEZE_DIGEST_MISMATCH')
    seen = set()
    for row in value['files']:
        path = validate_path(row['path'])
        if path in seen: raise ValueError('DUPLICATE_FREEZE_PATH')
        seen.add(path)
        if repo_relative_posix(ROOT / path) != path: raise ValueError('ROOT_ESCAPE_OR_PATH_DRIFT')
        file = ROOT / path
        if not file.is_file(): raise ValueError('FROZEN_FILE_NOT_FOUND:' + path)
        if not re.fullmatch('[a-f0-9]{64}', row['sha256']): raise ValueError('INVALID_SHA256')
        if digest(file.read_bytes()) != row['sha256']: raise ValueError('FROZEN_HASH_MISMATCH:' + path)
    return len(seen)
