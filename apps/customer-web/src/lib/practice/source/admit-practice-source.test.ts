import { beforeEach, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { admitPracticeSource } from './admit-practice-source';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ practiceApi: { getPracticeSource: request } }));
const envelope = () => ({ data: { source_id: 'source', artifact: structuredClone(fixture),
  notation: { musicxml: '<score />', mime_type: 'application/vnd.recordare.musicxml+xml' } } });
const load = (signal = new AbortController().signal) => admitPracticeSource(fixture.scoreId, fixture.revisionId, signal);
beforeEach(() => { request.mockReset().mockImplementation(async () => envelope()); });
it('fresh complete admission owns the exact returned references independently of cache', async () => {
  const response=envelope(), signal=new AbortController().signal;request.mockResolvedValue(response);
  const source=await load(signal);
  expect(request).toHaveBeenCalledExactlyOnceWith(fixture.scoreId,fixture.revisionId,true,signal);
  expect(source).toEqual({sourceId:'source',artifact:response.data.artifact,musicXml:'<score />'});
  expect(source.artifact).toBe(response.data.artifact);expect(Object.isFrozen(source.artifact)).toBe(true);expect(Object.isFrozen(source.artifact.notes[0])).toBe(true);expect(Object.isFrozen(source.artifact.moments)).toBe(true);
  request.mockResolvedValueOnce({...envelope(),data:{...envelope().data,source_id:'next'}});
  expect((await load()).sourceId).toBe('next'); expect(source.sourceId).toBe('source');expect(request).toHaveBeenCalledTimes(2);
});
it.each(['scoreId','revisionId'] as const)('rejects a mismatched %s',async field=>{
  const response=envelope();response.data.artifact[field]='wrong';request.mockResolvedValue(response);
  await expect(load()).rejects.toMatchObject({kind:'SOURCE',code:'INVALID_SCORE'});
});
it.each([undefined,'',1])('requires canonical source identity: %s',async source_id=>{
  request.mockResolvedValue({data:{...envelope().data,source_id}});
  await expect(load()).rejects.toMatchObject({kind:'SOURCE',code:'INVALID_SCORE'});
});
it.each([null,{musicxml:''},{musicxml:'   ',mime_type:'application/vnd.recordare.musicxml+xml'},
  {musicxml:'<score />',mime_type:'text/plain'}])('requires complete notation: %j',async notation=>{
  request.mockResolvedValue({data:{...envelope().data,notation}});
  await expect(load()).rejects.toMatchObject({kind:'SOURCE',code:'INVALID_SCORE'});
});
it('strict artifact admission rejects malformed canonical ownership',async()=>{
  request.mockResolvedValue({data:{...envelope().data,artifact:{...fixture,notes:[]}}});
  await expect(load()).rejects.toMatchObject({kind:'SOURCE',code:'INVALID_SCORE'});
});
it('keeps transport/service failures distinct from deterministic invalid Source',async()=>{
  const cause=new Error('transport');request.mockRejectedValue(cause);
  await expect(load()).rejects.toMatchObject({kind:'SOURCE',code:'LOAD_FAILED',cause});
  request.mockRejectedValue({code:'practice_score_invalid'});
  await expect(load()).rejects.toMatchObject({kind:'SOURCE',code:'INVALID_SCORE'});
});
it('caller cancellation reaches the actual transport and a late response cannot admit',async()=>{
  let resolve!:(value:ReturnType<typeof envelope>)=>void;
  request.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const command=new AbortController(),pending=load(command.signal).catch(error=>error);
  expect(request.mock.calls[0][3]).toBe(command.signal);command.abort();expect(request.mock.calls[0][3].aborted).toBe(true);
  resolve(envelope());expect(await pending).toBe(command.signal.reason);
  const next=new AbortController();request.mockResolvedValue(envelope());await load(next.signal);
  expect(request.mock.calls[1][3]).toBe(next.signal);expect(next.signal.aborted).toBe(false);
});
it('an already-aborted command starts no request',async()=>{
  const command=new AbortController();command.abort();await expect(load(command.signal)).rejects.toBe(command.signal.reason);
  expect(request).not.toHaveBeenCalled();
});
