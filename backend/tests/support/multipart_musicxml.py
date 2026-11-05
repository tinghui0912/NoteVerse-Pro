"""Two-part written-realization fixtures without channel-assignment repair."""

import xml.etree.ElementTree as ET

from tests.support.canonical_musicxml import VISIBLE, backward, measure, sound


def multipart_musicxml(channels=None):
    names = []
    parts = []
    for index, program in enumerate((1, 41)):
        channel = "" if channels is None else f"<midi-channel>{channels[index]}</midi-channel>"
        names.append(
            f'<score-part id="P{index}"><part-name>Part {index}</part-name>'
            f'<score-instrument id="I{index}"><instrument-name>Instrument {index}</instrument-name></score-instrument>'
            f'<midi-instrument id="I{index}">{channel}<midi-program>{program}</midi-program>'
            "</midi-instrument></score-part>"
        )
        parts.append(
            f'<part id="P{index}"><measure number="1"><attributes><divisions>1</divisions>'
            "<time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
            f'<note id="n{index}"><pitch><step>{"C" if index == 0 else "E"}</step><octave>4</octave></pitch>'
            "<duration>4</duration><type>whole</type></note></measure></part>"
        )
    return (
        '<score-partwise version="4.0"><work><work-title>Layout</work-title></work>'
        "<identification><rights>Copyright witness</rights></identification><part-list>"
        + "".join(names)
        + "</part-list>"
        + "".join(parts)
        + "</score-partwise>"
    )


def multipart_stream_musicxml(
    channels=None, *, same_pitch=False, navigation="linear", sustained=False
):
    """Distinct instruments with later onsets and optional shared navigation."""
    root = ET.fromstring(multipart_musicxml(channels))
    events = {
        "linear": [{}, {}],
        "repeat": [{0: VISIBLE}, {4: backward()}],
        "dc": [{}, {2: sound('fine="yes"')}, {}, {2: sound('dacapo="yes"')}],
        "ds": [
            {},
            {1: sound('segno="S1"')},
            {2: sound('fine="yes"')},
            {3: sound('dalsegno="S1"')},
        ],
    }[navigation]
    for part_index, part in enumerate(root.findall("part")):
        part.clear()
        part.set("id", f"P{part_index}")
        for index, markers in enumerate(events):
            m = ET.fromstring(measure(index, markers))
            for local, note in enumerate(m.findall("note")):
                note.set("id", f"p{part_index}m{index}n{local}")
                note.find("pitch/step").text = "C" if same_pitch or part_index == 0 else "E"
            if sustained:
                cursor = 0
                for child in list(m):
                    if child.tag == "note":
                        if cursor == 0:
                            child.find("duration").text = "4"
                            child.find("type").text = "whole"
                        else:
                            m.remove(child)
                        cursor += 1
                    elif child.tag == "sound" and cursor:
                        ET.SubElement(child, "offset").text = str(cursor - 4)
            part.append(m)
    return ET.tostring(root, encoding="unicode")
