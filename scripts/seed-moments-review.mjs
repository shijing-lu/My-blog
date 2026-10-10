import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const out = path.resolve('outputs/moments-workspace');
const server = JSON.parse(fs.readFileSync(path.join(out, 'server.json'), 'utf8'));
assert.equal(server.databasePath, path.join(out, 'test.db'));
const base = `http://127.0.0.1:${server.port}`;
const existing = path.join(out, 'fixtures.json');
if (fs.existsSync(existing)) { console.log('Existing isolated Moments fixtures retained'); process.exit(0); }
const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'article-review-local' }) });
assert.ok(login.ok);
const cookie = login.headers.get('set-cookie').split(';')[0];
const fixture = {};
const media = [{ type: 'image', url: '/images/neobrutalism/cat-peek.webp' }, { type: 'image', url: '/images/neobrutalism/cat-rest.webp' }];
const records = [
  ['text', { content: '记录走过的路，留住一点向前的勇气。\n\n**今天也把一件小事做好。** 本条为隔离验收示例。', tags: ['验收示例', '日常'], media: [] }],
  ['grid', { content: '把喜欢的小猫收进今天的相册。\n\n这是本地测试图片网格，图片使用首页同源素材。', tags: ['验收示例', '图片'], media }],
  ['single', { content: '一张图片，也可以记录一整个午后。', tags: ['验收示例'], media: media.slice(0, 1) }],
  ['long', { content: '## 长内容与扩展语法\n\n' + '认真记录，慢慢积累。'.repeat(130) + '\n\n> 在平凡日子里留下自己的脚印。\n\n```js\nconst moment = "today";\n```', tags: ['验收示例', '较长的标签测试'], media: [] }],
  ['private', { content: 'PRIVATE_MOMENT_REVIEW_SENTINEL\n\n私密验收示例，仅管理员可见。', tags: ['仅私密标签'], media: [], visibility: 'private' }],
  ['video', { content: '视频与图片失败状态验收示例。', tags: ['验收示例'], media: [{ type: 'video', url: 'https://example.invalid/review.mp4' }, { type: 'image', url: '/images/missing-moment-review.webp' }] }],
];
const database = new Database(server.databasePath);
try {
  for (let i = 0; i < 23; i++) records.push(['page-' + i, { content: `分页验收示例 ${i + 1}：记录一点生活。`, tags: ['分页验收'], media: [] }]);
  for (const [name, payload] of records) {
    const response = await fetch(base + '/api/moments', { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    assert.ok(response.ok, await response.clone().text());
    fixture[name] = (await response.json()).moment.id;
    // Distinct days exercise full-data timeline and pagination, without changing real records.
    const index = records.findIndex(record => record[0] === name);
    const created = Date.now() - index * 86400000;
    database.prepare('UPDATE moments SET created_at=?, updated_at=? WHERE id=?').run(created, created, fixture[name]);
  }
} finally { database.close(); }
fs.writeFileSync(existing, JSON.stringify(fixture, null, 2));
console.log('Seeded 29 isolated Moments fixtures: text/media/private/long content/pagination');
