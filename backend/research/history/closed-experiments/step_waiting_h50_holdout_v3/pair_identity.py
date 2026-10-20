"""Synthetic-testable MIDI topology identities, not an acoustic detector."""
from hashlib import sha256
import json


def normalized(values):
    if not values or any(type(p) is not int or not 0 <= p <= 127 for p in values):
        raise ValueError('INVALID_MIDI_PITCH_SET')
    return sorted(set(values))


def pair_identity(source, first, second):
    a, b = normalized(first['normalizedPitchSet']), normalized(second['normalizedPitchSet'])
    if first['gestureId'] == second['gestureId'] or not 0 <= first['onsetMs'] < second['onsetMs']:
        raise ValueError('INVALID_GESTURE_IDENTITY')
    kind = ('SINGLE_SAME_PITCH_RETRIGGER' if len(a) == 1 else 'EXACT_REPEATED_CHORD') if a == b else None
    gap = second['onsetMs'] - first['onsetMs']
    identity = {key: source[key] for key in ['recordingId', 'audioSha256', 'midiSha256']}
    identity.update({'firstGestureId':first['gestureId'], 'firstOnsetMs':first['onsetMs'], 'firstNormalizedPitchSet':a,
                     'secondGestureId':second['gestureId'], 'secondOnsetMs':second['onsetMs'], 'secondNormalizedPitchSet':b,
                     'gapMs':gap, 'pairKind':kind})
    digest = sha256(json.dumps(identity,sort_keys=True,separators=(',', ':'),allow_nan=False).encode()).hexdigest()
    return {**identity, 'pairId':digest,
            'singleBusyTopologyEligible':kind == 'SINGLE_SAME_PITCH_RETRIGGER' and 200 <= gap <= 250,
            'chordBusyTopologyEligible':kind == 'EXACT_REPEATED_CHORD' and 50 < gap <= 250}
