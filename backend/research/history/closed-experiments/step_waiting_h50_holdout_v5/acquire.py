"""Only four exact allowed MP3 byte objects, after remote acquisition freeze."""
from contracts import *
from protocol import fetch


def main():
    proof = require_protocol(); started = now()
    result = []
    for ident, (path, expected) in sorted(SELECTED.items()):
        allowed_audio(ident, path)
        url = 'https://raw.githubusercontent.com/pymatchmaker/matchmaker-benchmark-data/' + UPSTREAM + '/' + path
        data = fetch(url)
        actual = object_sha(data)
        if actual != expected:
            save(OUT / 'acquisition-failure.json', dict(proof, executionStartedAt=started,
                recordingId=ident, path=path, expectedGitBlobSha1=expected, actualGitBlobSha1=actual,
                disposition='STEP_WAITING_H50_SELECTED_AUDIO_UPSTREAM_OBJECT_MISMATCH'))
            raise ValueError('STEP_WAITING_H50_SELECTED_AUDIO_UPSTREAM_OBJECT_MISMATCH')
        local = WORK / 'audio' / (ident + '.mp3'); local.parent.mkdir(parents=True, exist_ok=True)
        with local.open('xb') as file: file.write(data)
        result.append({'recordingId': ident, 'path': path, 'upstreamCommit': UPSTREAM,
            'expectedGitBlobSha1': expected, 'actualGitBlobSha1': actual,
            'audioSha256': digest(data), 'bytes': len(data), 'url': url,
            'localPath': local.relative_to(ROOT).as_posix(), 'downloadedAt': now()})
    save(OUT / 'audio-acquisition.json', dict(proof, executionStartedAt=started, completedAt=now(),
        selectedBatikAudioCount=len(result), objects=result, otherAudioDownloaded=False,
        audioPcmDecoded=False, newNeuralRuns=0))
    print({'selectedAudioObjectsVerified': len(result), 'newNeuralRuns': 0})


if __name__ == '__main__': main()
