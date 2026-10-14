"""Verify existing F3 canonical bytes and acoustic sources without model inference."""
import hashlib
import json
import zipfile
from pathlib import Path
from backend.scripts.phase9g_xc1_r3d_stage_b import container_guard, write_immutable
from backend.research.xc1_scientific_bakeoff import sha256_file, md5_file

ROOT = Path(__file__).resolve().parents[2]
def main():
    identity = container_guard()
    manifest_path = ROOT / 'backend/research/reports/phase9g_xc1_r2_smd_take_manifest_f3_2026-10-14.json'
    manifest = json.loads(manifest_path.read_text())
    archive_path = ROOT / 'backend/data/work/smd_v2/SMD-piano_v2.zip'
    archive = {'bytes': archive_path.stat().st_size, 'md5': md5_file(archive_path), 'sha256': sha256_file(archive_path)}
    if archive != {'bytes': 3221582754, 'md5': '984cfc48f1fa2785594769eb1e674697',
                   'sha256': '75f6e0f5fc9f5ea10582371c84b15f264538bf2a183721d5dee9e337e221b8ab'}:
        raise ValueError('XC1_ARCHIVE_IDENTITY_DRIFT')
    rows = []
    with zipfile.ZipFile(archive_path) as zf:
        for take in manifest['takes']:
            pcm = take['canonicalPcm']
            path = ROOT / pcm['relativeStageAPath']
            digest = hashlib.sha256()
            with zf.open(take['acousticWavRelativePath']) as source:
                for data in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(data)
            valid = (path.stat().st_size == pcm['byteSize'] == pcm['sampleCount'] * 4
                     and sha256_file(path) == pcm['sha256'] and pcm['sampleRateHz'] == 16000
                     and pcm['dtype'] == 'float32-le-raw' and digest.hexdigest() == take['acousticWavSha256'])
            rows.append({'takeId': take['takeId'], 'status': 'PASS' if valid else 'FAIL',
                         'canonicalPcm': pcm, 'verifiedSourceWavSha256': digest.hexdigest()})
    report = {'dockerScienceRuntimeIdentity': identity, 'archiveIdentity': archive, 'rows': rows,
              'passedTakeCount': sum(row['status'] == 'PASS' for row in rows), 'totalTakeCount': len(rows)}
    write_immutable(ROOT / 'backend/data/work/xc1_r3d_validation/canonical_pcm_verified.json', report)
    print(json.dumps({'passedTakeCount': report['passedTakeCount'], 'totalTakeCount': len(rows)}))
    if report['passedTakeCount'] != 50:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
