"""Non-SMD test truth writer, used only by the production-path dry run."""
import argparse
import hashlib
import io
import json
import zipfile
from pathlib import Path
import pretty_midi
from backend.research.tools.phase9g_xc1_r3d_stage_b import container_guard, write_immutable

def main():
    container_guard()
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    args = parser.parse_args()
    root = Path(args.root)
    manifest = json.loads((root / 'manifest.json').read_text())
    with zipfile.ZipFile(root / 'synthetic_truth.zip', 'x') as archive:
        for take in manifest['takes']:
            midi = pretty_midi.PrettyMIDI(initial_tempo=120)
            piano = pretty_midi.Instrument(0)
            piano.notes = [pretty_midi.Note(90, pitch, start, start + .1)
                           for pitch, start in [(60, 1.2), (64, 1.6), (67, 2.2), (60, 3.5)]]
            midi.instruments.append(piano)
            data = io.BytesIO()
            midi.write(data)
            content = data.getvalue()
            name = f"midi/{take['takeId']}.mid"
            archive.writestr(name, content)
            take['midiRelativePath'] = name
            take['midiSha256'] = hashlib.sha256(content).hexdigest()
    write_immutable(root / 'truth_manifest.json', manifest)

if __name__ == '__main__':
    main()
