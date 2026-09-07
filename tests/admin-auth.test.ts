/**
 * 授权管理员权限体系纯函数测试
 * （normalizePermissions / checkTopPassword；不触库）
 */
import { describe, expect, it } from 'vitest';
import { checkTopPassword, normalizePermissions, topAdminPassword } from '../src/lib/admin-auth';

describe('normalizePermissions', () => {
  it('保留白名单权限键', () => {
    expect(normalizePermissions(['articles', 'moments'])).toEqual(['articles', 'moments']);
  });

  it('过滤非白名单键与非字符串', () => {
    expect(normalizePermissions(['articles', 'hacker', 123, null])).toEqual(['articles']);
  });

  it('去重', () => {
    expect(normalizePermissions(['nav', 'nav', 'docs'])).toEqual(['nav', 'docs']);
  });

  it('非数组输入返回空数组', () => {
    expect(normalizePermissions('articles')).toEqual([]);
    expect(normalizePermissions(null)).toEqual([]);
    expect(normalizePermissions(undefined)).toEqual([]);
  });
});

describe('checkTopPassword', () => {
  it('默认站主密码校验通过', () => {
    expect(topAdminPassword()).toBe('2640477581a');
    expect(checkTopPassword('2640477581a')).toBe(true);
  });

  it('错误密码拒绝', () => {
    expect(checkTopPassword('wrong-password')).toBe(false);
    expect(checkTopPassword('')).toBe(false);
  });
});
