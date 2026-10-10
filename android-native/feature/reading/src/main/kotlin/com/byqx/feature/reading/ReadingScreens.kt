@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package com.byqx.feature.reading

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.pager.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.*
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.*
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.request.*
import coil3.svg.SvgDecoder
import coil3.gif.GifDecoder
import com.byqx.core.designsystem.NeoCard
import com.byqx.core.document.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.text.SimpleDateFormat
import java.util.Locale

@Composable fun ReadingHome(state:ReadingState,repository:ReadingRepository,onArticles:()->Unit) {
    var index by remember { mutableIntStateOf(0) }
    LaunchedEffect(state.quotes,state.heroImages,state.quoteInterval) { while(true) { delay(state.quoteInterval); index++ } }
    NeoCard(color=MaterialTheme.colorScheme.primaryContainer,onClick=onArticles,modifier=Modifier.testTag("open_articles")) {
        if(state.heroImages.isNotEmpty()) CachedImage(DocNode("hero","image","首页头图",mapOf("url" to state.heroImages[index%state.heroImages.size])),repository,{})
        Text("白衣卿相",style=MaterialTheme.typography.headlineLarge)
        Text(state.subtitle.ifBlank { "把知识、想法和日常带在身边。" })
        if(state.quotes.isNotEmpty())Text(state.quotes[index%state.quotes.size],style=MaterialTheme.typography.titleMedium)
        Text("阅读文章 · ${state.articles.size}篇",style=MaterialTheme.typography.labelLarge)
    }
}
@Composable fun ArticlesScreen(state:ReadingState,repository:ReadingRepository,onArticle:(String)->Unit,onConnection:()->Unit) {
    var query by rememberSaveable { mutableStateOf("") }; var category by rememberSaveable { mutableStateOf("") }; var tag by rememberSaveable { mutableStateOf("") }; var month by rememberSaveable { mutableStateOf("") }; var type by rememberSaveable { mutableStateOf("") }
    val scope=rememberCoroutineScope(); fun monthOf(a:Article)=SimpleDateFormat("yyyy-MM",Locale.ROOT).format(java.util.Date(a.createdAt))
    var remoteMatches by remember {mutableStateOf<List<Article>?>(null)}
    LaunchedEffect(query,state.serverId) {remoteMatches=null;if(query.isNotBlank()){delay(350);remoteMatches=repository.search(query)}}
    val filtered=(remoteMatches ?: state.articles).filter { a -> (category.isEmpty() || a.categoryId==category) && (tag.isEmpty() || tag in a.tags) && (month.isEmpty() || monthOf(a)==month) && (type.isEmpty() || a.type==type) && (remoteMatches!=null || query.isBlank() || (a.title+" "+a.summary+" "+a.tags.joinToString()+" "+state.details[a.id]?.source.orEmpty()).contains(query,true)) }
    LazyColumn(Modifier.fillMaxSize().testTag("articles_list"),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        item { Text("文章与归档",style=MaterialTheme.typography.headlineLarge); Text(state.message)
            if(state.serverId==null)Button(onClick=onConnection) { Text("绑定站主服务") } else OutlinedButton(onClick={scope.launch { repository.refreshCatalog(true) }},enabled=!state.busy,modifier=Modifier.testTag("articles_refresh")) { Text("刷新列表") }
        }
        item { OutlinedTextField(query,{query=it.take(200)},Modifier.fillMaxWidth().testTag("article_search"),label={Text("搜索标题、摘要与正文")},singleLine=true); Text(if(remoteMatches!=null)"服务端或已缓存搜索结果；受保护正文不参与远端检索。" else "离线检索本机资料；文档搜索随文档模块交付。",style=MaterialTheme.typography.bodySmall) }
        item { FilterRow(listOf("" to "全部类型","tech" to "技术","note" to "笔记","photo" to "摄影"),type) {type=it} }
        item { FilterRow(listOf("" to "全部分类")+state.categories.map { it.id to it.name },category) {category=it} }
        item { FilterRow(listOf("" to "全部标签")+state.articles.flatMap { it.tags }.distinct().map { it to it },tag) {tag=it} }
        item { FilterRow(listOf("" to "全部月份")+state.articles.map(::monthOf).distinct().map { it to it },month) {month=it} }
        if(filtered.isEmpty())item { Text(if(state.articles.isEmpty())"尚无文章缓存；联网后刷新。" else "没有匹配文章。") }
        items(filtered,key={it.id}) { article -> NeoCard(onClick={onArticle(article.id)},modifier=Modifier.testTag("article_${article.id}")) {
            article.cover?.let { CachedImage(DocNode(article.id,"image",article.title,mapOf("url" to it)),repository,{onArticle(article.id)}) }
            Text(article.title,style=MaterialTheme.typography.titleLarge); Text(article.summary); Text("${monthOf(article)} · ${article.tags.joinToString(" / ")} · ${article.views}阅读${if(article.encrypted)" · 密码保护" else ""}")
            Text(if(state.details.containsKey(article.id))"本机可读" else "联网下载正文",style=MaterialTheme.typography.labelLarge)
        } }
    }
}
@Composable private fun FilterRow(values:List<Pair<String,String>>,selected:String,onSelect:(String)->Unit) { Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) { values.forEach { (id,label)->FilterChip(selected=id==selected,onClick={onSelect(id)},label={Text(label)}) } } }

@Composable fun ArticleScreen(id:String,state:ReadingState,repository:ReadingRepository) {
    val body=state.details[id]; val scope=rememberCoroutineScope(); val list=rememberLazyListState(); val interactions=remember(id) { ReadingInteractions() }; var directory by rememberSaveable(id) { mutableStateOf(false) }; var password by remember { mutableStateOf("") }; var search by rememberSaveable(id) { mutableStateOf("") }; var imageIndex by remember { mutableIntStateOf(-1) }; var previewImages by remember { mutableStateOf<List<DocNode>>(emptyList()) }
    val context=LocalContext.current
    BackHandler(directory) { directory=false }
    var exportMessage by remember {mutableStateOf("")}
    var viewRecorded by rememberSaveable(id) { mutableStateOf(false) }
    LaunchedEffect(id,body!=null) { if(body!=null && !viewRecorded) { viewRecorded=true; repository.interaction(id) } }
    LaunchedEffect(id) { val saved=repository.ui(id); interactions.tabs.putAll(saved["tabs"].orEmpty());interactions.expanded.putAll(saved["expanded"].orEmpty().mapValues {it.value=="true"});interactions.spoilers.putAll(saved["spoilers"].orEmpty().mapValues {it.value=="true"}) }
    fun interactionState()=mapOf("tabs" to interactions.tabs.toMap(),"expanded" to interactions.expanded.mapValues {it.value.toString()},"spoilers" to interactions.spoilers.mapValues {it.value.toString()})
    LaunchedEffect(id) { snapshotFlow { interactionState() }.drop(1).debounce(350).collect { repository.keepUi(id,it) } }
    DisposableEffect(id,state.serverId) { onDispose { repository.keepUi(id,interactionState(),state.serverId) } }
    val export=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri -> if(uri!=null && body!=null)scope.launch { val ok=withContext(Dispatchers.IO) { runCatching { checkNotNull(context.contentResolver.openOutputStream(uri)).use { it.write(markdownExport(body,state.baseUrl).toByteArray()) } }.isSuccess };exportMessage=if(ok)"Markdown已导出" else "导出失败，请检查目标目录权限" } }
    LaunchedEffect(id) { repository.open(id) }
    LaunchedEffect(id,body!=null) { if(body!=null) { val (index,offset)=repository.position(id); list.scrollToItem(index.coerceIn(0,body.document.nodes.size),offset) } }
    LaunchedEffect(id,list,body!=null) { if(body!=null)snapshotFlow { list.firstVisibleItemIndex to list.firstVisibleItemScrollOffset }.drop(1).debounce(350).collect { repository.position(id,it.first,it.second) } }
    DisposableEffect(id,list,body!=null,state.serverId) { onDispose { if(body!=null)repository.keepPosition(id,list.firstVisibleItemIndex,list.firstVisibleItemScrollOffset,state.serverId) } }
    fun jump(target:String) {
        val nodes=body?.document?.nodes ?: return
        fun contains(n:DocNode):Boolean = when { target.startsWith("foot:")-> n.kind=="footnote" && n.text==target.removePrefix("foot:") || n.children.any(::contains); target.startsWith("ref:")->n.kind=="footnoteRef" && n.text==target.removePrefix("ref:") || n.children.any(::contains); else -> n.id==target || (n.kind=="heading" && DocumentParser.plain(n).lowercase().replace(' ','-')==target) || n.children.any(::contains) }
        val index=nodes.indexOfFirst(::contains); if(index>=0)scope.launch { list.scrollToItem(index+1); directory=false }
    }
    Box(Modifier.fillMaxSize().testTag("article_reader")) {
        if(body==null) Column(Modifier.fillMaxSize().padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            Text(state.articles.firstOrNull { it.id==id }?.title ?: "文章",style=MaterialTheme.typography.headlineLarge); Text(state.message)
            if(state.lockedId==id) { OutlinedTextField(password,{password=it},Modifier.fillMaxWidth().testTag("article_password"),label={Text("文章访问密码")},visualTransformation=PasswordVisualTransformation()); Button(onClick={scope.launch { repository.open(id,password,true); password="" }},enabled=!state.busy,modifier=Modifier.testTag("article_unlock")) { Text("解锁并下载") } }
            else Button(onClick={scope.launch { repository.open(id,force=true) }},enabled=!state.busy) { Text("重试下载") }
        } else LazyColumn(Modifier.fillMaxSize().testTag("article_body"),state=list,contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(18.dp)) {
            item {
                Text(body.article.title,style=MaterialTheme.typography.headlineLarge); Text(state.message)
                if(exportMessage.isNotBlank())Text(exportMessage)
                Text("${body.views}阅读 · ${body.likes}赞")
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    TextButton(onClick={scope.launch {repository.interaction(id,!body.liked)}},enabled=!state.busy,modifier=Modifier.testTag("article_like")) { Text(if(body.liked)"取消赞" else "点赞") }
                    TextButton(onClick={directory=true},Modifier.testTag("article_toc")) { Text("目录") }
                    TextButton(onClick={export.launch("${body.article.slug}.md")},Modifier.testTag("article_export")) { Text("导出Markdown") }
                    TextButton(onClick={ scope.launch {
                        val file=withContext(Dispatchers.IO) { runCatching { val folder=java.io.File(context.cacheDir,"reading-export").apply{mkdirs()};folder.listFiles()?.forEach { it.delete() };java.io.File(folder,"article-${java.util.UUID.randomUUID()}.md").apply {writeText(markdownExport(body,state.baseUrl))} }.getOrNull() }
                        if(file==null)exportMessage="无法创建分享文件" else runCatching { val uri=androidx.core.content.FileProvider.getUriForFile(context,"${context.packageName}.reading-files",file); val intent=Intent(Intent.ACTION_SEND).setType("text/markdown").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);context.startActivity(Intent.createChooser(intent,"分享Markdown")) }.onFailure {exportMessage="没有可用的分享应用"}
                    } }) { Text("分享") }
                    TextButton(onClick={scope.launch { repository.open(id,force=true) }},enabled=!state.busy) { Text("刷新正文") }
                }
                OutlinedTextField(search,{search=it},Modifier.fillMaxWidth(),label={Text("正文查找")},singleLine=true)
                if(search.isNotBlank()) { val match=body.document.nodes.indexOfFirst { DocumentParser.plain(it).contains(search,true) }; TextButton(onClick={if(match>=0)scope.launch { list.scrollToItem(match+1) }}) { Text(if(match>=0)"定位首个结果" else "未找到") } }
                if(body.document.unsupported.isNotEmpty())Text("仍有 ${body.document.unsupported.size} 项正文节点待适配：${body.document.unsupported.joinToString()}；未计为完成",color=MaterialTheme.colorScheme.error)
            }
            items(body.document.nodes,key={it.id}) { node -> DocumentBlock(node,interactions,{ picture -> CachedImage(picture,repository,{ val all=body.document.all().filter { it.kind=="image" }; val group=picture.attrs["group"]; previewImages=if(group==null)all else body.document.all().firstOrNull { it.id==group }?.let { parent -> fun images(n:DocNode):List<DocNode> = if(n.kind=="image")listOf(n) else n.children.flatMap(::images)
                        images(parent) } ?: listOf(picture); imageIndex=previewImages.indexOfFirst { it.id==picture.id }.coerceAtLeast(0) }) },::jump) }
        }
        if(directory && body!=null) {
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim.copy(alpha=.4f)).clickable {directory=false})
            Surface(Modifier.align(Alignment.CenterEnd).fillMaxHeight().widthIn(max=340.dp).fillMaxWidth(.85f).testTag("toc_drawer"),tonalElevation=8.dp) { LazyColumn(contentPadding=PaddingValues(16.dp)) { item { Text("文章目录",style=MaterialTheme.typography.titleLarge); TextButton(onClick={directory=false}) {Text("关闭")} }; items(body.document.toc,key={it.id}) { heading -> TextButton(onClick={jump(heading.id)},Modifier.fillMaxWidth().padding(start=((heading.attrs["level"]?.toIntOrNull() ?: 1)-1).coerceAtMost(4).times(10).dp)) { Text(DocumentParser.plain(heading),Modifier.fillMaxWidth()) } } } }
        }
        if(imageIndex>=0 && previewImages.isNotEmpty())ImagePreview(previewImages,imageIndex,repository) { imageIndex=-1 }
    }
}
fun markdownExport(body:ArticleBody,origin:String):String {
    fun yaml(s:String)="\""+s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r")+"\""
    var fence=false
    val absolute=body.source.lines().joinToString("\n") { line -> if(Regex("^\\s*(```|~~~)").containsMatchIn(line)) { fence=!fence;line } else if(fence)line else line.replace(Regex("\\]\\(/(?!/)"),"](${origin.trimEnd('/')}/").replace("src=\"/","src=\"${origin.trimEnd('/')}/") }
    val formatter=SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.ROOT).apply { timeZone=java.util.TimeZone.getTimeZone("UTC") }
    val dates=formatter.format(java.util.Date(body.article.createdAt)) to formatter.format(java.util.Date(body.article.updatedAt))
    return "---\ntitle: ${yaml(body.article.title)}\nslug: ${yaml(body.article.slug)}\ntype: ${yaml(body.article.type)}\nsummary: ${yaml(body.article.summary)}\ntags: [${body.article.tags.joinToString { yaml(it) }}]\ndate: ${yaml(dates.first)}\nupdated: ${yaml(dates.second)}\n---\n\n$absolute"
}
@Composable fun CachedImage(node:DocNode,repository:ReadingRepository,onClick:()->Unit,modifier:Modifier=Modifier) {
    val bytes by produceState<ByteArray?>(null,node.attrs["url"],repository.state.value.serverId) { value=runCatching { repository.image(node.attrs["url"].orEmpty()) }.getOrNull() }
    val context=LocalContext.current; val loader=remember(context) { ImageLoader.Builder(context).components { add(SvgDecoder.Factory()); add(GifDecoder.Factory()) }.diskCache(null).build() }
    Column(modifier.testTag("image_${node.id}").clickable(onClick=onClick)) {
        if(bytes==null)Box(Modifier.fillMaxWidth().height(100.dp),contentAlignment=Alignment.Center) { Text("图片未缓存或正在下载\n${node.text}") }
        else { val ratio=Regex("(?:aspect|ratio)=[\"']?(\\d+)[/:](\\d+)").find(node.attrs["gridParams"].orEmpty()); val aspect=ratio?.let { it.groupValues[1].toFloat()/it.groupValues[2].toFloat().coerceAtLeast(1f) } ?: 1.6f
            AsyncImage(ImageRequest.Builder(context).data(bytes).diskCachePolicy(CachePolicy.DISABLED).build(),node.text,imageLoader=loader,contentScale=if(node.attrs["gridParams"].orEmpty().contains("fit=cover"))ContentScale.Crop else ContentScale.Fit,modifier=Modifier.fillMaxWidth().aspectRatio(aspect)) }
        val caption=node.attrs["caption"].orEmpty().ifBlank { node.text }; if(caption.isNotBlank())Text(caption,style=MaterialTheme.typography.bodySmall)
    }
}
@Composable private fun ImagePreview(images:List<DocNode>,initial:Int,repository:ReadingRepository,onClose:()->Unit) {
    val pager=rememberPagerState(initialPage=initial,pageCount={images.size}); val scope=rememberCoroutineScope(); val context=LocalContext.current
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri -> if(uri!=null) { val node=images[pager.currentPage]; scope.launch(Dispatchers.IO) { runCatching { val bytes=repository.image(node.attrs["url"].orEmpty()); context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } } } } }
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false)) { Surface(Modifier.fillMaxSize().safeDrawingPadding().testTag("image_preview")) { Column {
        Row { TextButton(onClick=onClose,Modifier.testTag("image_close")) {Text("关闭")}; Text("${pager.currentPage+1}/${images.size}",Modifier.weight(1f).padding(16.dp)); TextButton(onClick={save.launch("图片-${pager.currentPage+1}")}) {Text("保存原图")} }
        HorizontalPager(pager,Modifier.weight(1f),userScrollEnabled=true) { page -> var scale by remember(page) {mutableFloatStateOf(1f)}; var offset by remember(page) {mutableStateOf(androidx.compose.ui.geometry.Offset.Zero)}
            val transform=rememberTransformableState { zoom,pan,_ -> scale=(scale*zoom).coerceIn(1f,5f); offset=if(scale==1f)androidx.compose.ui.geometry.Offset.Zero else offset+pan }
            Box(Modifier.fillMaxSize().transformable(transform),contentAlignment=Alignment.Center) { CachedImage(images[page].copy(attrs=images[page].attrs+mapOf("gridParams" to "fit=contain")),repository,{},Modifier.graphicsLayer {scaleX=scale;scaleY=scale;translationX=offset.x;translationY=offset.y}) }
        }
    } } }
}
