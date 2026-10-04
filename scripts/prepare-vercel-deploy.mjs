/** Stage only project source; never include local data, env secrets or packaged runtimes. */
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const stage = mkdtempSync(path.join(tmpdir(), 'byqx-vercel-source-'));
for (const name of ['src', 'db', 'scripts', 'public', 'docs', 'desktop', 'build',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'astro.config.mjs', 'tsconfig.json',
  'drizzle.config.pg.ts', 'drizzle.config.sqlite.ts', '.gitignore', '.vercelignore', '.env.example']) {
  cpSync(path.join(root, name), path.join(stage, name), { recursive: true, filter: from => !from.endsWith('template.db') });
}
mkdirSync(path.join(stage, '.vercel'));
cpSync(path.join(root, '.vercel', 'project.json'), path.join(stage, '.vercel', 'project.json'));
console.log(stage);
