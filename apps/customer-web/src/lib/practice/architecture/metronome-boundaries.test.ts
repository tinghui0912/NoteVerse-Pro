import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
const root=path.resolve('src/lib/practice');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8');
const tree=(file:string)=>ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true);
function walk(node:ts.Node,visit:(node:ts.Node)=>void){visit(node);ts.forEachChild(node,child=>walk(child,visit));}
it('the session planner resolves one immutable metronome projection from admitted timing',()=>{
  const text=read('planning/session-plan.ts');expect(text).toContain('metronomePlan: ResolvedMetronomePlan');
  expect(text).toContain('metronomePlan: resolveMetronomePlan(');
  for(const projection of ['current.artifact.meterSegments','current.artifact.scoreEndBeat','current.scope.startBeat',
    'current.scope.terminalBeat','current.tempoPlan','intent.metronomeEnabled'])expect(text).toContain(projection);
});
it.each(['step/step-practice-controller.ts','continuous/continuous-practice-controller.ts'])('%s composes resolved plan and browser audio; sync commands remain local',file=>{
  const source=tree(file);let constructors=0;
  walk(source,node=>{if(ts.isNewExpression(node)&&node.expression.getText(source)==='MetronomeRuntime'){
    constructors++;expect(node.arguments?.[0].getText(source)).toBe('this.options.plan.metronomePlan');
    expect(node.arguments?.[1].getText(source)).toContain('this.platform.createMetronomeAudio(');
  }});expect(constructors).toBe(1);
});
it('runtime dependency surface is the resolved plan, audio port, tempo timeline and pure pulse planner',()=>{
  const source=tree('metronome/metronome-runtime.ts');
  const imports=source.statements.filter(ts.isImportDeclaration).map(node=>(node.moduleSpecifier as ts.StringLiteral).text).sort();
  expect(imports).toEqual(['./metronome-audio-port','./metronome-plan','./metronome-pulse-planner','@/lib/practice/kernel/tempo'].sort());
  const bindings:string[]=[];walk(source,node=>{if(ts.isTypeReferenceNode(node))bindings.push(node.typeName.getText(source));
    if(ts.isIdentifier(node)&&['window','AudioContext','Worker','React','PracticeScoreArtifact'].includes(node.text))throw new Error(`Unexpected runtime dependency ${node.text}`);});
  expect(bindings).toContain('ResolvedMetronomePlan');expect(bindings).toContain('MetronomeAudioPort');
  const port=tree('metronome/metronome-audio-port.ts');expect(port.statements.filter(ts.isImportDeclaration)).toHaveLength(0);
});
it('Web Audio implementation belongs to its browser adapter; causal taxonomy remains independent',()=>{
  const text=read('metronome/browser-metronome-audio.ts');
  for(const fact of ['AudioContextFailure','resumePracticeAudioContext','createOscillator','createGain',"ownership.kind === 'OWNED'",'released.close()'])expect(text).toContain(fact);
  const causal=tree('failure/causal-failure.ts');expect(causal.statements.filter(ts.isImportDeclaration)).toHaveLength(0);
});
it('pulse planning is a pure timing dependency',()=>{
  const source=tree('metronome/metronome-pulse-planner.ts');
  for(const node of source.statements.filter(ts.isImportDeclaration))expect((node.moduleSpecifier as ts.StringLiteral).text.startsWith('@/lib/practice/kernel/')).toBe(true);
});
