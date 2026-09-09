/**
 * 自定义 Markdown 样式纯函数测试（scopeMdCss / sanitizeMdCss；不触库）
 */
import { describe, expect, it } from 'vitest';
import { MAX_MD_CSS_CHARS, sanitizeMdCss, scopeMdCss } from '../src/lib/md-css-scope';

describe('sanitizeMdCss', () => {
  it('移除 </style> 防标签逃逸（大小写/含空格变体，整个闭合序列连同 > 一起移除）', () => {
    expect(sanitizeMdCss('a{color:red}</style><script>alert(1)</script>')).toBe(
      'a{color:red}<script>alert(1)</script>',
    );
    expect(sanitizeMdCss('x</STYLE >y')).toBe('xy');
    expect(sanitizeMdCss('a</ style>b')).toBe('ab');
  });  it('超长截断到上限', () => {
    expect(sanitizeMdCss('a'.repeat(MAX_MD_CSS_CHARS + 10)).length).toBe(MAX_MD_CSS_CHARS);
  });

  it('正常 CSS 原样保留', () => {
    expect(sanitizeMdCss('strong{color:orange}')).toBe('strong{color:orange}');
  });
});

describe('scopeMdCss 基础作用域', () => {
  it('普通选择器加 html :is(.prose) 前缀', () => {
    expect(scopeMdCss('strong{color:orange}')).toBe('html :is(.prose) strong{color:orange}');
  });

  it('顶层逗号多选择器逐个前缀', () => {
    expect(scopeMdCss('strong,em{color:red}')).toBe(
      'html :is(.prose) strong,html :is(.prose) em{color:red}',
    );
  });

  it('括号内逗号不拆分', () => {
    const css = 'p:not(x,y){color:red}';
    expect(scopeMdCss(css)).toBe('html :is(.prose) p:not(x,y){color:red}');
  });

  it('多选择器逐个处理：含 .prose 的原样，其余加前缀', () => {
    expect(scopeMdCss('.prose,.md h1{color:red}')).toBe('.prose,html :is(.prose) .md h1{color:red}');
  });

  it('字符串内 .prose 不算已含（仍加前缀）', () => {
    const out = scopeMdCss('p[title=".prose"]{color:red}');
    expect(out).toBe('html :is(.prose) p[title=".prose"]{color:red}');
  });

  it('注释剔除', () => {
    expect(scopeMdCss('/* 注释 */strong{color:orange}')).toBe('html :is(.prose) strong{color:orange}');
  });
});

describe('scopeMdCss 根元素映射', () => {
  it(':root 映射为 .prose（CSS 变量落到容器）', () => {
    expect(scopeMdCss(':root{--x:red}')).toBe('.prose{--x:red}');
  });

  it('html/body 开头映射为 .prose', () => {
    expect(scopeMdCss('html{font-size:16px}')).toBe('.prose{font-size:16px}');
    expect(scopeMdCss('body{line-height:1.8}')).toBe('.prose{line-height:1.8}');
  });

  it('html:root 复合形态映射后保留余下复合', () => {
    expect(scopeMdCss('html:root{--y:1}')).toBe('.prose{--y:1}');
  });

  it('body.dark 类复合选择器映射为 .prose.dark 语义（紧贴）', () => {
    expect(scopeMdCss('body.dark{color:#fff}')).toBe('.prose.dark{color:#fff}');
  });
});

describe('scopeMdCss at-rule 处理', () => {
  it('@media 内规则递归加前缀', () => {
    const out = scopeMdCss('@media (max-width:640px){strong{color:red}}');
    expect(out).toBe('@media (max-width:640px){html :is(.prose) strong{color:red}}');
  });

  it('@supports 内嵌 @media 两层递归', () => {
    const out = scopeMdCss('@supports (color:lab){@media screen{em{color:lab(50% 0 0)}}}');
    expect(out).toBe(
      '@supports (color:lab){@media screen{html :is(.prose) em{color:lab(50% 0 0)}}}',
    );
  });

  it('@keyframes 原样保留（百分比体不加前缀）', () => {
    const css = '@keyframes fade{from{opacity:0}to{opacity:1}}';
    expect(scopeMdCss(css)).toBe(css);
  });

  it('@font-face 原样保留', () => {
    const css = '@font-face{font-family:X;src:url(a.woff2)}';
    expect(scopeMdCss(css)).toBe(css);
  });

  it('@import 提到输出最前', () => {
    const out = scopeMdCss('strong{color:red}@import url(/a.css)');
    expect(out).toBe('@import url(/a.css);\nhtml :is(.prose) strong{color:red}');
  });

  it('未知 at-rule 原样保留（保守不破坏）', () => {
    const css = '@unknown-flag x{a:b}';
    expect(scopeMdCss(css)).toBe(css);
  });
});

describe('scopeMdCss 边界健壮性', () => {
  it('花括号不平衡不抛异常（读到末尾并补全闭括号）', () => {
    expect(() => scopeMdCss('strong{color:red')).not.toThrow();
    expect(scopeMdCss('strong{color:red')).toBe('html :is(.prose) strong{color:red}');
  });

  it('空输入返回空串', () => {
    expect(scopeMdCss('')).toBe('');
    expect(scopeMdCss('   \n  ')).toBe('');
  });

  it('CSS nesting 声明体原样保留（嵌套相对前缀宿主解析）', () => {
    const out = scopeMdCss('ul{list-style:none;& li{margin:0}}');
    expect(out).toBe('html :is(.prose) ul{list-style:none;& li{margin:0}}');
  });

  it('净化在作用域化之前生效（</style 整个闭合序列已移除）', () => {
    expect(scopeMdCss('</style>x{a:b}')).toBe('html :is(.prose) x{a:b}');
  });

  it('属性选择器内引号字符串安全', () => {
    const css = 'a[href="x{y}"]{color:red}';
    expect(scopeMdCss(css)).toBe('html :is(.prose) a[href="x{y}"]{color:red}');
  });
});
