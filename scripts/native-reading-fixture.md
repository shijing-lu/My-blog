# 原生阅读验收

这是一篇隔离测试文章，用于核对手机阅读。中文正文应自动换行，手机旋转与字体放大后依旧完整可读。

## 基础与公式

**加粗**、*斜体*、~~删除线~~、`行内代码`，以及 [外部链接](https://example.com)。公式 $x_1^2 + y_2^2 = r^2$ 与 $\frac{a}{b}$。

$$
\begin{pmatrix} a & b \\ c & d \end{pmatrix}\quad \sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

- 普通列表
- [x] 已完成任务
- [ ] 待办任务

> 普通引用。

正文脚注[^说明]。答案是 :spoiler[42]。

[^说明]: 这是脚注正文，可返回引用位置。

## 扩展组件

==主色== ==次色=={.secondary} ==第三色=={.tertiary} ==error:错误== =={.tip} 提示==。

:::tip
原生提示块，支持 **强调** 和 $a^2$。
:::

> [!warning]- 可折叠警告
> 警告正文，点击标题展开。

:::collapse accordion
- :+ 第一面板

  第一面板正文。

- 第二面板

  第二面板正文。
:::

:::tabs#工具
@tab:active 手机#mobile

手机标签正文。

@tab 电脑#desktop

电脑标签正文。
:::

:::tabs#工具
@tab 手机#mobile

联动手机内容。

@tab 电脑#desktop

联动电脑内容。
:::

:::columns
::column
第一栏中文内容，窄屏自然换行。

::column
第二栏内容。
:::

:::grid columns=2 aspect=4/3 fit=contain
![第一张图](/reading-fixture.svg "原生图片说明")

![第二张图](/reading-fixture.svg "第二张图片")
:::

## 宽内容

| 名称 | 数学 | 中文说明 |
| --- | --- | --- |
| 分式 | $\frac{a}{b}$ | 宽表格只在自身区域横向滚动 |
| 矩阵 | $a_{11}$ | 页面不产生整体横向滚动 |

```kotlin
fun main() {
    val message = "代码复制须保留原文，长行应局部滚动：012345678901234567890123456789012345678901234567890123456789"
    println(message)
    val a = 1
    val b = 2
    val c = 3
    val d = 4
    val e = 5
    val f = 6
    val g = 7
    val h = 8
    val i = 9
    val j = 10
    val k = 11
    val l = 12
    val m = 13
}
```

## 阅读结束

返回列表后再进入，应恢复阅读位置。断网后已缓存正文与图片仍可阅读。
