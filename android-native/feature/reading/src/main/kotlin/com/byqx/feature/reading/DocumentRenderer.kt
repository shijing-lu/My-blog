@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package com.byqx.feature.reading

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.platform.*
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import com.byqx.core.document.*
import com.byqx.core.designsystem.NeoCard
import kotlinx.coroutines.*
import ru.noties.jlatexmath.JLatexMathDrawable

class ReadingInteractions {
    val tabs=mutableStateMapOf<String,String>(); val expanded=mutableStateMapOf<String,Boolean>(); val spoilers=mutableStateMapOf<String,Boolean>()
}
@Composable fun DocumentBlock(node:DocNode,interactions:ReadingInteractions,image:@Composable (DocNode)->Unit,jump:(String)->Unit) {
    val n=node
    when(n.kind) {
        "heading" -> SelectionContainer { InlineText(n,interactions,jump,when(n.attrs["level"]) { "1"->MaterialTheme.typography.headlineLarge;"2"->MaterialTheme.typography.headlineMedium;else->MaterialTheme.typography.titleLarge }) }
        "paragraph" -> {
            if(n.children.any {it.kind=="math"}) {
                var fragments=mutableListOf<DocNode>()
                n.children.forEach { part -> if(part.kind=="math") {if(fragments.isNotEmpty())InlineText(n.copy(children=fragments.toList()),interactions,jump);fragments=mutableListOf();Formula(part.text)} else fragments+=part }
                if(fragments.isNotEmpty())InlineText(n.copy(children=fragments),interactions,jump)
            } else {
            val imageNodes=n.children.filter { it.kind=="image" }
            if(n.children.any { it.kind!="image" }) SelectionContainer { InlineText(n.copy(children=n.children.filter { it.kind!="image" }),interactions,jump) }
            imageNodes.forEach { image(it) }
            }
        }
        "math" -> Formula(n.text)
        "code" -> CodeBlock(n,interactions)
        "rule" -> HorizontalDivider()
        "list" -> Column(verticalArrangement=Arrangement.spacedBy(8.dp)) { n.children.forEachIndexed { index,child ->
            val first=child.children.firstOrNull(); val task=Regex("^\\[([ xX])\\]\\s+").find(DocumentParser.plain(first))
            val content=if(task!=null && first!=null)listOf(first.copy(children=first.children.mapIndexed { at,part -> if(at==0 && part.kind=="text")part.copy(text=part.text.removePrefix(task.value)) else part }))+child.children.drop(1) else child.children
            Row { if(task!=null)Checkbox(checked=task.groupValues[1].lowercase()=="x",onCheckedChange=null) else Text(if(n.attrs.containsKey("start"))"${index+(n.attrs["start"]?.toIntOrNull() ?: 1)}. " else "• "); Column(Modifier.weight(1f)) { content.forEach { DocumentBlock(it,interactions,image,jump) } } }
        } }
        "table" -> {
            val rows=n.children.flatMap { if(it.kind=="tableRow")listOf(it) else it.children }
            Column(Modifier.horizontalScroll(rememberScrollState()).testTag("table_scroll_${n.id}")) { rows.forEach { row -> Row { row.children.forEach { cell -> Box(Modifier.width(200.dp).border(1.dp,MaterialTheme.colorScheme.outline).padding(12.dp)) { InlineText(cell,interactions,jump) } } } } }
        }
        "quote","admonition","callout" -> {
            val fold=n.attrs["fold"]; val canFold=!fold.isNullOrEmpty(); val open=interactions.expanded[n.id] ?: (fold!="-")
            val type=n.attrs["type"] ?: n.text
            NeoCard(color=when(type) { "danger","failure","bug","warning"->MaterialTheme.colorScheme.errorContainer;"tip","success"->MaterialTheme.colorScheme.secondaryContainer;else->MaterialTheme.colorScheme.surfaceContainer }) {
                if(n.kind!="quote") { if(canFold)TextButton(onClick={interactions.expanded[n.id]=!open},Modifier.fillMaxWidth().testTag("callout_${n.id}")) { Text("${if(open)"▾" else "▸"} ${n.text}") } else Text(n.text,style=MaterialTheme.typography.titleMedium) }
                if(!canFold || open)n.children.forEach { DocumentBlock(it,interactions,image,jump) }
            }
        }
        "tabs" -> {
            val group=n.attrs["group"].orEmpty().ifBlank { n.id }; val selected=interactions.tabs[group] ?: (n.children.firstOrNull { it.attrs["active"]=="true" } ?: n.children.firstOrNull())?.attrs?.get("key")
            Column { Row(Modifier.horizontalScroll(rememberScrollState())) { n.children.forEach { tab -> FilterChip(selected=tab.attrs["key"]==selected,onClick={interactions.tabs[group]=tab.attrs["key"].orEmpty()},label={Text(tab.text)},modifier=Modifier.testTag("tab_${n.id}_${tab.attrs["key"]}")) } }
                (n.children.firstOrNull { it.attrs["key"]==selected } ?: n.children.firstOrNull())?.children?.forEach { DocumentBlock(it,interactions,image,jump) }
            }
        }
        "collapse" -> Column { n.children.forEach { panel ->
            val open=interactions.expanded[panel.id] ?: (panel.attrs["expanded"]=="true")
            OutlinedButton(onClick={ if(!open && n.text.contains("accordion"))n.children.forEach { interactions.expanded[it.id]=false }; interactions.expanded[panel.id]=!open },modifier=Modifier.fillMaxWidth().testTag("panel_${panel.id}")) { Text("${if(open)"▾" else "▸"} ${panel.text}") }
            if(open)Column(Modifier.padding(start=12.dp,bottom=16.dp)) { panel.children.forEach { DocumentBlock(it,interactions,image,jump) } }
        } }
        "columns" -> FlowRow(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) { n.children.forEach { column -> Column(Modifier.widthIn(min=220.dp,max=400.dp).border(1.dp,MaterialTheme.colorScheme.outline).padding(12.dp)) { column.children.forEach { DocumentBlock(it,interactions,image,jump) } } } }
        "grid" -> {
            fun images(node:DocNode):List<DocNode> = if(node.kind=="image")listOf(node) else node.children.flatMap(::images)
            val params=n.text; val cols=Regex("(?:columns|cols)=[\"']?(\\d+)").find(params)?.groupValues?.get(1)?.toIntOrNull()?.coerceIn(1,6) ?: 3
            FlowRow(Modifier.fillMaxWidth(),maxItemsInEachRow=cols.coerceAtMost(2),horizontalArrangement=Arrangement.spacedBy(8.dp)) { images(n).forEach { picture -> Box(Modifier.width(150.dp)) { image(picture.copy(attrs=picture.attrs+mapOf("gridParams" to params,"group" to n.id))) } } }
        }
        "image" -> image(n)
        "footnote" -> NeoCard { Text("脚注 ${n.text}",style=MaterialTheme.typography.labelLarge); n.children.forEach { DocumentBlock(it,interactions,image,jump) }; TextButton(onClick={jump("ref:${n.text}")}) { Text("返回引用") } }
        "unsupported" -> NeoCard(color=MaterialTheme.colorScheme.errorContainer) { Text("此节点尚未适配原生阅读",style=MaterialTheme.typography.titleMedium); Text("范围 ${n.from}–${n.to}；已登记为未完成") }
        else -> n.children.forEach { DocumentBlock(it,interactions,image,jump) }
    }
}

@Composable private fun CodeBlock(n:DocNode,state:ReadingInteractions) {
    val clipboard=LocalClipboardManager.current; val lines=n.text.lines(); val open=state.expanded[n.id] ?: (lines.size<15)
    NeoCard {
        Row { Text(n.attrs["language"].orEmpty(),Modifier.weight(1f)); TextButton(onClick={clipboard.setText(AnnotatedString(n.text))},Modifier.testTag("code_copy_${n.id}")) { Text("复制") }; if(lines.size>=15)TextButton(onClick={state.expanded[n.id]=!open}) { Text(if(open)"折叠" else "展开") } }
        val shown=if(open)lines else lines.take(6)
        SelectionContainer { Text(buildAnnotatedString { shown.forEachIndexed { i,line -> withStyle(SpanStyle(color=MaterialTheme.colorScheme.onSurfaceVariant)) { append("${i+1}  ") }; val start=length; append(line); Regex("\\b(?:fun|val|var|class|return|const|let|if|else|true|false|null|def|import|export|int|public|void)\\b").findAll(line).forEach { addStyle(SpanStyle(color=Color(0xFF7C3AED),fontWeight=FontWeight.Bold),start+it.range.first,start+it.range.last+1) }; append('\n') } },Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),fontFamily=FontFamily.Monospace,fontSize=14.sp,softWrap=false) }
    }
}
@Composable fun Formula(tex:String) {
    val density=LocalDensity.current; val color=MaterialTheme.colorScheme.onSurface.toArgb(); val size=with(density){18.sp.toPx()}
    val drawable by produceState<JLatexMathDrawable?>(null,tex,size,color) { value=withContext(Dispatchers.Default) { runCatching { FormulaLayout.layout(tex,size,color) }.getOrNull() } }
    if(drawable==null)Text("公式排版中或不支持此 TeX",color=MaterialTheme.colorScheme.error)
    else Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).testTag("formula_scroll")) { FormulaCanvas(drawable!!) }
}
@Composable private fun FormulaCanvas(drawable:JLatexMathDrawable) {
    val density=LocalDensity.current
    Canvas(Modifier.size(with(density){drawable.intrinsicWidth.toDp()},with(density){drawable.intrinsicHeight.toDp()})) { drawIntoCanvas { drawable.draw(it.nativeCanvas) } }
}
@Composable private fun InlineText(n:DocNode,state:ReadingInteractions,jump:(String)->Unit,style:TextStyle=MaterialTheme.typography.bodyLarge) {
    val context=LocalContext.current; val uri=LocalUriHandler.current; val color=MaterialTheme.colorScheme.onSurface; val density=LocalDensity.current
    val inline=mutableMapOf<String,InlineTextContent>(); val scheme=MaterialTheme.colorScheme
    val text=buildAnnotatedString {
        fun walk(node:DocNode) {
            when(node.kind) {
                "text" -> if(node.children.isEmpty())append(node.text) else node.children.forEach(::walk)
                "literal" -> append(node.text)
                "inlineMath","math" -> {
                    val d=runCatching { FormulaLayout.layout(node.text,with(density){16.sp.toPx()},color.toArgb()) }.getOrNull()
                    if(d==null)append("〔公式未适配〕") else { val width=with(density){d.intrinsicWidth.toSp()}.value.coerceAtMost(280f).sp; val height=with(density){d.intrinsicHeight.toSp()}; appendInlineContent(node.id,"公式 ${node.text}"); inline[node.id]=InlineTextContent(Placeholder(width,height,PlaceholderVerticalAlign.TextCenter)) { Box(Modifier.horizontalScroll(rememberScrollState())) { FormulaCanvas(d) } } }
                }
                "spoiler" -> withLink(LinkAnnotation.Clickable(node.id,linkInteractionListener={ state.spoilers[node.id]=!(state.spoilers[node.id] ?: false) })) { withStyle(SpanStyle(background=color,color=if(state.spoilers[node.id]==true)scheme.background else color)) { if(node.children.isEmpty())append(node.text) else node.children.forEach(::walk) } }
                "footnoteRef" -> withLink(LinkAnnotation.Clickable(node.text,linkInteractionListener={jump("foot:${node.text}")})) { withStyle(SpanStyle(color=scheme.primary)) { append("[${node.text}]") } }
                "link" -> withLink(LinkAnnotation.Clickable(node.id,linkInteractionListener={ val url=node.attrs["url"].orEmpty(); if(url.startsWith('#'))jump(url.drop(1)) else runCatching { if(java.net.URI(url).scheme in listOf("https","http","mailto"))uri.openUri(url) } })) { withStyle(SpanStyle(color=scheme.primary,textDecoration=TextDecoration.Underline)) { node.children.forEach(::walk) } }
                "mark" -> withStyle(SpanStyle(background=when(node.attrs["variant"]) {"secondary"->scheme.secondaryContainer;"tertiary"->scheme.tertiaryContainer;"error"->scheme.errorContainer;"tip"->Color(0xFF4DD4C6);else->Color(0xFFFFD43B)},color=Color(0xFF171717))) { if(node.children.isEmpty())append(node.text) else node.children.forEach(::walk) }
                "inlineCode" -> withStyle(SpanStyle(fontFamily=FontFamily.Monospace,background=scheme.surfaceContainer)) { append(node.text) }
                "strong" -> withStyle(SpanStyle(fontWeight=FontWeight.Bold)) { node.children.forEach(::walk) }
                "emphasis" -> withStyle(SpanStyle(fontStyle=FontStyle.Italic)) { node.children.forEach(::walk) }
                "strike" -> withStyle(SpanStyle(textDecoration=TextDecoration.LineThrough)) { node.children.forEach(::walk) }
                else -> node.children.forEach(::walk)
            }
        }; walk(n)
    }
    Text(text,Modifier.fillMaxWidth(),style=style.copy(lineHeight=26.sp),inlineContent=inline)
}
