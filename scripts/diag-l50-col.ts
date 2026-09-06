import { readFileSync } from 'node:fs';
import { normalizeMathFences } from '../src/lib/mdx';
const lines = readFileSync('.diag/full-src/5d69ce83-0957-4b3b-a929-3c85ddc29f05_第3章_一元函数积分学（强化讲义）.md', 'utf8').split('\n');
// 用整段归一化，定位行 5（=L50）
const seg = lines.slice(45, 60).join('\n');
const norm = normalizeMathFences(seg).split('\n');
console.log('norm 行 5:', JSON.stringify(norm[4]));
console.log('len:', norm[4]?.length);
const c = norm[4]?.[102];
console.log('col 103 char:', JSON.stringify(c));
console.log('col 103 上下文:', JSON.stringify(norm[4]?.slice(80, 120)));
