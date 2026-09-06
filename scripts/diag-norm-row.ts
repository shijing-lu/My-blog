import { readFileSync } from 'node:fs';
import { normalizeMathFences } from '../src/lib/mdx';
const lines = readFileSync('.diag/full-src/5d69ce83-0957-4b3b-a929-3c85ddc29f05_第3章_一元函数积分学（强化讲义）.md', 'utf8').split('\n');
const orig = lines[49];
const norm = normalizeMathFences(orig);
console.log('orig line50:', orig);
console.log('norm line50:', norm);
