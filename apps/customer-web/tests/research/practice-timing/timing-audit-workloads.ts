import { PracticeTempoTimeline, beatsToMs } from '@/lib/practice/kernel/tempo';
import artifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { PerformanceClockRuntime } from '@/lib/practice/continuous/domain/performance-clock';
import { PracticeTimebase } from '@/lib/practice/kernel/timebase';
import { fixedTimeline, expectedPattern, patternFamilies, tempoGrid } from './policy-benchmark';
import type { SyntheticCase } from './research-report';
import { naturalTerminal, type AuditScenario, type AuditTarget, type AuditEvent } from './candidate-policies';

export function scenario(id:string,times:readonly number[],eventTimes:readonly number[],options:{ pitches?:readonly string[];eventPitches?:readonly string[];beats?:readonly number[];terminalMs?:number;ids?:readonly string[];groups?:readonly string[];scoreGroupOnsets?:number[] }={}):AuditScenario {
  const targets=times.map((time,i)=>({strikeId:options.ids?.[i]??`t${i}`,groupId:options.groups?.[i]??`g${i}`,pitch:options.pitches?.[i]??'C4',expectedPerformanceTimeMs:time,renderNoteIds:[],beatDurationMs:options.beats?.[i]??beatsToMs(1,120)}));
  const events=eventTimes.map((time,i)=>({id:`o${i}`,pitch:options.eventPitches?.[i]??'C4',timeMs:time}));
  return {id,targets,events,terminalMs:options.terminalMs??naturalTerminal(targets,events),scoreGroupOnsets:options.scoreGroupOnsets??[...new Set(times)]};
}
export function fromBaseline(c:SyntheticCase):AuditScenario {
  const timeline=fixedTimeline(c.bpm);
  const groups=c.variant==='MIDPOINT_PROBE'?[['C4'],['C4']]:patternFamilies[c.family as keyof typeof patternFamilies];
  const targets:AuditTarget[]=groups?expectedPattern(timeline,groups,c.spacingBeats).map(t=>({...t,beatDurationMs:c.beatDurationMs}))
    :c.observations.map(o=>({strikeId:o.intendedStrikeId,groupId:o.intendedStrikeId.split(':')[0],pitch:o.observedPitch,
      expectedPerformanceTimeMs:o.intendedPerformanceTimeMs,renderNoteIds:[],beatDurationMs:c.beatDurationMs}));
  const events:AuditEvent[]=c.observations.map(o=>({id:o.observationId,pitch:o.observedPitch,timeMs:o.observationPerformanceTimeMs}));
  return {id:c.caseId,targets,events,terminalMs:naturalTerminal(targets,events),scoreGroupOnsets:[...new Set(targets.map(t=>t.expectedPerformanceTimeMs))]};
}
export function adversarialScenarios():AuditScenario[] {
  const epsilon=1e-6; // Numerical boundary probe, not a timing tolerance.
  const transition=new PracticeTempoTimeline({selection:{mode:'SCORE'},segments:[
    {startBeat:0,bpm:80,source:'MUSICXML'},{startBeat:4,bpm:160,source:'MUSICXML'}]},12);
  const time=(beat:number)=>transition.beatToTimeMs(beat);
  return [
    scenario('isolated-far-event',[1000],[5000],{terminalMs:12000}),
    scenario('long-rest-between-C4',[1000,10000],[5000],{terminalMs:12000}),
    scenario('first-target-long-prerest',[10000,11000],[1000],{terminalMs:15000}),
    scenario('final-target-long-postrest',[1000,2000],[11000],{terminalMs:12000}),
    scenario('sparse-score',[1000,100000],[50000],{terminalMs:200000}),
    scenario('large-same-pitch-spacing',[1000,4000],[1100,3900]),
    scenario('touching-current-windows',[1000,1500],[1250]),
    scenario('overlapping-current-windows',[1000,1300],[1200]),
    scenario('very-fast-repeated',[1000,1060,1120,1180],[1030,1090,1150]),
    scenario('two-events-between-targets',[1000,1300],[1100,1200]),
    scenario('two-events-same-midpoint-cell',[1000,1250],[1100,1110]),
    scenario('one-event-competes',[1000,1300],[1150]),
    scenario('missing-first-played-second',[1000,1300],[1300]),
    scenario('played-first-missing-second',[1000,1300],[1000]),
    scenario('midpoint-left-epsilon',[1000,1300],[1150-epsilon]),
    scenario('midpoint-equality',[1000,1300],[1150]),
    scenario('midpoint-right-epsilon',[1000,1300],[1150+epsilon]),
    scenario('dense-chord-one-repeat',[1000,1000,1000,1200,1200,1200],[1100,1000,1000,1200,1200],
      {pitches:['C4','E4','G4','C4','F4','A4'],eventPitches:['C4','E4','G4','F4','A4'],groups:['a','a','a','b','b','b']}),
    scenario('tempo-transition-repeated',[time(3.9),time(4.1)],[time(4)],{beats:[beatsToMs(1,80),beatsToMs(1,160)]}),
    scenario('variable-beat-crossing-required',[1000,1250],[1500,1750],{beats:[beatsToMs(1,80),beatsToMs(1,240)]}),
    scenario('natural-terminal-clamp',[1000],[1050],{terminalMs:1100}),
    scenario('scope-begins-ends-mid-score',[0,500],[0,900],{terminalMs:1000,scoreGroupOnsets:[-500,0,500,1000,1500]}),
    scenario('id-tie-left-low',[1000,1300],[1150],{ids:['a','z']}),
    scenario('id-tie-right-low',[1000,1300],[1150],{ids:['z','a']}),
    scenario('greedy-cardinality-loss',[1000,1250],[800,1100]),
  ];
}
export function tempoScalingScenarios():AuditScenario[] {
  return tempoGrid.flatMap(bpm=>[0,0.2,0.5,0.8].map(offsetBeats=>{
    const timeline=fixedTimeline(bpm), beats=[4,5,6,7], targets=expectedPattern(timeline,[['C4'],['C4'],['C4'],['C4']],1);
    const events=beats.map((b,i)=>({id:`o${i}`,pitch:'C4',timeMs:timeline.beatToTimeMs(b+offsetBeats)}));
    const local=beatsToMs(1,timeline.bpmAtBeat(4));
    return {id:`tempo/${bpm}/${offsetBeats}`,targets:targets.map(t=>({...t,beatDurationMs:local})),events,
      terminalMs:timeline.beatToTimeMs(12),scoreGroupOnsets:targets.map(t=>t.expectedPerformanceTimeMs)};
  }));
}
/** Real reached-segment mapping: an immediate pause and resume count-in cannot retime performance evidence. */
export function pauseCoordinateExperiment() {
  let now=0;
  const source={domainId:'audit-clock',nowMs:()=>now};
  const timebase=new PracticeTimebase('audit-clock');
  const timeline=fixedTimeline(120);
  const clock=new PerformanceClockRuntime({clock:source,timebase,artifact:artifactJson as PracticeScoreArtifact,tempoPlan:timeline.plan,scope:{kind:'FULL'},countInBeats:0});
  return {clock,timebase,setNow:(n:number)=>{now=n;}};
}
