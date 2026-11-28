// @vitest-environment jsdom
import {it} from 'vitest';
import {readFileSync} from 'node:fs';
import {EditorSession} from './session';
it('collaboration fixture supports editing',()=>{new EditorSession().loadMusicXml(readFileSync('tests/fixtures/collaboration.musicxml','utf8'))});
