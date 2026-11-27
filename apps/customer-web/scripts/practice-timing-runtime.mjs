import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Research-only TS execution uses the existing Vite dependency and the real @/ policy imports.
// No HTTP listener, application bootstrap, dataset download, or production config is involved.
export async function runTimingResearch(kind) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const server = await createServer({
    root, configFile: false, logLevel: 'error',
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    server: { middlewareMode: true, watch: null, hmr: false },
  });
  try {
    const { runResearchCommand } = await server.ssrLoadModule('/tests/research/practice-timing/command.ts');
    process.exitCode = await runResearchCommand(kind, process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'TIMING_RESEARCH_FAILED');
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}
