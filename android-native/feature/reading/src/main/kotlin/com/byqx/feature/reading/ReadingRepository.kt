package com.byqx.feature.reading

import android.content.Context
import androidx.room.Room
import com.byqx.core.database.*
import com.byqx.core.identity.ConnectionRepository
import com.byqx.core.network.*
import com.byqx.core.sync.ContentCipher
import com.byqx.core.sync.PrivateContentCipher
import com.byqx.core.document.*
import com.byqx.core.model.ConnectionStatus
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import retrofit2.HttpException

data class Article(val id:String,val title:String,val slug:String,val type:String,val summary:String,val cover:String?,val tags:List<String>,val encrypted:Boolean,val createdAt:Long,val updatedAt:Long,val categoryId:String?,val views:Int)
data class Category(val id:String,val name:String,val parentId:String?)
data class ReadingState(val serverId:String?=null,val baseUrl:String="",val articles:List<Article> = emptyList(),val categories:List<Category> = emptyList(),val subtitle:String="",val quotes:List<String> = emptyList(),val heroImages:List<String> = emptyList(),val heroInterval:Int=6,val quoteInterval:Long=5000,val details:Map<String,ArticleBody> = emptyMap(),val busy:Boolean=false,val message:String="绑定站主服务后读取文章",val lockedId:String?=null)
data class ArticleBody(val article:Article,val source:String,val sourceVersion:String,val document:DocumentAstV1,val views:Int=0,val likes:Int=0,val liked:Boolean=false)
private fun ArticleDto.domain()=Article(id,title,slug,type,summary,cover,tags,encrypted,createdAt,updatedAt,categoryId,views)

class ReadingRepository(private val db:NativeDatabase,private val cipher:ContentCipher,private val identity:ConnectionRepository,private val scope:CoroutineScope,private val now:()->Long=System::currentTimeMillis,private val resourceDirectory:java.io.File?=null) {
    private val dao=db.reading(); private val json=Json { ignoreUnknownKeys=true;encodeDefaults=true }; private val mutex=Mutex()
    private val imageMutex=Mutex()
    private val mutable=MutableStateFlow(ReadingState()); val state=mutable.asStateFlow()
    init { scope.launch {
        identity.state.map { it.binding }.distinctUntilChanged().collectLatest { binding ->
            mutable.value=ReadingState(serverId=binding?.serverId,baseUrl=binding?.baseUrl.orEmpty())
            if(binding==null)return@collectLatest
            coroutineScope {
                launch { dao.observe(binding.serverId).collect { rows ->
                  withContext(Dispatchers.Default) {
                    try {
                        val catalog=rows.firstOrNull { it.cacheKey=="catalog" }?.let { json.decodeFromString<CatalogDto>(cipher.decrypt(binding.serverId,it.payload)) }
                        val display=rows.firstOrNull { it.cacheKey=="display" }?.let {json.decodeFromString<ReadingDisplayDto>(cipher.decrypt(binding.serverId,it.payload))}
                        val landing=display?.landing ?: catalog?.landing;val quotes=display?.quotes ?: catalog?.quotes
                        val details=rows.filter { it.cacheKey.startsWith("article:") }.associate { row ->
                            val dto=json.decodeFromString<ArticleDetailDto>(cipher.decrypt(binding.serverId,row.payload)); val previous=mutable.value.details[dto.article.id]
                            dto.article.id to ArticleBody(dto.article.domain(),dto.source,dto.sourceVersion,previous?.takeIf { it.sourceVersion==dto.sourceVersion }?.document ?: nativeDocument(dto.source),dto.views,dto.likes,dto.liked)
                        }
                        if(mutable.value.serverId==binding.serverId)mutable.value=mutable.value.copy(articles=catalog?.articles?.map { it.domain() }.orEmpty(),categories=catalog?.categories?.map { Category(it.id,it.name,it.parentId) }.orEmpty(),subtitle=landing?.subtitle.orEmpty(),quotes=quotes?.quotes?.map {it.text}.orEmpty(),heroImages=landing?.images.orEmpty(),heroInterval=landing?.intervalSec ?: 6,quoteInterval=(quotes?.defaultPauseMs ?: 5000).toLong().coerceAtLeast(1000),details=details)
                    } catch(error:CancellationException) { throw error } catch(error:Exception) { mutable.value=mutable.value.copy(message="本机阅读缓存无法读取（${error.javaClass.simpleName}），原文件已保留") }
                  }
                } }
                launch { refreshCatalog() }
                launch { identity.state.map { it.status }.distinctUntilChanged().collect { if(it==ConnectionStatus.CONNECTED)refreshCatalog() } }
            }
        }
    } }
    private suspend fun cached(server:String,key:String)=withContext(Dispatchers.IO) { dao.get(server,key) }
    private fun nativeDocument(source:String):DocumentAstV1 {
        val document=DocumentParser().parse(source);val errors=mutableListOf<String>()
        fun validate(node:DocNode):DocNode {
            if(node.kind in listOf("math","inlineMath") && runCatching {FormulaLayout.layout(node.text,24f,android.graphics.Color.BLACK)}.isFailure) {errors+="公式 @ ${node.from}–${node.to}";return node.copy(kind="unsupported")}
            return node.copy(children=node.children.map(::validate))
        }
        return document.copy(nodes=document.nodes.map(::validate),unsupported=document.unsupported+errors)
    }
    private suspend fun put(server:String,key:String,value:String)=withContext(Dispatchers.IO) { dao.put(ReadingCacheEntity().apply { serverId=server;cacheKey=key;payload=cipher.encrypt(server,value);fetchedAt=now() }) }
    suspend fun refreshCatalog(force:Boolean=false)=mutex.withLock {
        val server=state.value.serverId ?: return@withLock
        val display=cached(server,"display")
        if(display==null || now()-display.fetchedAt>=3_600_000)try {val dto=identity.readingDisplay();require(dto.protocolVersion==1 && dto.serverId==server);put(server,"display",json.encodeToString(dto))} catch(error:CancellationException){throw error} catch(_:Exception){/* Preserve the previous display configuration. */}
        val cache=cached(server,"catalog"); if(!force && cache!=null && now()-cache.fetchedAt<300_000)return@withLock
        mutable.value=mutable.value.copy(busy=true)
        try { val dto=identity.catalog(); require(dto.protocolVersion==1 && dto.serverId==server); put(server,"catalog",json.encodeToString(dto)); mutable.value=mutable.value.copy(message="文章列表已更新") }
        catch(error:CancellationException) { throw error } catch(_:Exception) { mutable.value=mutable.value.copy(message=if(cache==null)"尚无缓存，联网后重试" else "读取本机缓存，联网后可刷新") }
        finally { mutable.value=mutable.value.copy(busy=false) }
    }
    suspend fun open(id:String,password:String?=null,force:Boolean=false)=mutex.withLock {
        val server=state.value.serverId ?: return@withLock
        val cache=cached(server,"article:$id")
        if(!force && cache!=null && now()-cache.fetchedAt<3_600_000) { mutable.value=mutable.value.copy(lockedId=null,message="读取本机正文"); return@withLock }
        mutable.value=mutable.value.copy(busy=true,lockedId=null)
        try { val dto=identity.article(id,password); require(dto.protocolVersion==1 && dto.serverId==server && dto.article.id==id); put(server,"article:$id",json.encodeToString(dto)); mutable.value=mutable.value.copy(message="正文已加密缓存，可离线阅读") }
        catch(error:CancellationException) { throw error } catch(error:HttpException) { mutable.value=mutable.value.copy(lockedId=if(error.code()==423 && cache==null)id else null,message=if(error.code()==423)"需要文章密码；已缓存解锁内容仍可离线读" else "读取失败，保留本机正文") }
        catch(_:Exception) { mutable.value=mutable.value.copy(message=if(cache==null)"尚无正文缓存，联网后重试" else "离线阅读本机正文") }
        finally { mutable.value=mutable.value.copy(busy=false) }
    }
    suspend fun position(id:String):Pair<Int,Int> = withContext(Dispatchers.IO) { val server=state.value.serverId ?: return@withContext 0 to 0; dao.position(server,id)?.let { it.itemIndex to it.offset } ?: (0 to 0) }
    suspend fun position(id:String,index:Int,offset:Int,partition:String?=state.value.serverId) = withContext(Dispatchers.IO) { val server=partition ?: return@withContext; dao.position(ReadingPositionEntity().apply { serverId=server;articleId=id;itemIndex=index.coerceAtLeast(0);this.offset=offset.coerceAtLeast(0) }) }
    fun keepPosition(id:String,index:Int,offset:Int,partition:String?=state.value.serverId) { scope.launch { try {position(id,index,offset,partition)} catch(error:CancellationException){throw error} catch(_:Exception){mutable.value=mutable.value.copy(message="阅读位置未能保存，正文缓存保留")} } }
    suspend fun interaction(id:String,liked:Boolean?=null)=mutex.withLock {
        val server=state.value.serverId ?: return@withLock
        try {
            val stats=identity.readingInteraction(id,liked)
            withContext(Dispatchers.IO) {
                val row=dao.get(server,"article:$id") ?: return@withContext
                val dto=json.decodeFromString<ArticleDetailDto>(cipher.decrypt(server,row.payload))
                row.payload=cipher.encrypt(server,json.encodeToString(dto.copy(views=stats.views,likes=stats.likes,liked=stats.liked)))
                dao.put(row) // Stats never extend the source TTL.
            }
        } catch(error:CancellationException) {throw error} catch(_:Exception) { if(liked!=null)mutable.value=mutable.value.copy(message="点赞需要联网，未排队执行；正文缓存保留") }
    }
    suspend fun ui(id:String):Map<String,Map<String,String>> { val server=state.value.serverId ?: return emptyMap(); return cached(server,"ui:$id")?.let { runCatching { json.decodeFromString<Map<String,Map<String,String>>>(cipher.decrypt(server,it.payload)) }.getOrNull() } ?: emptyMap() }
    fun keepUi(id:String,value:Map<String,Map<String,String>>,partition:String?=state.value.serverId) { val server=partition ?: return; scope.launch {try {put(server,"ui:$id",json.encodeToString(value))} catch(error:CancellationException){throw error} catch(_:Exception){mutable.value=mutable.value.copy(message="交互状态未能保存，正文缓存保留")} } }
    suspend fun search(query:String):List<Article>? = mutex.withLock {
        val server=state.value.serverId ?: return@withLock null
        val key="search:"+java.security.MessageDigest.getInstance("SHA-256").digest(query.toByteArray()).joinToString(""){"%02x".format(it)}
        val cache=cached(server,key)
        if(cache!=null && now()-cache.fetchedAt<300_000)return@withLock json.decodeFromString<ArticleSearchDto>(cipher.decrypt(server,cache.payload)).articles.map{it.domain()}
        try {val dto=identity.searchArticles(query.take(200));require(dto.protocolVersion==1 && dto.serverId==server);put(server,key,json.encodeToString(dto));dto.articles.map{it.domain()}}
        catch(error:CancellationException){throw error} catch(_:Exception){null}
    }
    suspend fun image(raw:String):ByteArray = withContext(Dispatchers.IO) {
      imageMutex.withLock {
        val server=checkNotNull(state.value.serverId); val base=java.net.URI(state.value.baseUrl); var uri=base.resolve(raw)
        val key="image:"+java.security.MessageDigest.getInstance("SHA-256").digest(uri.toASCIIString().toByteArray()).joinToString("") { "%02x".format(it) }
        val directory=checkNotNull(resourceDirectory).apply {mkdirs()}
        val filename=java.security.MessageDigest.getInstance("SHA-256").digest("$server:$key".toByteArray()).joinToString(""){"%02x".format(it)}
        val file=java.io.File(directory,"$filename.enc")
        fun local():ByteArray? = if(file.isFile)runCatching {android.util.Base64.decode(cipher.decrypt(server,file.readText()),android.util.Base64.NO_WRAP)}.getOrNull() else null
        if(file.isFile && now()-file.lastModified()<3_600_000)local()?.let {return@withContext it}
        val client=okhttp3.OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).callTimeout(20,java.util.concurrent.TimeUnit.SECONDS).build()
        try {
        repeat(5) {
            require(uri.scheme=="https" || uri.scheme=="http" && uri.host==base.host && uri.port==base.port) { "资源需要HTTPS" }; require(uri.userInfo==null)
            client.newCall(okhttp3.Request.Builder().url(uri.toASCIIString()).build()).execute().use { response ->
                if(response.code in 300..399) { uri=uri.resolve(checkNotNull(response.header("Location"))); return@repeat }
                check(response.isSuccessful); val body=checkNotNull(response.body); require(body.contentLength()<=10_000_000)
                val stream=body.byteStream(); val output=java.io.ByteArrayOutputStream(); val buffer=ByteArray(8192)
                while(true) { val n=stream.read(buffer); if(n<0)break; require(output.size()+n<=10_000_000); output.write(buffer,0,n) }
                val bytes=output.toByteArray();val atomic=android.util.AtomicFile(file);val streamOut=atomic.startWrite()
                try {streamOut.write(cipher.encrypt(server,android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP)).toByteArray());atomic.finishWrite(streamOut)} catch(error:Exception){atomic.failWrite(streamOut);throw error}
                return@withContext bytes
            }
        }; error("资源重定向过多")
        } catch(error:CancellationException){throw error} catch(error:Exception){local() ?: throw error}
      }
    }
    companion object { fun create(context:Context,identity:ConnectionRepository,scope:CoroutineScope)=ReadingRepository(Room.databaseBuilder(context,NativeDatabase::class.java,"private-notes.db").addMigrations(NativeDatabase.MIGRATION_1_2).build(),PrivateContentCipher(),identity,scope,resourceDirectory=java.io.File(context.filesDir,"reading-resources")) }
}
