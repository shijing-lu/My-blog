import sharp from 'sharp';
import {copyFile, mkdir} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const blog = resolve(project, '..');
const assets = join(project, 'dist', 'assets');
await mkdir(assets, {recursive: true});
const sources = [
  ['promo-film/public/assets/summit.png', 'summit.webp', 1800],
  ['promo-film/public/assets/lake.png', 'lake.webp', 1800],
  ['promo-film/public/assets/city.png', 'city.webp', 1000],
  ['outputs/promo-20261002/poster.png', 'poster.webp', 1920],
  ['outputs/promo-20261002/final-writing.png', 'writing.webp', 1600],
  ['outputs/promo-20261002/final-schedule.png', 'schedule.webp', 1600],
];
for (const [source, name, width] of sources) {
  await sharp(join(blog, source)).resize({width, withoutEnlargement: true}).webp({quality: 86}).toFile(join(assets, name));
}
await copyFile(join(blog, 'promo-film/public/assets/brand.png'), join(assets, 'brand.png'));
await copyFile(join(blog, 'LXGWWenKaiScreen.subset.woff2'), join(assets, 'WenKai.woff2'));
await copyFile(join(blog, 'node_modules/@fontsource/lora/files/lora-latin-700-normal.woff2'), join(assets, 'Lora.woff2'));
await mkdir(join(project, 'licenses'), {recursive: true});
await copyFile(join(blog, 'promo-film/public/fonts/LICENSES/WenKai.txt'), join(project, 'licenses/WenKai.txt'));
await copyFile(join(blog, 'node_modules/@fontsource/lora/LICENSE'), join(project, 'licenses/Lora.txt'));
console.log('Prepared website images, brand mark and local fonts.');
