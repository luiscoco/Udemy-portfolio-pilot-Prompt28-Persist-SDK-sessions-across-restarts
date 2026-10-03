import { spawnSync } from 'node:child_process';

const command = process.argv[2];
const commands = {
  start: ['up', '-d', '--wait'],
  stop: ['down'],
  status: ['ps'],
  inspect: ['ps', '--all']
};
if (command === 'reset') {
  if (process.argv[3] !== '--confirm-delete-volumes') {
    console.error('Volume reset deletes local PostgreSQL and Redis data. Re-run with --confirm-delete-volumes.');
    process.exit(2);
  }
} else if (!Object.hasOwn(commands, command) || process.argv.length !== 3) {
  console.error('Usage: node scripts/infra.mjs start|stop|status|inspect|reset [--confirm-delete-volumes]');
  process.exit(2);
}
const args = ['compose', '-f', 'compose.yaml', ...(command === 'reset' ? ['down', '--volumes'] : commands[command])];
const result = spawnSync('docker', args, { cwd: new URL('..', import.meta.url), stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) {
  console.error(`Docker could not start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
