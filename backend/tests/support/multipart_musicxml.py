"""Two-part written-realization fixtures without channel-assignment repair."""


def multipart_musicxml(channels=None):
    names = []
    parts = []
    for index, program in enumerate((1, 41)):
        channel = "" if channels is None else f"<midi-channel>{channels[index]}</midi-channel>"
        names.append(
            f'<score-part id="P{index}"><part-name>Part {index}</part-name>'
            f'<score-instrument id="I{index}"><instrument-name>Instrument {index}</instrument-name></score-instrument>'
            f'<midi-instrument id="I{index}">{channel}<midi-program>{program}</midi-program>'
            "<volume>70</volume><pan>0</pan></midi-instrument></score-part>"
        )
        parts.append(
            f'<part id="P{index}"><measure number="1"><attributes><divisions>1</divisions>'
            "<time><beats>4</beats><beat-type>4</beat-type></time></attributes>"
            '<direction><sound dynamics="70"/></direction>'
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
