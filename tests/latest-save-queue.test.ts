import { describe, expect, it, vi } from 'vitest';
import { createLatestSaveQueue } from '../src/lib/latest-save-queue';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('自动保存串行队列', () => {
  it('请求期间继续输入，等待最新版本保存完才结束', async () => {
    let content = '第一版';
    const first = deferred();
    const second = deferred();
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const queue = createLatestSaveQueue(() => content, write);
    const pending = queue.flush();
    expect(write).toHaveBeenCalledWith('第一版');
    content = '第二版';
    const concurrent = queue.flush();
    expect(concurrent).toBe(pending);
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.resolve();
    expect(write).toHaveBeenLastCalledWith('第二版');
    second.resolve();
    await expect(pending).resolves.toBe('第二版');
  });

  it('合并请求期间多次改动，只写最终内容', async () => {
    let content = 'a';
    const first = deferred();
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const queue = createLatestSaveQueue(() => content, write);
    const pending = queue.flush();
    content = 'ab';
    queue.flush();
    content = 'abc';
    first.resolve();
    await expect(pending).resolves.toBe('abc');
    expect(write.mock.calls.map(([value]) => value)).toEqual(['a', 'abc']);
  });

  it('后续版本保存失败时保留失败结果，并允许重试最新内容', async () => {
    let content = '旧内容';
    const first = deferred();
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockRejectedValueOnce(new Error('离线')).mockResolvedValue(undefined);
    const queue = createLatestSaveQueue(() => content, write);
    const pending = queue.flush();
    content = '新内容';
    first.resolve();
    await expect(pending).rejects.toThrow('离线');
    await expect(queue.flush()).resolves.toBe('新内容');
    expect(write.mock.calls.map(([value]) => value)).toEqual(['旧内容', '新内容', '新内容']);
  });

  it('完成后可开始新的保存，未改动内容不会额外续写', async () => {
    let content = '';
    const write = vi.fn().mockResolvedValue(undefined);
    const queue = createLatestSaveQueue(() => content, write);
    await expect(queue.flush()).resolves.toBe('');
    content = '新增';
    await expect(queue.flush()).resolves.toBe('新增');
    expect(write).toHaveBeenCalledTimes(2);
  });
});
