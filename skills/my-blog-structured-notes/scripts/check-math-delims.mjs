#!/usr/bin/env node
/**
 * 公式定界符专查：找出**裸露**的 LaTeX（漏写 $…$ / $$…$$ 定界符）。
 *
 * 为什么需要：漏写定界符时，`renderMdx` 往往**不报错**——花括号内容恰好是合法 JS
 * （`\frac{1}{2}` 的 `{1}` `{2}`）时会被求值成数字，公式静默错乱；内容是标识符
 * （`{bmatrix}` `{cases}`）时才报 `ReferenceError: bmatrix is not defined`。
 * 「能跑通」≠「公式正确」，必须单独扫一遍。
 *
 * 用法：node check-math-delims.mjs <笔记.md> [更多.md...]
 * 退出码：0 = 无裸露 LaTeX；1 = 有问题（同时打印行号）。
 */
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法：node check-math-delims.mjs <笔记.md> [更多.md...]');
  process.exit(2);
}

/** 需要 $…$ / $$…$$ 包裹的 LaTeX 命令（覆盖教材与讲义常见写法）。 */
const LATEX_COMMANDS = [
  'begin', 'end', 'frac', 'dfrac', 'tfrac', 'sqrt', 'sum', 'prod', 'int', 'oint', 'iint',
  'lim', 'limits', 'infty', 'partial', 'nabla', 'cdot', 'times', 'div', 'pm', 'mp',
  'le', 'leq', 'ge', 'geq', 'neq', 'approx', 'equiv', 'propto', 'sim', 'subset', 'subseteq',
  'supset', 'supseteq', 'cup', 'cap', 'in', 'notin', 'forall', 'exists', 'neg', 'lnot',
  'land', 'lor', 'wedge', 'vee', 'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon',
  'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi',
  'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta',
  'Theta', 'Lambda', 'Xi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega', 'left', 'right', 'big',
  'Big', 'bigg', 'Bigg', 'quad', 'qquad', 'text', 'textbf', 'textit', 'mathrm', 'mathbf',
  'mathbb', 'mathcal', 'mathfrak', 'operatorname', 'overline', 'underline', 'hat', 'bar',
  'tilde', 'vec', 'dot', 'ddot', 'angle', 'perp', 'parallel', 'ldots', 'cdots', 'vdots',
  'ddots', 'mid', 'nmid', 'to', 'mapsto', 'rightarrow', 'leftarrow', 'Rightarrow',
  'Leftrightarrow', 'leftrightarrow', 'langle', 'rangle', 'lfloor', 'rfloor', 'lceil',
  'rceil', 'lvert', 'rvert', 'lVert', 'rVert', 'operatorname', 'colon',
];

/** 常见环境名（`\begin{xxx}` 的 xxx）——花括号内容是它们时整篇会崩。 */
const ENVIRONMENTS = [
  'cases', 'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'array',
  'aligned', 'alignedat', 'gathered', 'split', 'equation', 'equation*', 'align', 'align*',
  'multline', 'multline*', 'gather', 'gather*', 'flalign', 'smallmatrix', 'subarray',
  'dcases', 'rcases', 'substack', 'cases*',
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mask = (text) => text.replace(/[^\n]/g, ' ');

/** 计算一行内受保护区间（行内代码 + 行内公式）。 */
function inlineRanges(line) {
  const ranges = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '`') {
      let ticks = 0;
      while (line[i + ticks] === '`') ticks += 1;
      const fence = '`'.repeat(ticks);
      const end = line.indexOf(fence, i + ticks);
      const stop = end === -1 ? line.length : end + ticks;
      ranges.push([i, stop]);
      i = stop;
      continue;
    }
    if (ch === '\\') { i += 2; continue; }
    if (ch === '$') {
      const isBlock = line[i + 1] === '$';
      const delim = isBlock ? '$$' : '$';
      const start = i;
      let j = i + delim.length;
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line.startsWith(delim, j)) break;
        j += 1;
      }
      if (j >= line.length) {
        ranges.push([start, line.length]);
        i = line.length;
        continue;
      }
      ranges.push([start, j + delim.length]);
      i = j + delim.length;
      continue;
    }
    i += 1;
  }
  return ranges;
}

/**
 * 逐行扫描全文，产出「遮罩后」的行数组：受保护区（代码围栏、块级公式、行内公式、
 * 行内代码）全部替换为空格，保留行结构。随后在遮罩文本上找裸露 LaTeX。
 *
 * 引用块（`> ` 前缀）里的围栏与块级公式同样要识别：技能规定 `> $$ … > $$`
 * 是引用块内块级公式的唯一写法，不能因为前缀就漏判。
 */
function maskProtected(text) {
  const lines = text.split(/\r?\n/);
  const masked = [];
  let inFence = false;
  let fenceMarker = '';
  let inBlockMath = false;
  const problems = [];
  let mathOpenLine = 0;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const quote = /^(\s*(?:>\s?)+)/.exec(line);
    const offset = quote ? quote[1].length : 0;
    const body = line.slice(offset);
    const fenceMatch = /^[ \t]*(`{3,}|~{3,})/.exec(body);

    if (inFence) {
      masked.push(mask(line));
      if (fenceMatch && fenceMarker && fenceMatch[1][0] === fenceMarker[0]) {
        inFence = false;
        fenceMarker = '';
      }
      return;
    }
    if (fenceMatch) {
      inFence = true;
      fenceMarker = fenceMatch[1][0].repeat(3);
      masked.push(mask(line));
      return;
    }
    if (inBlockMath) {
      masked.push(mask(line));
      if (body.includes('$$')) inBlockMath = false;
      return;
    }
    if (body.trim() === '$$') {
      inBlockMath = true;
      mathOpenLine = lineNo;
      masked.push(mask(line));
      return;
    }
    const ranges = inlineRanges(body).map(([start, end]) => [start + offset, end + offset]);
    const chars = [...line];
    for (const [start, end] of ranges) {
      for (let i = start; i < end && i < chars.length; i += 1) chars[i] = ' ';
    }
    masked.push(chars.join(''));
  });

  if (inFence) problems.push({ line: 0, text: '存在未闭合的代码围栏' });
  if (inBlockMath) problems.push({ line: mathOpenLine, text: '存在未闭合的 $$ 块级公式' });
  return { masked, problems };
}

const inRanges = (index, ranges) => ranges.some(([start, end]) => index >= start && index < end);

function scanFile(text) {
  const { masked, problems } = maskProtected(text);
  const lines = masked;
  const findings = [];
  const commandRe = new RegExp(`\\\\(${LATEX_COMMANDS.map(escapeRegExp).join('|')})(?![A-Za-z])`, 'g');
  const envRe = new RegExp(`\\{\\s*(${ENVIRONMENTS.map(escapeRegExp).join('|')})\\s*\\}`, 'g');
  lines.forEach((line, index) => {
    let match;
    commandRe.lastIndex = 0;
    while ((match = commandRe.exec(line))) {
      findings.push({ line: index + 1, column: match.index + 1, text: match[0], kind: 'command' });
    }
    envRe.lastIndex = 0;
    while ((match = envRe.exec(line))) {
      findings.push({ line: index + 1, column: match.index + 1, text: match[0], kind: 'environment' });
    }
  });
  return { findings, problems };
}

let failed = false;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    console.error(`无法读取 ${file}：${error.message}`);
    failed = true;
    continue;
  }
  const { findings, problems } = scanFile(text);
  if (!findings.length && !problems.length) {
    console.log(`✅ ${file}：未发现裸露 LaTeX，定界符与围栏完整`);
    continue;
  }
  failed = true;
  console.log(`❌ ${file}：发现 ${findings.length} 处裸露 LaTeX`);
  for (const hit of findings.slice(0, 40)) {
    const kind = hit.kind === 'environment' ? '（裸环境名，整篇会崩）' : '';
    console.log(`   第 ${hit.line} 行 第 ${hit.column} 列：${hit.text}${kind}`);
  }
  if (findings.length > 40) console.log(`   …另有 ${findings.length - 40} 处未列出`);
  for (const problem of problems) console.log(`   ⚠ 第 ${problem.line || '?'} 行：${problem.text}`);
}
process.exit(failed ? 1 : 0);
