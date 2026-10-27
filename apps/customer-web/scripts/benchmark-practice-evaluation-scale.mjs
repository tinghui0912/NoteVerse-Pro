import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw Error('SCALE_ARGUMENTS_INVALID');
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false,
  logLevel: 'error', resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  server: { middlewareMode: true, watch: null, hmr: false } });
try {
  const { runEvaluationScale } = await server.ssrLoadModule('/tests/research/practice-evaluation-scale/workload.ts');
  const cases = [];
  for (const size of [100, 500, 1000, 5000]) {
    const row = runEvaluationScale(size); cases.push(row);
    console.log(JSON.stringify({ ...row, assignment: undefined }));
  }
  const output = path.resolve(args[1] ?? 'artifacts/practice-evaluation-scale/report.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ schemaVersion: 1, benchmarkKind: 'CONTINUOUS_EVALUATION_SCALE', cases }) + '\n');
  console.log(`Report: ${output}`);
} finally { await server.close(); }
