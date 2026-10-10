package com.byqx.core.document

import kotlinx.serialization.Serializable
import org.commonmark.node.*
import org.commonmark.parser.*
import org.commonmark.ext.gfm.tables.*
import org.commonmark.ext.gfm.strikethrough.*
import java.util.UUID
import org.commonmark.parser.beta.*

@Serializable data class DocNode(val id:String,val kind:String,val text:String="",val attrs:Map<String,String> = emptyMap(),val children:List<DocNode> = emptyList(),val from:Int=0,val to:Int=0)
@Serializable data class DocumentAstV1(val version:Int=1,val nodes:List<DocNode>,val unsupported:List<String>) {
    fun all():List<DocNode> {
        fun walk(n:DocNode):List<DocNode> = listOf(n)+n.children.flatMap(::walk)
        return nodes.flatMap(::walk)
    }
    val toc get()=all().filter { it.kind=="heading" }
    val resources get()=all().filter { it.kind=="image" }.map { it.attrs["url"].orEmpty() }.distinct()
}
/** Source is never rewritten. CommonMark handles the base grammar, Kotlin handles project extensions. */
class DocumentParser {
    private class ExtensionNode(val kind:String,val value:String,val attributes:Map<String,String> = emptyMap()):CustomNode()
    private val extensionFactory=object:InlineContentParserFactory {
        override fun getTriggerCharacters()=setOf('$',':','[','=')
        override fun create()=InlineContentParser { state ->
            val scan=state.scanner(); val start=scan.position()
            fun failed():ParsedInline? { scan.setPosition(start);return ParsedInline.none() }
            fun readUntil(end:String,brackets:Boolean=false,multiline:Boolean=false):String? {
                val text=StringBuilder(); var depth=0
                while(scan.hasNext() && (multiline || scan.peek()!='\n')) {
                    if(depth==0 && scan.next(end))return text.toString()
                    val c=scan.peek(); scan.next()
                    if(c=='\\' && scan.hasNext()) { text.append(c).append(scan.peek());scan.next();continue }
                    if(brackets && c=='[')depth++;if(brackets && c==']')depth--
                    text.append(c)
                };return null
            }
            val node=when {
                scan.next("$$") -> readUntil("$$",multiline=true)?.takeIf {it.isNotBlank()}?.let {ExtensionNode("math",it.trim())}
                scan.next("$") -> { val value=readUntil("$"); if(value.isNullOrEmpty())null else ExtensionNode("inlineMath",value) }
                scan.next(":spoiler[") -> readUntil("]",true)?.let { ExtensionNode("spoiler",it) }
                scan.next("[^") -> readUntil("]")?.let { ExtensionNode("footnoteRef",it) }
                scan.next("==") -> {
                    var value=readUntil("=="); if(value==null)null else {
                        val prefix=Regex("^(?:\\{\\.?(primary|secondary|tertiary|error|tip)\\}\\s*|(primary|secondary|tertiary|error|tip):)").find(value)
                        var variant=prefix?.let { it.groupValues[1].ifBlank { it.groupValues[2] } } ?: "primary"
                        if(prefix!=null)value=value.removePrefix(prefix.value)
                        val suffixStart=scan.position(); if(scan.next("{")) { val suffix=readUntil("}")?.removePrefix(".");if(suffix in listOf("primary","secondary","tertiary","error","tip"))variant=suffix!! else scan.setPosition(suffixStart) }
                        ExtensionNode("mark",value,mapOf("variant" to variant))
                    }
                }
                else -> null
            }
            if(node==null)failed() else ParsedInline.of(node,scan.position())
        }
    }
    private val parser=Parser.builder().extensions(listOf(TablesExtension.create(),StrikethroughExtension.create())).customInlineContentParserFactory(extensionFactory).includeSourceSpans(IncludeSourceSpans.BLOCKS_AND_INLINES).build()
    private val unsupported=mutableListOf<String>()
    private val counts=mutableMapOf<String,Int>()
    private fun make(kind:String,text:String="",attrs:Map<String,String> = emptyMap(),children:List<DocNode> = emptyList(),from:Int=0,to:Int=from):DocNode {
        val fingerprint="$kind:$text:$attrs:${children.joinToString { it.id }}"; val n=counts.getOrDefault(fingerprint,0); counts[fingerprint]=n+1
        return DocNode(UUID.nameUUIDFromBytes("$fingerprint:$n".toByteArray()).toString(),kind,text,attrs,children,from,to)
    }
    fun parse(source:String):DocumentAstV1 {
        counts.clear(); unsupported.clear()
        val normalized=source.replace('\uFF40','`').replace('\u02CB','`').replace('\u2035','`')
        return DocumentAstV1(nodes=blocks(normalized,0),unsupported=unsupported.distinct())
    }
    private fun blocks(source:String,base:Int):List<DocNode> {
        val lines=source.split('\n'); val offsets=IntArray(lines.size); var cursor=0
        lines.forEachIndexed { i,line -> offsets[i]=cursor; cursor+=line.length+1 }
        val result=mutableListOf<DocNode>(); var ordinary=0; var i=0
        fun flush(end:Int) { if(end>ordinary) { val chunk=lines.subList(ordinary,end).joinToString("\n"); result+=convert(parser.parse(chunk),base+offsets[ordinary],chunk) } }
        while(i<lines.size) {
            val line=lines[i]; val trim=line.trim()
            // Never interpret extension delimiters inside a code fence.
            val code=Regex("^(`{3,}|~{3,}).*").find(trim)
            if(code!=null) { val fence=code.groupValues[1]; i++; while(i<lines.size && !lines[i].trim().startsWith(fence)) i++; if(i<lines.size)i++; continue }
            val open=Regex("^(:{3,})\\s*([a-zA-Z]+)(.*)$").matchEntire(trim)
            val math=trim.startsWith("$$")
            val foot=Regex("^\\[\\^([^\\]]+)\\]\\s*:\\s*(.*)$").matchEntire(trim)
            if(open!=null || math || foot!=null) {
                flush(i); val start=i; val from=base+offsets[i]
                if(foot!=null) {
                    val body=StringBuilder(foot.groupValues[2]); i++
                    while(i<lines.size && (lines[i].startsWith("    ") || lines[i].startsWith("\t"))) { body.append('\n').append(lines[i].trimStart()); i++ }
                    result+=make("footnote",foot.groupValues[1],children=blocks(body.toString(),from+line.indexOf(foot.groupValues[2])),from=from,to=base+if(i<lines.size)offsets[i] else source.length)
                } else if(math) {
                    val body=StringBuilder(trim.removePrefix("$$")); i++
                    if(!body.toString().contains("$$")) { while(i<lines.size) { body.append('\n').append(lines[i]); i++; if(lines[i-1].contains("$$"))break } }
                    val value=body.toString().substringBefore("$$").trim(); result+=make("math",value,from=from,to=base+if(i<lines.size)offsets[i] else source.length)
                    val trailing=lines[i-1].substringAfter("$$","")
                    val closeAt=lines[i-1].lastIndexOf("$$")
                    val tail=if(start==i-1 && closeAt>lines[i-1].indexOf("$$"))lines[i-1].substring(closeAt+2) else if(start!=i-1 && closeAt>=0)trailing else ""
                    if(tail.isNotBlank())result+=blocks(tail,base+offsets[i-1]+closeAt+2)
                } else {
                    val delimiter=open!!.groupValues[1]; val name=open.groupValues[2].lowercase(); val params=open.groupValues[3].trim(); i++; val contentStart=i; var nested=0
                    while(i<lines.size) {
                        val t=lines[i].trim()
                        if(Regex("^:{3,}\\s*[a-zA-Z].*").matches(t)) nested++
                        if(Regex("^:{3,}$").matches(t)) { if(nested==0 && t.length>=delimiter.length)break; if(nested>0)nested-- }
                        i++
                    }
                    val body=lines.subList(contentStart,i).joinToString("\n"); val bodyBase=base+if(contentStart<offsets.size)offsets[contentStart] else source.length
                    if(i<lines.size)i++ else unsupported+="未闭合容器 $name @ $from"
                    val end=base+if(i<lines.size)offsets[i] else source.length
                    val children=when(name) {
                        "tabs" -> sections(body,bodyBase,Regex("(?m)^\\s*@tab(:active)?\\s+(.+)$"),"tab")
                        "columns" -> sections(body,bodyBase,Regex("(?m)^\\s*::column\\s*$"),"column")
                        "collapse" -> {
                            val list=blocks(body,bodyBase).firstOrNull { it.kind=="list" }
                            list?.children?.map { item -> val title=item.children.firstOrNull(); val label=plain(title).substringBefore('\n'); val continuation=title?.let { stripPrefix(it,label.length+1) }?.takeIf { plain(it).isNotBlank() }; make("panel",label.removePrefix(":+").removePrefix(":-").trim(),mapOf("expanded" to (label.startsWith(":+") || params.contains("expand") && !label.startsWith(":-")).toString()),listOfNotNull(continuation)+item.children.drop(1),item.from,item.to) } ?: emptyList()
                        }
                        else -> blocks(body,bodyBase)
                    }
                    val kind=when(name) { "note","tip","warning","danger","info" -> "admonition"; "tabs","columns","collapse","grid" -> name; else -> "unsupported" }
                    if(kind=="unsupported")unsupported+="容器 $name @ $from"
                    result+=make(kind,if(kind=="admonition")name else params,mapOf("params" to params,"group" to params.removePrefix("#").substringBefore(' ')),children,from,end)
                }
                ordinary=i
            } else i++
        }
        flush(lines.size); return result
    }
    private fun sections(body:String,base:Int,regex:Regex,kind:String):List<DocNode> {
        val markers=regex.findAll(body).toList()
        if(markers.isEmpty()) { unsupported+="空 $kind 容器 @ $base"; return blocks(body,base) }
        return markers.mapIndexed { index,m -> val start=m.range.last+1; val end=markers.getOrNull(index+1)?.range?.first ?: body.length
            val raw=if(kind=="tab")m.groupValues[2] else "第${index+1}栏"; val label=raw.replace(Regex("#[\\w-]+$"),"").trim()
            make(kind,label,mapOf("active" to (kind=="tab" && m.groupValues[1].isNotEmpty()).toString(),"key" to (Regex("#([\\w-]+)$").find(raw)?.groupValues?.get(1) ?: index.toString())),blocks(body.substring(start,end),base+start),base+m.range.first,base+end)
        }
    }
    private fun siblings(first:Node?):List<Node> { val nodes=mutableListOf<Node>(); var n=first; while(n!=null) { nodes+=n; n=n.next }; return nodes }
    private fun convert(parent:Node,base:Int,source:String?=null):List<DocNode> = siblings(parent.firstChild).map { n ->
        val span=n.sourceSpans; val from=base+(span.firstOrNull()?.inputIndex ?: 0); val to=base+(span.lastOrNull()?.let { it.inputIndex+it.length } ?: 0)
        val children=convert(n,base,source)
        when(n) {
            is ExtensionNode -> make(n.kind,n.value,n.attributes,if(n.kind in listOf("mark","spoiler"))convert(parser.parse(n.value),from).flatMap { it.children } else emptyList(),from,to)
            is Text -> {
                val definition=parent is Paragraph && siblings(parent.firstChild).firstOrNull() is Text && Regex("^\\[\\d{1,3}\\]\\s+").containsMatchIn((parent.firstChild as Text).literal)
                val refs=if(!definition)Regex(if(parent is Paragraph)"\\[\\^([^\\]]+)\\]|\\[(\\d{1,3})\\]" else "\\[\\^([^\\]]+)\\]").findAll(n.literal).toList() else emptyList()
                if(refs.isEmpty())make("text",n.literal,from=from,to=to) else {
                    var at=0; val parts=mutableListOf<DocNode>(); refs.forEach { m -> if(m.range.first>at)parts+=make("literal",n.literal.substring(at,m.range.first),from=from+at,to=from+m.range.first);parts+=make("footnoteRef",m.groupValues[1].ifBlank { m.groupValues.getOrElse(2){""} },from=from+m.range.first,to=from+m.range.last+1);at=m.range.last+1 };if(at<n.literal.length)parts+=make("literal",n.literal.substring(at),from=from+at,to=to);make("text",n.literal,children=parts,from=from,to=to)
                }
            }
            is Heading -> make("heading",attrs=mapOf("level" to n.level.toString()),children=children,from=from,to=to)
            is Paragraph -> {
                val first=children.firstOrNull(); val legacy=if(first?.kind=="text")Regex("^\\[(\\d{1,3})\\]\\s+").find(first.text) else null
                if(legacy==null)make("paragraph",children=children,from=from,to=to) else make("footnote",legacy.groupValues[1],children=listOf(first!!.copy(text=first.text.drop(legacy.value.length)))+children.drop(1),from=from,to=to)
            }
            is FencedCodeBlock -> make("code",n.literal.trimEnd(),mapOf("language" to n.info),from=from,to=to)
            is IndentedCodeBlock -> make("code",n.literal.trimEnd(),from=from,to=to)
            is Code -> make("inlineCode",n.literal,from=from,to=to)
            is Emphasis -> make("emphasis",children=children,from=from,to=to)
            is StrongEmphasis -> make("strong",children=children,from=from,to=to)
            is Strikethrough -> make("strike",children=children,from=from,to=to)
            is Link -> make("link",attrs=mapOf("url" to n.destination),children=children,from=from,to=to)
            is Image -> make("image",plainChildren(children),mapOf("url" to n.destination,"caption" to n.title.orEmpty()),from=from,to=to)
            is SoftLineBreak -> make("text","\n",from=from,to=to)
            is HardLineBreak -> make("text","\n",from=from,to=to)
            is ThematicBreak -> make("rule",from=from,to=to)
            is BulletList -> make("list",children=children,from=from,to=to)
            is OrderedList -> make("list",attrs=mapOf("start" to n.markerStartNumber.toString()),children=children,from=from,to=to)
            is ListItem -> make("listItem",children=children,from=from,to=to)
            is BlockQuote -> { val label=plainChildren(children).lineSequence().firstOrNull().orEmpty(); val m=Regex("^\\[!([\\w]+)\\]([+-])?\\s*(.*)").find(label)
                if(m==null)make("quote",children=children,from=from,to=to) else { val first=children.firstOrNull(); val stripped=first?.let { stripPrefix(it,m.value.length) }; make("callout",m.groupValues[3].ifBlank { m.groupValues[1] },mapOf("type" to m.groupValues[1].lowercase(),"fold" to m.groupValues[2]),listOfNotNull(stripped)+children.drop(1),from,to) }
            }
            is TableBlock -> make("table",children=children,from=from,to=to)
            is TableHead -> make("tableHead",children=children,from=from,to=to)
            is TableBody -> make("tableBody",children=children,from=from,to=to)
            is TableRow -> make("tableRow",children=children,from=from,to=to)
            is TableCell -> make("tableCell",attrs=mapOf("align" to (n.alignment?.toString() ?: "LEFT")),children=children,from=from,to=to)
            is HtmlBlock -> { unsupported+="HTML/JSX @ $from"; make("unsupported",n.literal,from=from,to=to) }
            is HtmlInline -> { unsupported+="HTML/JSX @ $from"; make("unsupported",n.literal,from=from,to=to) }
            else -> make("group",children=children,from=from,to=to)
        }
    }
    private fun stripPrefix(n:DocNode,count:Int):DocNode { var remaining=count; fun strip(node:DocNode):DocNode { if(node.kind=="text") { val eat=minOf(remaining,node.text.length); remaining-=eat; return node.copy(text=node.text.drop(eat),children=emptyList()) }; return node.copy(children=node.children.map(::strip)) }; return strip(n) }
    companion object { fun plain(n:DocNode?):String=if(n==null)"" else if(n.kind=="text" || n.children.isEmpty())n.text else plainChildren(n.children); private fun plainChildren(nodes:List<DocNode>)=nodes.joinToString("") { plain(it) } }
}
