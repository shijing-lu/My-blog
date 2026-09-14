/** 临时：WCAG 对比度校验（P2-19 修复前后对照） */
function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const [r, g, b] = c.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const l1 = lum(a);
  const l2 = lum(b);
  return Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
}
const cases = [
  // 现状
  ['cream-minimal 亮 fg vs bg', '#1c1b18', '#fbf8f2'],
  ['cream-minimal 亮 mutedFg vs bg', '#7d776b', '#fbf8f2'],
  ['cream-minimal 亮 mutedFg vs card', '#7d776b', '#ffffff'],
  ['cream-minimal 暗 mutedFg vs bg', '#96907f', '#1d1c19'],
  ['graphite 亮 fg vs bg', '#1a1d21', '#f4f6f8'],
  ['graphite 亮 mutedFg vs bg', '#6a747d', '#f4f6f8'],
  ['graphite 亮 mutedFg vs card', '#6a747d', '#ffffff'],
  ['graphite 暗 mutedFg vs bg', '#7f8b95', '#12161a'],
  // 候选修复值
  ['候选 cream 亮 muted #6f6a60 vs bg', '#6f6a60', '#fbf8f2'],
  ['候选 cream 亮 muted #6b665b vs card', '#6b665b', '#ffffff'],
  ['候选 graphite 亮 muted #5f6970 vs bg', '#5f6970', '#f4f6f8'],
];
for (const [n, a, b] of cases) {
  const r = ratio(a, b);
  console.log(`${n.padEnd(44)} ${r}  ${r >= 4.5 ? 'AA✓' : r >= 3 ? 'AA-large only' : 'FAIL'}`);
}
