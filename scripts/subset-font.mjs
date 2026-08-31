/**
 * 字体子集化脚本：把大字体（如全量中文字体）压成常用汉字子集 woff2（几百 KB）
 * 用法：
 *   node scripts/subset-font.mjs <字体文件.woff2|ttf|otf> [扩展字符]
 * 例：
 *   node scripts/subset-font.mjs ./my-font.ttf
 *   node scripts/subset-font.mjs ./my-font.otf "乙尧舜禹"
 * 输出：同目录 <原文件名>.subset.woff2
 *
 * 安装依赖：pnpm add -D subset-font（已装）
 */
import subsetFont from 'subset-font';
import fs from 'node:fs';

// 常用汉字 + 常用标点（GB2312 一级 3755 + 常用二级 + 数字字母 + 常用符号），约 5000 字
// 覆盖日常文章 99%；生僻字会回落到系统字体
const BASE_CHARS =
  '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞'
  + '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  + '，。！？；：、（）【】《》「」『』“”‘’·—…％·．';

const input = process.argv[2];
const extraChars = process.argv[3] ?? '';
if (!input) {
  console.error('用法: node scripts/subset-font.mjs <字体文件.woff2|ttf|otf> [扩展字符]');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error('找不到文件: ' + input);
  process.exit(1);
}

const text = BASE_CHARS + (extraChars ?? '');
const buf = fs.readFileSync(input);
const out = input.replace(/\.[^.]+$/, '') + '.subset.woff2';

try {
  const subset = await subsetFont(buf, text, { targetFormat: 'woff2' });
  fs.writeFileSync(out, subset);
  console.log(`✅ 子集化完成: ${out}  (${Math.round(subset.length / 1024)} KB，原 ${Math.round(buf.length / 1024 / 1024)}MB)`);
  console.log('把这个 .subset.woff2 上传到设置页即可');
} catch (err) {
  console.error('子集化失败: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
