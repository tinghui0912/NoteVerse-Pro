"""Shared canonical MusicXML fixtures for plan and MIDI contract tests."""


def sound(attrs):
    return f"<sound {attrs}/>"


VISIBLE = '<barline location="left"><repeat direction="forward"/></barline>'

INVISIBLE = sound('forward-repeat="yes"')


def backward(policy=None, times=None):
    attrs = (f' after-jump="{policy}"' if policy is not None else "") + (
        f' times="{times}"' if times is not None else ""
    )
    return f'<barline location="right"><repeat direction="backward"{attrs}/></barline>'


def measure(index, events=None):
    events = events or {}
    attributes = (
        "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
        if index == 0
        else ""
    )
    body = "".join(
        events.get(q, "")
        + f'<note id="n{index}_{q}"><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>'
        for q in range(4)
    ) + events.get(4, "")
    return f'<measure number="{index + 1}">{attributes}{body}</measure>'


def score(measures, other=None):
    names = '<score-part id="P1"><part-name>Piano</part-name></score-part>'
    parts = '<part id="P1">' + "".join(measures) + "</part>"
    if other is not None:
        names += '<score-part id="P2"><part-name>Piano</part-name></score-part>'
        parts += '<part id="P2">' + "".join(other).replace('id="n', 'id="p2n') + "</part>"
    return f'<score-partwise version="4.0"><part-list>{names}</part-list>{parts}</score-partwise>'


def repeat(direction, policy=None, times=None):
    location = "left" if direction == "forward" else "right"
    attrs = (f' after-jump="{policy}"' if policy is not None else "") + (
        f' times="{times}"' if times is not None else ""
    )
    return f'<barline location="{location}"><repeat direction="{direction}"{attrs}/></barline>'


def jump_measures(policy=None, times=None, kind="dc"):
    return [
        measure(0, {0: repeat("forward") + (sound('segno="S1"') if kind == "ds" else "")}),
        measure(1, {4: repeat("backward", policy, times)}),
        measure(2, {2: sound('fine="yes"')}),
        measure(3, {2: sound('dacapo="yes"' if kind == "dc" else 'dalsegno="S1"')}),
    ]


def dc_measures(coda_local=1):
    return [
        measure(0),
        measure(1, {2: sound('tocoda="C1"')}),
        measure(2),
        measure(3, {2: sound('dacapo="yes"')}),
        measure(4, {coda_local: sound('coda="C1"')}),
    ]


def ds_measures(coda_local=1):
    return [
        measure(0),
        measure(1, {1: sound('segno="S1"')}),
        measure(2, {1: sound('tocoda="C1"')}),
        measure(3, {3: sound('dalsegno="S1"')}),
        measure(4, {coda_local: sound('coda="C1"')}),
    ]


def dc_score(fine=True):
    return score(
        [
            measure(0),
            measure(1, {2: sound('fine="yes"')} if fine else {}),
            measure(2),
            measure(3, {2: sound('dacapo="yes"')}),
        ]
    )


def ds_score(fine=True):
    return score(
        [
            measure(0),
            measure(1, {1: sound('segno="S1"')}),
            measure(2, {2: sound('fine="yes"')} if fine else {}),
            measure(3, {3: sound('dalsegno="S1"')}),
        ]
    )


def boundary_tempos():
    return score(
        [
            measure(0, {0: repeat("forward") + sound('tempo="80"')}),
            measure(1, {4: sound('tempo="100"') + backward()}),
            measure(2),
        ]
    )


def volta_measures(total=2):
    back = "1" if total == 2 else "1,2"
    return [
        measure(0, {0: VISIBLE}),
        measure(
            1,
            {
                0: f'<barline location="left"><ending number="{back}" type="start"/></barline>',
                4: f'<barline location="right"><ending number="{back}" type="stop"/><repeat direction="backward"/></barline>',
            },
        ),
        measure(
            2,
            {
                0: f'<barline location="left"><ending number="{total}" type="start"/></barline>',
                4: f'<barline location="right"><ending number="{total}" type="discontinue"/></barline>',
            },
        ),
    ]


def distinctive_pitches(xml):
    import xml.etree.ElementTree as ET

    root = ET.fromstring(xml)
    steps = (
        ("C", 0),
        ("C", 1),
        ("D", 0),
        ("D", 1),
        ("E", 0),
        ("F", 0),
        ("F", 1),
        ("G", 0),
        ("G", 1),
        ("A", 0),
        ("A", 1),
        ("B", 0),
    )
    for index, m in enumerate(root.findall("./part/measure")):
        for local, note in enumerate(m.findall("note")):
            number = 48 + index * 5 + local
            step, alter = steps[number % 12]
            pitch = note.find("pitch")
            pitch.clear()
            ET.SubElement(pitch, "step").text = step
            if alter:
                ET.SubElement(pitch, "alter").text = str(alter)
            ET.SubElement(pitch, "octave").text = str(number // 12 - 1)
    return ET.tostring(root, encoding="unicode")


def score_measures(*measures, other=None):
    return score(measures, other)
