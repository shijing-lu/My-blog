/**
 * Markdown 编辑命令纯函数单测（语义与 Obsidian 对齐）
 */
import { describe, expect, it } from 'vitest';
import {
  allLinesHavePrefix,
  fencedBlock,
  headingLine,
  withLinePrefix,
  wrapText,
} from '../src/lib/md-commands';
import {
  DEFAULT_BINDINGS,
  bindingFromEvent,
  normalizeBinding,
  resolveBindings,
} from '../src/lib/editor-shortcut-defs';

describe('标题行计算（headingLine）', () => {
  it('正文 → 指定级别', () => {
    expect(headingLine('正文', 2)).toBe('## 正文');
  });

  it('已是同级别 → 退回正文（Obsidian toggle 语义）', () => {
    expect(headingLine('## 正文', 2)).toBe('正文');
    expect(headingLine('# 标题', 1)).toBe('标题');
  });

  it('已有不同级别 → 直接切换级别', () => {
    expect(headingLine('# 一级', 3)).toBe('### 一级');
  });

  it('级别 0 → 清除标题标记', () => {
    expect(headingLine('### 三级', 0)).toBe('三级');
  });

  it('保留行首缩进', () => {
    expect(headingLine('  缩进正文', 1)).toBe('  # 缩进正文');
  });

  it('无空格的旧式标题也能识别并切换', () => {
    expect(headingLine('#无空格', 2)).toBe('## 无空格');
  });
});

describe('行内标记包裹（wrapText）', () => {
  it('有选区：包裹并把光标移入标记内', () => {
    const r = wrapText('hello world', '**', '**', 0, 11);
    expect(r.text).toBe('**hello world**');
    expect(r.from).toBe(2);
    expect(r.to).toBe(13);
  });

  it('已包裹的选区 → 去包裹（toggle off）', () => {
    const r = wrapText('**hello**', '**', '**', 0, 9);
    expect(r.text).toBe('hello');
    expect(r.from).toBe(0);
    expect(r.to).toBe(5);
  });

  it('无选区：插入空标记对，光标居中', () => {
    const r = wrapText('ab', '`', '`', 1, 1);
    expect(r.text).toBe('a``b');
    expect(r.from).toBe(2);
    expect(r.to).toBe(2);
  });

  it('不同标记互不误判（斜体选区不会触发加粗的 toggle off）', () => {
    const r = wrapText('*hello*', '**', '**', 0, 7);
    expect(r.text).toBe('***hello***');
  });
});

describe('块级前缀（引用/列表）', () => {
  it('withLinePrefix：加前缀与去前缀', () => {
    expect(withLinePrefix('内容', '> ')).toBe('> 内容');
    expect(withLinePrefix('> 内容', '> ')).toBe('内容');
  });

  it('allLinesHavePrefix：全部带前缀才视为已引用（空行忽略）', () => {
    expect(allLinesHavePrefix(['> a', '> b'], '> ')).toBe(true);
    expect(allLinesHavePrefix(['> a', 'b'], '> ')).toBe(false);
    expect(allLinesHavePrefix(['', ''], '> ')).toBe(false);
  });
});

describe('代码块围栏（fencedBlock）', () => {
  it('空选区 → 空围栏', () => {
    expect(fencedBlock('')).toBe('```\n\n```');
  });

  it('多行选区 → 整块包裹', () => {
    expect(fencedBlock('a\nb')).toBe('```\na\nb\n```');
  });
});

describe('快捷键绑定（normalize / resolve）', () => {
  it('ctrl/cmd 统一归并为 mod，修饰键顺序固定', () => {
    expect(normalizeBinding('Ctrl-Shift-X')).toBe('mod-shift-x');
    expect(normalizeBinding('cmd-b')).toBe('mod-b');
    expect(normalizeBinding('Meta-Alt-1')).toBe('mod-alt-1');
  });

  it('非法输入返回 null', () => {
    expect(normalizeBinding('')).toBeNull();
    expect(normalizeBinding('Ctrl-Shift')).toBeNull(); // 只有修饰键
    expect(normalizeBinding(42)).toBeNull();
  });

  it('默认表与 Obsidian 对齐（关键项）', () => {
    expect(DEFAULT_BINDINGS.bold).toBe('Mod-b');
    expect(DEFAULT_BINDINGS.italic).toBe('Mod-i');
    expect(DEFAULT_BINDINGS.strike).toBe('Mod-Shift-x');
    expect(DEFAULT_BINDINGS.link).toBe('Mod-k');
    expect(DEFAULT_BINDINGS.heading1).toBe('Mod-1');
    expect(DEFAULT_BINDINGS.heading6).toBe('Mod-6');
  });

  it('自定义覆盖默认，并检测冲突', () => {
    const { bindings, conflicts } = resolveBindings({ bold: 'Mod-alt-b' });
    expect(bindings.bold).toBe('mod-alt-b');
    expect(conflicts).toHaveLength(0);
    const clash = resolveBindings({ bold: 'Mod-i' });
    expect(clash.conflicts[0]?.binding).toBe('mod-i');
    expect(clash.conflicts[0]?.ids).toEqual(['bold', 'italic']); // ids 已排序，输出稳定
  });

  it('bindingFromEvent：组合键可录制，纯修饰键忽略', () => {
    const ev = (init: Partial<KeyboardEvent>) =>
      ({
        key: 'b',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...init,
      }) as KeyboardEvent;
    expect(bindingFromEvent(ev({}))).toBe('mod-b');
    expect(bindingFromEvent(ev({ shiftKey: true }))).toBe('mod-shift-b');
    expect(bindingFromEvent(ev({ key: 'Shift', shiftKey: true }))).toBeNull();
  });
});
