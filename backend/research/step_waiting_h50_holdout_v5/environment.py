"""Inspect the pinned decoder without opening any selected audio."""
import sys
import subprocess
from pathlib import Path
import numpy as np
import scipy
import soundfile as sf
from contracts import OUT, IMAGE, now, digest, save


def main():
    formats = sf.available_formats(); subtypes = sf.available_subtypes('MP3')
    if 'MP3' not in formats or 'MPEG_LAYER_III' not in subtypes: raise ValueError('SINGLE_DECODER_MP3_UNSUPPORTED_STOP')
    libraries = sorted({line.split()[-1] for line in Path('/proc/self/maps').read_text().splitlines()
                        if '/' in line and any(name in line for name in ['libsndfile', 'libmpg123', 'libmp3lame'])})
    result = {'inspectedAt': now(), 'containerImage': IMAGE, 'python': sys.version,
              'implementation': 'python-soundfile/libsndfile; no alternate decoder',
              'soundfile': sf.__version__, 'libsndfile': sf.__libsndfile_version__,
              'numpy': np.__version__, 'scipy': scipy.__version__,
              'formats': formats, 'mp3Subtypes': subtypes,
              'libraries': [{'path': p, 'sha256': digest(Path(p).read_bytes())} for p in libraries],
              'packageVersions': subprocess.check_output(['dpkg-query', '-W', 'libsndfile1', 'libmpg123-0'], text=True).splitlines(),
              'selectedAudioBytesAvailableToInspection': False, 'selectedAudioDecoded': False,
              'decoderCandidatesTriedOnAudio': 0, 'newNeuralRuns': 0}
    save(OUT / 'decoder-environment.json', result)
    print({k: result[k] for k in ['containerImage', 'soundfile', 'libsndfile', 'packageVersions']})


if __name__ == '__main__': main()
