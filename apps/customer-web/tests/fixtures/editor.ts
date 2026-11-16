import { importEditorMusicXml } from '@/lib/editor-musicxml';
export function editorXml(
  body: string = '',
  attributes: string = '<divisions>8</divisions><key><fifths>-2</fifths><mode>minor</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>',
) {
  return `<score-partwise version="4.0"><work><work-title>Source title</work-title></work><identification><creator type="composer">Composer</creator><rights>Preserved rights</rights></identification><credit><credit-type>subtitle</credit-type><credit-words>Subtitle</credit-words></credit><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes>${attributes}</attributes>${body}</measure></part></score-partwise>`;
}
export function note(
  id: string = 'n1',
  step: string = 'C',
  voice: number = 1,
  duration: number = 8,
  type: string = 'quarter',
) {
  return `<note id="${id}"><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${type}</type><staff>1</staff><lyric><text>Retain lyric</text></lyric></note>`;
}
export function editorDocument(body: string = note()) {
  return importEditorMusicXml(editorXml(body)).document;
}
