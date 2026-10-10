package com.byqx.core.document
import org.junit.Assert.*
import org.junit.Test
class DocumentParserTest {
    @Test fun displayMathNeverDropsTrailingTextAndQuoteMath() {
        val doc=DocumentParser().parse("\$\$x^2\$\$ 后续正文\n\n> 引用 \$\$y^2\$\$ 后续引用")
        assertEquals(2,doc.all().count {it.kind=="math"});assertTrue(doc.all().any{it.text.contains("后续正文")});assertTrue(doc.all().any{it.text.contains("后续引用")})
    }
    @Test fun fullWebFixtureParsesWithoutDroppingComponents() {
        val source=java.io.File(System.getProperty("nativeFixturePath")).readText()
        val doc=DocumentParser().parse(source)
        assertTrue(doc.unsupported.toString(),doc.unsupported.isEmpty())
        for(kind in listOf("math","inlineMath","footnote","footnoteRef","mark","spoiler","callout","collapse","tabs","columns","grid","code","table"))assertTrue("missing $kind",doc.all().any { it.kind==kind })
    }
    @Test fun commonMarkAndStableSourceRanges() {
        val source="# 中文标题\n\n**粗体** [链接](https://example.com)\n\n|甲|乙|\n|---|---|\n|1|2|"
        val parser=DocumentParser(); val a=parser.parse(source); val b=parser.parse(source)
        assertEquals(a,b); assertTrue(a.toc.isNotEmpty());assertTrue(a.all().any{it.kind=="table"});assertTrue(a.all().any{it.kind=="strong"});assertEquals(0,a.nodes.first().from);assertTrue(a.nodes.first().to>0);assertTrue(a.unsupported.isEmpty())
    }
    @Test fun directiveAndCodeBoundaries() {
        val source="```text\n:::tabs#ignored\n@tab no\n::: \n```\n\n:::tabs#linked\n@tab:active 一#a\n\n正文\n\n@tab 二#b\n\n第二正文\n:::"
        val a=DocumentParser().parse(source); assertEquals(1,a.all().count{it.kind=="tabs"});assertEquals(2,a.all().count{it.kind=="tab"});assertEquals("linked",a.all().first{it.kind=="tabs"}.attrs["group"]);assertTrue(a.unsupported.isEmpty())
    }
    @Test fun mathAndFootnotes() {
        val a=DocumentParser().parse("行内 $\\frac{a_1}{b_2}$。脚注[^一]\n\n\$\$x^2\$\$\n\n[^一]: 中文解释")
        assertEquals("\\frac{a_1}{b_2}",a.all().first{it.kind=="inlineMath"}.text);assertEquals("math: $a",1,a.all().count{it.kind=="math"});assertEquals("footnote: $a",1,a.all().count{it.kind=="footnote"});assertEquals("reference: $a",1,a.all().count{it.kind=="footnoteRef"})
    }
    @Test fun extensionsAndUnknownAreExplicit() {
        val a=DocumentParser().parse("=={.tip} 中文== :spoiler[答案]\n\n> [!warning]- 警告\n> 正文\n\n:::mystery\n未知\n:::")
        assertEquals("tip",a.all().first{it.kind=="mark"}.attrs["variant"]);assertEquals("答案",a.all().first{it.kind=="spoiler"}.text);assertEquals("-",a.all().first{it.kind=="callout"}.attrs["fold"]);assertFalse(a.unsupported.isEmpty())
    }
}
