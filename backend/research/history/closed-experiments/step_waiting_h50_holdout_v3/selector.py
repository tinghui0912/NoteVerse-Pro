"""Pure truth-metadata selection. Only called after remote selector freeze verification."""
from pair_identity import pair_identity


def pitch_set(group):
    return group['normalizedPitchSet']


def first_topologies(sources):
    selected = {}
    counts = {k:0 for k in ['correct_single','correct_chord','same_pitch_sustain','same_chord_sustain',
              'single_busy_retrigger','chord_busy_retrigger','post_ready_repeat','multiple_wrong_then_correct','partial_then_full']}
    def add(family, source, gestures, guard=None):
        counts[family] += 1
        if family not in selected:
            item = {'family':family,'dataset':source['dataset'],'recordingId':source['recordingId'],
                    'audioSha256':source['audioSha256'],'midiSha256':source['midiSha256'],'gestures':gestures}
            if guard is not None: item['guard'] = guard
            if len(gestures)==2: item['pair'] = pair_identity(source,gestures[0],gestures[1])
            selected[family] = item
    for source in sorted(sources,key=lambda s:(s['dataset'],s['recordingId'])):
        groups = source['gestures']; duration = source['durationMs']
        def context(g): return 5000 <= g['onsetMs'] <= duration-3000
        for i,g in enumerate(groups):
            if not context(g): continue
            prev = groups[i-1] if i else None
            next_group = groups[i+1] if i+1<len(groups) else None
            before = g['onsetMs']-max(n['onsetMs'] for n in prev['notes']) if prev else g['onsetMs']
            after = (next_group['onsetMs'] if next_group else duration)-g['onsetMs']
            if before >=200 and after >=1200:
                add('correct_single' if len(pitch_set(g))==1 else 'correct_chord',source,[g])
            if next_group and context(next_group):
                pair = pair_identity(source,g,next_group)
                if pair['singleBusyTopologyEligible']: add('single_busy_retrigger',source,[g,next_group])
                if pair['chordBusyTopologyEligible']: add('chord_busy_retrigger',source,[g,next_group])
                if 1200 <= pair['gapMs'] <=8000:
                    if pitch_set(g)==pitch_set(next_group): add('post_ready_repeat',source,[g,next_group])
                    if set(pitch_set(g)) < set(pitch_set(next_group)):
                        add('partial_then_full',source,[g,next_group])
            if i+2<len(groups) and context(groups[i+2]):
                three = groups[i:i+3]
                if all(1200<=b['onsetMs']-a['onsetMs']<=8000 for a,b in zip(three,three[1:])):
                    if pitch_set(three[0])!=pitch_set(three[2]) and pitch_set(three[1])!=pitch_set(three[2]):
                        add('multiple_wrong_then_correct',source,three)
            # A guard excludes every NOTE_ON, not just repeated notes of the target pitch.
            start = max(n['onsetMs'] for n in g['notes'])+200
            end = (next_group['onsetMs'] if next_group else duration)-100
            if end-start<1200 or end>duration-3000: continue
            held = all(n['offsetMs'] is not None and n['offsetMs']>=end for n in g['notes'])
            before_controls = [c for c in source['pedal'] if c['timeMs']<=start]
            pedal = bool(before_controls and before_controls[-1]['value']>=64
                         and not any(start<c['timeMs']<end and c['value']<64 for c in source['pedal']))
            if held or pedal:
                add('same_pitch_sustain' if len(pitch_set(g))==1 else 'same_chord_sustain',source,[g],
                    {'startMs':start,'endMs':end,'durationMs':end-start,'allPitchNoteOnFree':True,'held':held,'pedal':pedal})
    return selected,counts
