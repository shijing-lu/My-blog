import { migrateEndpoint } from './deployment-migration.mjs';

const endpoints = [
  ['primary', process.env.DATABASE_URL],
  ['fallback', process.env.DATABASE_URL_FALLBACK],
];
if (process.env.VERCEL === '1' && !/^postgres(ql)?:\/\//.test(endpoints[0][1] || '')) {
  throw new Error('Vercel production/preview build requires a real PostgreSQL DATABASE_URL');
}
for (const [name, url] of endpoints) {
  if (!url) { console.log(`[deployment-schema] ${name}: not configured`); continue; }
  if (!/^postgres(ql)?:\/\//.test(url)) {
    if (process.env.VERCEL === '1') throw new Error(`${name}: invalid PostgreSQL URL`);
    console.log(`[deployment-schema] ${name}: local SQLite, skip cloud migration`);
    continue;
  }
  // Fail the build if either configured endpoint cannot be upgraded and verified.
  await migrateEndpoint(name, url);
}
