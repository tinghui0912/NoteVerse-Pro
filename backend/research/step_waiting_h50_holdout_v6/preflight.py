"""Raw byte/path verification only. No decoder, DSP or neural imports."""
import sys
import platform
from contracts import ROOT, OUT, IMAGE, now, read, save, digest, object_sha
from portable import SCHEMA, repo_relative_posix, validate_portable_freeze_manifest


def main(mode, environment):
    started=now()
    if environment not in ('host','container'): raise ValueError('UNKNOWN_PREFLIGHT_ENVIRONMENT')
    if environment=='container' and (str(ROOT)!='/workspace' or platform.system()!='Linux'):
        raise ValueError('PINNED_LINUX_WORKSPACE_REQUIRED')
    if environment=='host' and platform.system()!='Windows': raise ValueError('WINDOWS_HOST_REQUIRED')
    name='portable-predecode-protocol-freeze.json' if mode=='predecode' else 'primary-acoustic-qualification-freeze.json'
    proof_name='portable-predecode-remote-proof.json' if mode=='predecode' else 'primary-freeze-remote-proof.json'
    freeze=read(OUT/name); proof=read(OUT/proof_name)
    if proof['freezeSha256']!=freeze['freezeCanonicalSha256'] or proof['remoteHead']!=proof['freezeCommit'] or not proof['remoteVerifiedAt']<started:
        raise ValueError('PROSPECTIVE_REMOTE_PROOF_REQUIRED')
    if environment=='container':
        prior=read(OUT/('portable-predecode-host-preflight.json' if mode=='predecode' else 'primary-freeze-host-preflight.json'))
        if prior['status']!='PASS' or not prior['completedAt']<started: raise ValueError('HOST_PREFLIGHT_REQUIRED_FIRST')
    count=validate_portable_freeze_manifest(freeze)
    for row in freeze['selectedAudioObjects']:
        path=repo_relative_posix(row['localPath']); data=(ROOT/path).read_bytes()
        if len(data)!=row['bytes'] or digest(data)!=row['audioSha256'] or object_sha(data)!=row['expectedGitBlobSha1']:
            raise ValueError('SELECTED_AUDIO_IDENTITY_MISMATCH')
    result=dict(proof,startedAt=started,completedAt=now(),pathsChecked=count,hashMismatches=0,
        status='PASS',pathSchema=SCHEMA,backslashManifestPaths=0,selectedRawAudioObjectsChecked=4,
        platform=platform.platform(),repositoryRoot=str(ROOT),containerImage=IMAGE if environment=='container' else None,
        network='none' if environment=='container' else 'NO_NETWORK_IO_IN_PREFLIGHT',
        selectedAudioDecoded=False,newNeuralRuns=0,
        verificationAlgorithm='validate_portable_freeze_manifest + raw SHA256/Git blob; imports standard library only')
    filename=('portable-predecode-' if mode=='predecode' else 'primary-freeze-')+environment+'-preflight.json'
    save(OUT/filename,result)
    print(result)


if __name__=='__main__': main(sys.argv[1],sys.argv[2])
