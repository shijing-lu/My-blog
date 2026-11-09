import { serverEnv } from './env';

/** Sync needs a persistent SQLite server, including locally hosted Web. */
export function supportsCloudSync(): boolean {
  const url = serverEnv('DATABASE_URL', 'file:./data/blog.db');
  return serverEnv('VERCEL') !== '1' && !/^postgres(?:ql)?:/i.test(url) && !url.includes(':memory:');
}
