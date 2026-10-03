import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { getDatabase, closeConnections } from '../packages/db/dist/index.js';
import { seedDemo } from '../packages/db/dist/seed.js';
const url = process.env.AGENT_JOBS_TEST_DATABASE_URL;
assert.equal(new URL(url ?? '').pathname, '/portfolio_m27_verify'); assert.equal(new URL(url).hostname, '127.0.0.1');
const env = { ...process.env, DATABASE_URL: url, DATA_MODE: 'mock', AGENT_MODE: 'mock', NODE_ENV: 'development', DEMO_AUTH_ENABLED: 'true', AUTH_BASE_URL: 'http://127.0.0.1:5173', AUTH_SECRET: 'milestone-27-local-browser-fixture-secret', REDIS_URL: 'redis://127.0.0.1:6379', AGENT_DAILY_BUDGET_USD: '100' };
const children = [];
function launch(args, cwd, stdio = 'ignore') { const child = spawn(process.execPath, args, { env, cwd, windowsHide: true, stdio }); children.push(child); return child; }
const root = fileURLToPath(new URL('../', import.meta.url));
async function ready(url) { for (let n=0;n<100;n++) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(100); } throw new Error('Server not ready'); }
try {
 await seedDemo(await getDatabase(url));
 launch([fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), 'start','--hostname','127.0.0.1','--port','3001'], fileURLToPath(new URL('../apps/api', import.meta.url)));
 launch([fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), '--host','127.0.0.1','--port','5173'], fileURLToPath(new URL('../apps/web', import.meta.url)));
 await ready('http://127.0.0.1:3001/api/health/live'); await ready('http://127.0.0.1:5173/');
 const tests = launch([fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)), 'test','--config','apps/web/playwright.config.ts','durable-workers.spec.ts','--workers=1'], root, 'inherit');
 await once(tests,'exit'); assert.equal(tests.exitCode,0);
} finally {
 for (const child of children) if (child.exitCode === null && child.signalCode === null) { const exited = once(child,'exit'); child.kill(); await exited; }
 await closeConnections();
}
