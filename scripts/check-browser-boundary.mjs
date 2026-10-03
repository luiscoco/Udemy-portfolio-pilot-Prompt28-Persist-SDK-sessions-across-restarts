import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const blocked = /(?:^|\/)(?:agent|db|server)(?:\/|$)|^@prisma\/|^prisma$|^@anthropic-ai\/|^node:|^next$/;
const seen = new Set();
function manifest(name) {
  const location = name === '@portfolio-pilot/web' ? 'apps/web' : `packages/${name.split('/')[1]}`;
  return JSON.parse(readFileSync(resolve(root, location, 'package.json'), 'utf8'));
}
function visit(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const pkg = manifest(name);
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    if (blocked.test(dependency)) throw new Error(`Browser dependency violation: ${name} -> ${dependency}`);
    if (dependency.startsWith('@portfolio-pilot/')) visit(dependency);
  }
}
visit('@portfolio-pilot/web');
console.log(`Browser workspace dependency graph clean: ${[...seen].join(', ')}`);
