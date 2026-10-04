import { performance } from 'node:perf_hooks';
import { clearRenderCache, renderMdx } from '../src/lib/mdx';

// 合成正文；不读取数据库，不调用外部服务。对比独立编译与共享编译相同内容的工作量。
const source = Array.from({ length: 35 }, (_, i) => `## 小节 ${i}\n\n一段用于性能基准的文章正文。公式 $x^2 + y^2 = 1$。\n\n| 项目 | 内容 |\n| --- | --- |\n| 测试 | 渲染 |`).join('\n\n');
await renderMdx('预热 $x$');
clearRenderCache();
let start = performance.now();
const separate = await Promise.all(Array.from({ length: 8 }, () => renderMdx(source, { components: {} })));
const separateMs = performance.now() - start;
clearRenderCache();
start = performance.now();
const shared = await Promise.all(Array.from({ length: 8 }, () => renderMdx(source)));
const sharedMs = performance.now() - start;
start = performance.now();
await renderMdx(source);
const cachedMs = performance.now() - start;
if (separate.some(result => result.html !== shared[0]?.html)) throw new Error('基准输出不同');
console.log(JSON.stringify({ sourceChars: source.length, concurrentRequests: 8, independentResults: new Set(separate).size, sharedResults: new Set(shared).size, separateMs: +separateMs.toFixed(2), sharedMs: +sharedMs.toFixed(2), cachedMs: +cachedMs.toFixed(2) }, null, 2));
