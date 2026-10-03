import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { pruneRunWorkspaces } from '../src/agent-artifacts.js';

it('cleans only old marked run workspaces; preserves active and unrelated directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm28-cleanup-'));
  try {
    for (const name of ['turn-old123', 'turn-active123', 'turn-unrelated', 'other']) await mkdir(join(root, name));
    await writeFile(join(root, 'turn-old123', '.portfolio-run-workspace'), String(Date.now() - 86400001));
    await writeFile(join(root, 'turn-active123', '.portfolio-run-workspace'), String(Date.now()));
    await writeFile(join(root, 'other', '.portfolio-run-workspace'), '1');
    await pruneRunWorkspaces(root);
    expect((await readdir(root)).sort()).toEqual(['other', 'turn-active123', 'turn-unrelated']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
