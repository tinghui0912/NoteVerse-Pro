import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
const root=path.resolve('src/lib/practice');
const source=(file:string)=>ts.createSourceFile(file,readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function walk(node:ts.Node, visit:(node:ts.Node)=>void) { visit(node); ts.forEachChild(node, child=>walk(child,visit)); }
it('the causal taxonomy is independent of product modes and browser infrastructure',()=>{
  const tree=source('failure/causal-failure.ts');
  expect(tree.statements.filter(ts.isImportDeclaration)).toHaveLength(0);
  const union=tree.statements.find(node=>ts.isTypeAliasDeclaration(node)&&node.name.text==='PracticeCausalFailure') as ts.TypeAliasDeclaration;
  expect(union.type.getText(tree).split(' | ')).toEqual(['DeviceFailure','MidiFailure','AudioContextFailure','CaptureFailure','AcousticFailure','InferenceFailure','RecordingFailure','SourceFailure']);
});
it.each([['step/step-errors.ts','projectStepFailure'],['continuous/continuous-errors.ts','projectContinuousFailure']])('%s consumes only semantic causal fields in mode policy',(file,name)=>{
  const tree=source(file), fn=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name) as ts.FunctionDeclaration;
  expect(fn.parameters[0].type?.getText(tree)).toBe('PracticeCausalFailure');
  const semanticFields:string[]=[];
  walk(fn,node=>{ if(ts.isPropertyAccessExpression(node)&&node.expression.getText(tree)==='failure') semanticFields.push(node.name.text); });
  expect(semanticFields).toContain('kind'); expect(semanticFields).toContain('code');
  expect(semanticFields.every(field=>['kind','code','resource'].includes(field))).toBe(true);
});
it('domain and planning dependencies retain their own invariant owners',()=>{
  const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):entry.name.endsWith('.ts')&&!entry.name.endsWith('.test.ts')?[path.join(dir,entry.name)]:[]);
  for(const owner of ['score','session','step/domain','continuous/domain','result','planning']) for(const file of files(path.join(root,owner))) {
    const tree=source(path.relative(root,file));
    for(const node of tree.statements.filter(ts.isImportDeclaration)) if(ts.isStringLiteral(node.moduleSpecifier)) expect(node.moduleSpecifier.text).not.toContain('/failure/');
  }
});
it('execution views expose mode-owned application codes and presentation performs code projection',()=>{
  const tree=source('application/practice-execution-owner.ts');
  for(const [view,code] of [['StepView','StepApplicationErrorCode'],['ContinuousView','ContinuousErrorCode']]) {
    const node=tree.statements.find(node=>ts.isTypeAliasDeclaration(node)&&node.name.text===view)!;
    expect(node.getText(tree)).toContain(`inputError: ${code} | null`);
  }
  const statusFile=path.resolve('src/components/practice/practice-status.tsx'), text=readFileSync(statusFile,'utf8');
  expect(text).toContain('inputError?: PracticeExecutionErrorCode | null');
  const status=ts.createSourceFile(statusFile,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  walk(status,node=>{if(ts.isPropertyAccessExpression(node)&&node.expression.getText(status)==='inputError') expect(node.name.text).toBe('code');
    if(ts.isPropertyAssignment(node)&&node.name.getText(status)==='customMessage') expect(node.initializer.getText(status)).not.toBe('inputError');});
});
it.each(['step/step-practice-controller.ts','continuous/continuous-practice-controller.ts','application/practice-execution-owner.ts'])('%s branches on typed facts at catches',(file)=>{
  const tree=source(file), conditions:ts.Expression[]=[];
  walk(tree,node=>{if(ts.isIfStatement(node)||ts.isConditionalExpression(node)) conditions.push(ts.isIfStatement(node) ? node.expression : node.condition);});
  for(const condition of conditions) walk(condition,node=>{
    if(ts.isPropertyAccessExpression(node)&&['error','failure','cause','reason'].includes(node.expression.getText(tree))) expect(['kind','code','resource']).toContain(node.name.text);
  });
  expect(tree.statements.filter(ts.isImportDeclaration).some(node=>node.getText(tree).includes('isPracticeCausalFailure'))).toBe(true);
});
