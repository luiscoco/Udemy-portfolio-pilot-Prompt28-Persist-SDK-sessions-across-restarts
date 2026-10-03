import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this command through npm.');
const shared = ['contracts', 'domain', 'config', 'providers', 'observability', 'db', 'agent'];
const apps = ['web', 'api', 'worker'];
const command = process.argv[2];
if (!['build', 'build:types', 'typecheck', 'lint', 'test'].includes(command)) throw new Error(`Unknown command: ${command}`);
function run(script, name) {
  const result = spawnSync(process.execPath, [npmCli, 'run', script, `--workspace=@portfolio-pilot/${name}`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (command === 'build' || command === 'build:types' || command === 'typecheck') {
  for (const name of shared) run('build', name);
}
if (command !== 'build:types') {
  for (const name of command === 'build' ? apps : [...shared, ...apps]) run(command, name);
}
