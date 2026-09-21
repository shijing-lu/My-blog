/**
 * admin-auth-render 测试（匹配 vitest 的 tests/**\/*.test.ts）
 *
 * /admin/auth 原本把两块列表内联在 Astro 模板里，只能服务端渲染，于是每次审批 / 保存权限 /
 * 升降级 / 移除都整页刷新。该页典型用法是「逐行勾好权限、再逐个点同意」，整页刷新会把
 * 其它行里刚勾好、还没提交的权限全部抹掉。
 *
 * 抽成同构模块后客户端只重绘受影响的那块列表（配合 auth.astro 的快照/回贴保住勾选态）。
 * 这里锁住四条契约：
 * 1. 行上的数据属性齐全（客户端委托点击、快照勾选态全靠它们定位）；
 * 2. 空态由本模块输出（客户端整体重绘容器，模板里的空态会被覆盖掉）；
 * 3. 角色分支与模板一致：top 无权限勾选、只有降级/移除；admin 有勾选、带 checked 与保存/提升/移除；
 * 4. 特殊字符被转义、标签开闭配平。
 */
import { describe, it, expect } from 'vitest';
import { authAccList, authAppList } from '../src/lib/admin-auth-render';
import type { AuthAccountRenderable, AuthApplicationRenderable, PermEntries } from '../src/lib/admin-auth-render';

const PERMS: PermEntries = [
  ['articles', '文章与写作'],
  ['docs', '文档系统'],
  ['nav', '网址导航'],
];

const APPS: AuthApplicationRenderable[] = [
  { id: 'a1', login: 'octocat', name: 'The Octocat', avatarUrl: 'https://x/a.png', note: '想写文章' },
  { id: 'a2', login: 'noavatar', name: '', avatarUrl: '', note: '' },
];

const ACCOUNTS: AuthAccountRenderable[] = [
  { id: 'u1', login: 'top1', name: 'Top One', avatarUrl: 'https://x/t.png', role: 'top', permissions: [] },
  { id: 'u2', login: 'adm1', name: 'Admin One', avatarUrl: '', role: 'admin', permissions: ['docs'] },
];

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

/** 标签开闭配平粗检（本模块产出的都是非自闭合标签） */
function assertBalanced(html: string): void {
  for (const tag of ['div', 'span', 'p', 'label', 'button']) {
    const open = count(html, new RegExp(`<${tag}[\\s>]`, 'g'));
    const close = count(html, new RegExp(`</${tag}>`, 'g'));
    expect(open, `${tag} 标签开闭数应相等`).toBe(close);
  }
}

describe('authAppList', () => {
  const html = authAppList(APPS, PERMS);

  it('每行带 data-app-id（客户端定位行用）', () => {
    expect(html).toContain('data-app-id="a1"');
    expect(html).toContain('data-app-id="a2"');
    expect(count(html, /data-app-id="/g)).toBe(2);
  });

  it('有头像才输出 <img>，无头像不输出', () => {
    expect(count(html, /<img /g)).toBe(1);
    expect(html).toContain('src="https://x/a.png"');
  });

  it('姓名回退到 login（name 为空时显示 @login 而非空白）', () => {
    expect(html).toContain('>The Octocat</p>');
    expect(html).toContain('>@octocat</p>');
    // a2 的 name 是空串 → 标题回退为 login
    expect(html).toContain('>noavatar</p>');
    expect(html).toContain('>@noavatar</p>');
  });

  it('有备注才输出备注段', () => {
    expect(html).toContain('想写文章');
    expect(count(html, /class="mt-2 text-sm text-muted-foreground"/g)).toBe(1);
  });

  it('每行都带「待审」标记与同意/拒绝按钮', () => {
    expect(count(html, /待审/g)).toBe(2);
    expect(count(html, /data-action="approve"/g)).toBe(2);
    expect(count(html, /data-action="reject"/g)).toBe(2);
  });

  it('每行渲染全部权限项，且申请行的勾选一律未选中', () => {
    expect(count(html, /data-app-perm=/g)).toBe(APPS.length * PERMS.length);
    expect(count(html, /checked/g)).toBe(0);
  });

  it('空列表只输出空态', () => {
    const empty = authAppList([], PERMS);
    expect(empty).toContain('暂无待审申请。');
    expect(empty).not.toContain('data-app-id=');
    assertBalanced(empty);
  });

  it('标签配平，且用户可控字段被转义', () => {
    const evil = authAppList(
      [{ id: 'x"><b', login: 'l"><i', name: '<script>a</script>', avatarUrl: '"><svg onload=1>', note: '<img src=x>' }],
      PERMS,
    );
    expect(evil).not.toContain('<script>');
    expect(evil).not.toContain('<img src=x>');
    expect(evil).not.toContain('"><svg');
    expect(evil).toContain('&lt;script&gt;');
    assertBalanced(html);
    assertBalanced(evil);
  });
});

describe('authAccList', () => {
  const html = authAccList(ACCOUNTS, PERMS);

  it('每行带 data-acc-id', () => {
    expect(html).toContain('data-acc-id="u1"');
    expect(html).toContain('data-acc-id="u2"');
    expect(count(html, /data-acc-id="/g)).toBe(2);
  });

  it('角色徽标按 role 区分文案与配色', () => {
    expect(html).toContain('顶级管理员');
    expect(html).toContain('普通管理员');
    expect(html).toContain('bg-primary text-primary-foreground');
    expect(html).toContain('bg-muted text-muted-foreground');
  });

  it('top 角色：不渲染权限勾选，只有降级/移除', () => {
    const topOnly = authAccList([ACCOUNTS[0]!], PERMS);
    expect(topOnly).not.toContain('data-acc-perm=');
    expect(topOnly).toContain('data-action="demote"');
    expect(topOnly).toContain('data-action="remove"');
    expect(topOnly).not.toContain('data-action="save"');
    expect(topOnly).not.toContain('data-action="promote"');
    expect(topOnly).toContain('顶级管理员自动拥有全部权限');
  });

  it('admin 角色：渲染权限勾选 + 保存/提升/移除', () => {
    const adminOnly = authAccList([ACCOUNTS[1]!], PERMS);
    expect(count(adminOnly, /data-acc-perm=/g)).toBe(PERMS.length);
    expect(adminOnly).toContain('data-action="save"');
    expect(adminOnly).toContain('data-action="promote"');
    expect(adminOnly).toContain('data-action="remove"');
    expect(adminOnly).not.toContain('data-action="demote"');
  });

  it('checked 精确对应已授权的权限项（不选中其它项）', () => {
    const adminOnly = authAccList([ACCOUNTS[1]!], PERMS);
    expect(count(adminOnly, /checked/g)).toBe(1);
    // 命中的那一项带 checked
    expect(adminOnly).toMatch(/data-acc-perm="docs"\s+checked/);
    // 未授权的项不带 checked
    expect(adminOnly).toMatch(/data-acc-perm="articles"\s+class=/);
    expect(adminOnly).toMatch(/data-acc-perm="nav"\s+class=/);
  });

  it('权限为空集时一个都不勾', () => {
    const none = authAccList([{ ...ACCOUNTS[1]!, permissions: [] }], PERMS);
    expect(count(none, /checked/g)).toBe(0);
  });

  it('空列表只输出空态', () => {
    const empty = authAccList([], PERMS);
    expect(empty).toContain('暂无 GitHub 授权管理员');
    expect(empty).not.toContain('data-acc-id=');
    assertBalanced(empty);
  });

  it('标签配平，且用户可控字段被转义', () => {
    const evil = authAccList(
      [{ id: 'x"><b', login: 'l"><i', name: '<script>a</script>', avatarUrl: '', role: 'admin', permissions: ['docs'] }],
      PERMS,
    );
    expect(evil).not.toContain('<script>');
    expect(evil).toContain('&lt;script&gt;');
    assertBalanced(html);
    assertBalanced(evil);
  });
});
