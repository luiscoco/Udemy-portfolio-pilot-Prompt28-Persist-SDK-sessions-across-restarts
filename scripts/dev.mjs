import { spawn } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run dev through npm so npm_execpath is available.');
const children = ['@portfolio-pilot/api', '@portfolio-pilot/web'].map((workspace) =>
  spawn(process.execPath, [npmCli, 'run', 'dev', `--workspace=${workspace}`], { stdio: 'inherit' })
);
let closing = false;
function close(signal = 'SIGTERM') {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill(signal);
}
process.on('SIGINT', () => close('SIGINT'));
process.on('SIGTERM', () => close());
for (const child of children) child.on('exit', (code) => {
  if (!closing) { process.exitCode = code || 1; close(); }
});
