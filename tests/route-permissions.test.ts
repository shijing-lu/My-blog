import { describe, expect, it } from 'vitest';
import { pagePermission, requiredApiPermission } from '../src/lib/route-permissions';

describe('API 逐项权限边界', () => {
  it.each([
    ['/api/article-categories', 'GET', 'articles'],
    ['/api/article-categories', 'POST', 'articles'],
    ['/api/article-categories', 'PATCH', 'articles'],
    ['/api/article-categories', 'DELETE', 'articles'],
    ['/api/mindmaps', 'POST', 'articles'],
    ['/api/mindmaps/map-id', 'PUT', 'articles'],
    ['/api/mindmaps/map-id', 'DELETE', 'articles'],
    ['/api/mindmaps/map-id/refs', 'POST', 'articles'],
    ['/api/mindmaps/generate', 'POST', 'articles'],
    ['/api/site-css', 'GET', 'settings'],
    ['/api/site-css', 'PUT', 'settings'],
    ['/api/site-css', 'DELETE', 'settings'],
    ['/api/md-css', 'PUT', 'settings'],
    ['/api/md-css/library', 'GET', 'settings'],
    ['/api/md-css/library', 'POST', 'settings'],
    ['/api/md-css/library', 'PUT', 'settings'],
    ['/api/md-css/library', 'DELETE', 'settings'],
    ['/api/fonts', 'POST', 'settings'],
    ['/api/fonts/font-id', 'DELETE', 'settings'],
    ['/api/fonts/upload-url', 'POST', 'settings'],
    ['/api/fonts/record', 'POST', 'settings'],
    ['/api/fonts-settings', 'PUT', 'settings'],
    ['/api/fonts-settings', 'DELETE', 'settings'],
    ['/api/ui-style', 'PUT', 'settings'],
    ['/api/image-bed-settings', 'GET', 'settings'],
    ['/api/image-bed-settings', 'PUT', 'settings'],
    ['/api/image-bed-test', 'POST', 'settings'],
    ['/api/ai/config', 'GET', 'settings'],
    ['/api/ai/config', 'PUT', 'settings'],
    ['/api/ai/test', 'POST', 'settings'],
  ])('%s %s 需要 %s 权限（含尾斜杠形式）', (path, method, permission) => {
    expect(requiredApiPermission(path, method)).toEqual([permission]);
    expect(requiredApiPermission(path + '/', method)).toEqual([permission]);
  });

  it.each([
    ['/api/fonts', 'GET'],
    ['/api/fonts/font-id', 'GET'],
    ['/api/images/image-id', 'GET'],
    ['/api/mindmaps', 'GET'],
    ['/api/mindmaps/map-id', 'GET'],
    ['/api/doc', 'GET'],
    ['/api/doc/search', 'GET'],
    ['/api/doc/nodes/node-id/render', 'GET'],
    ['/api/doc/articles/article-id/render', 'GET'],
    ['/api/ai/chat', 'POST'],
    ['/api/editor-shortcuts', 'GET'],
    ['/api/ui-style', 'GET'],
    ['/api/desktop/object/images/example.png', 'GET'],
    ['/api/comments/comment-id', 'DELETE'],
  ])('%s %s 保留公开访问或端点自身按身份判定', (path, method) => {
    expect(requiredApiPermission(path, method)).toBeNull();
  });

  it('AI 记忆与总结仅允许站主', () => {
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      expect(requiredApiPermission('/api/ai/memory', method)).toBe('top');
    }
    expect(requiredApiPermission('/api/ai/summarize', 'POST')).toBe('top');
  });

  it('日记与日志接口仅允许站主，待办仍沿用日历权限', () => {
    for (const method of ['GET', 'POST']) {
      expect(requiredApiPermission('/api/diary', method)).toBe('top');
      expect(requiredApiPermission('/api/diary/', method)).toBe('top');
    }
    expect(requiredApiPermission('/api/diary/generate', 'POST')).toBe('top');
    expect(requiredApiPermission('/api/diary/source-dates', 'GET')).toBe('top');
    expect(requiredApiPermission('/api/todos', 'GET')).toEqual(['calendar']);
  });

  it('保留授权申请公开入口和管理端默认拒绝', () => {
    expect(requiredApiPermission('/api/admin-auth/applications', 'POST')).toBeNull();
    expect(requiredApiPermission('/api/admin-auth/login', 'POST')).toBeNull();
    expect(requiredApiPermission('/api/admin-auth/applications', 'GET')).toBe('top');
    expect(requiredApiPermission('/api/admin-auth/new-endpoint', 'POST')).toBe('top');
  });
});

describe('设置子页权限', () => {
  it.each(['ai', 'appearance', 'site-css', 'md-css', 'image-bed', 'sync', 'editor-shortcuts'])('%s 子页应允许 settings 管理员，无需 articles 权限', (section) => {
    expect(pagePermission('/admin/settings/' + section)).toEqual(['settings']);
    expect(pagePermission('/admin/settings/' + section + '/')).toEqual(['settings']);
  });

  it('网盘设置与网盘 API 使用同一权限', () => {
    expect(pagePermission('/admin/settings/netdisk')).toEqual(['netdisk']);
    expect(requiredApiPermission('/api/netdisk-settings', 'PUT')).toEqual(['netdisk']);
  });

  it('精确管理路径的尾斜杠不能绕过权限', () => {
    expect(pagePermission('/gallery/upload/')).toEqual(['photos']);
    expect(pagePermission('/admin/settings/')).toEqual(['settings']);
    expect(requiredApiPermission('/api/save-draft/', 'POST')).toEqual(['articles']);
  });
});
