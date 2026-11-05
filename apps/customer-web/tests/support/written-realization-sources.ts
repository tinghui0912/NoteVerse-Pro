const attributes =
  '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const note = (
  id: string,
  options: { dynamics?: number; alter?: number; instrument?: string } = {}
) =>
  `<note id="${id}"${options.dynamics === undefined ? '' : ` dynamics="${options.dynamics}"`}><pitch><step>C</step>${options.alter === undefined ? '' : `<alter>${options.alter}</alter>`}<octave>4</octave></pitch><duration>2</duration>${options.instrument ? `<instrument id="${options.instrument}"/>` : ''}<type>half</type>${options.alter === 0.5 ? '<accidental>quarter-sharp</accidental>' : ''}</note>`;
const direction = (notation: string, sound = '') =>
  `<direction><direction-type>${notation}</direction-type>${sound}</direction>`;
function part(
  id: string,
  program: number,
  body: string,
  additionalInstrument = false
) {
  return {
    definition: `<score-part id="${id}"><part-name>${id}</part-name><score-instrument id="${id}I1"><instrument-name>Piano</instrument-name></score-instrument>${additionalInstrument ? `<score-instrument id="${id}I2"><instrument-name>Violin</instrument-name></score-instrument>` : ''}<midi-instrument id="${id}I1"><midi-channel>1</midi-channel><midi-program>${program}</midi-program></midi-instrument>${additionalInstrument ? `<midi-instrument id="${id}I2"><midi-channel>2</midi-channel><midi-program>41</midi-program></midi-instrument>` : ''}</score-part>`,
    body: `<part id="${id}"><measure number="1">${attributes}${body}</measure></part>`,
  };
}
function score(parts: ReturnType<typeof part>[]) {
  return `<score-partwise version="4.0"><part-list>${parts.map((p) => p.definition).join('')}</part-list>${parts.map((p) => p.body).join('')}</score-partwise>`;
}
const notes = note('n0') + note('n1');

export const writtenRealizationSources = {
  piano: score([part('P1', 1, notes)]),
  duet: score([
    part('P1', 1, notes),
    part('P2', 41, note('p2n0') + note('p2n1')),
  ]),
  dynamics: score([
    part('P1', 1, note('n0', { dynamics: 30 }) + note('n1', { dynamics: 90 })),
  ]),
  directionDynamics: score([
    part(
      'P1',
      1,
      direction('<dynamics><p/></dynamics>', '<sound dynamics="30"/>') +
        note('n0') +
        direction('<dynamics><f/></dynamics>', '<sound dynamics="90"/>') +
        note('n1')
    ),
  ]),
  pedal: score([
    part(
      'P1',
      1,
      direction('<pedal type="start" line="yes"/>') +
        notes +
        direction('<pedal type="stop" line="yes"/>')
    ),
  ]),
  microtonal: score([
    part('P1', 1, note('n0', { alter: 0.5 }) + note('n1', { alter: 0 })),
  ]),
  multipleInstruments: score([
    part(
      'P1',
      1,
      note('n0', { instrument: 'P1I1' }) +
        direction(
          '<words>Violin</words>',
          '<sound><midi-instrument id="P1I2"><midi-channel>2</midi-channel><midi-program>41</midi-program></midi-instrument></sound>'
        ) +
        note('n1', { instrument: 'P1I2' }),
      true
    ),
  ]),
};
