package com.byqx.core.identity

import com.byqx.core.model.*
import com.byqx.core.network.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException
import java.io.IOException
import java.util.UUID

class ConnectionRepository(
    private val vault: ConnectionVault, private val debug: Boolean, private val deviceName: String,
    private val api: (String) -> MobileApi = MobileApiFactory::create,
    private val now: () -> Long = System::currentTimeMillis,
) : OwnerConnectionRepository {
    private val mutable = MutableStateFlow(ConnectionState())
    override val state = mutable.asStateFlow()
    private val mutex = Mutex()
    private var record = ConnectionRecord()
    private var initialized = false
    private var checkedAt = 0L
    private class StorageFailure : RuntimeException()
    private suspend fun persist(next: ConnectionRecord) {
        try { vault.save(next); record = next }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { throw StorageFailure() }
    }
    private fun publish(status: ConnectionStatus, message: String) {
        mutable.value = ConnectionState(status, record.baseUrl, record.serverId?.let {
            OwnerBinding(it, record.baseUrl, record.session?.sessionId, record.session?.accessExpiresAt)
        }, false, message)
    }
    private fun session(dto: MobileSessionDto): StoredSession {
        require(dto.protocolVersion == 1 && dto.owner.role == "owner" && dto.owner.id == "site-owner" &&
            dto.serverId.matches(Regex("[a-f0-9]{64}"))) { "服务端没有返回有效站主身份" }
        require(dto.accessToken?.matches(Regex("mb1a_[A-Za-z0-9_-]{43}")) == true &&
            dto.refreshToken?.matches(Regex("mb1r_[A-Za-z0-9_-]{43}")) == true &&
            dto.refreshExpiresAt > dto.accessExpiresAt && dto.accessExpiresAt > 0) { "服务端会话格式不兼容" }
        return StoredSession(dto.sessionId, dto.accessToken!!, dto.refreshToken!!, dto.accessExpiresAt, dto.refreshExpiresAt, dto.serverTime - now())
    }
    private suspend fun action(networkFailureAffectsBinding: Boolean = false, showBusy: Boolean = true, work: suspend () -> Unit) = mutex.withLock {
        if (showBusy) mutable.value = mutable.value.copy(busy = true)
        try { work() }
        catch (error: CancellationException) { throw error }
        catch (_: StorageFailure) { publish(ConnectionStatus.STORAGE_ERROR, "凭据无法安全保存，原记录已保留。请检查本机存储后重试") }
        catch (error: IllegalArgumentException) { mutable.value = mutable.value.copy(message = error.message ?: "配置不正确") }
        catch (error: HttpException) {
            val message = when (error.code()) {
            401 -> "站主口令错误或会话已失效，请重新认证"
            429 -> "尝试过于频繁，请稍后重试"
            503 -> "服务端暂不可用或尚未配置移动认证"
            else -> "服务端未完成请求（${error.code()}），原绑定已保留"
            }
            if (networkFailureAffectsBinding && record.serverId != null && state.value.status != ConnectionStatus.REAUTH_REQUIRED) publish(ConnectionStatus.OFFLINE, "$message；已保留本地绑定")
            else mutable.value = mutable.value.copy(message = message)
        }
        catch (_: IOException) {
            if (networkFailureAffectsBinding && record.serverId != null) publish(ConnectionStatus.OFFLINE, "暂时无法连接服务，已保留加密凭据与本地绑定")
            else mutable.value = mutable.value.copy(message = "无法连接服务，请检查地址、网络或USB连接")
        }
        catch (_: Exception) { mutable.value = mutable.value.copy(message = "请求未完成，原绑定已保留；请检查服务协议或本机凭据") }
        finally { if (showBusy) mutable.value = mutable.value.copy(busy = false) }
    }
    override suspend fun initialize() {
        mutex.withLock {
            if (initialized) return
            try {
                record = vault.load() ?: ConnectionRecord(baseUrl = if (debug) "http://127.0.0.1:4321/" else "")
                publish(if (record.session != null) ConnectionStatus.OFFLINE else if (record.serverId != null) ConnectionStatus.REAUTH_REQUIRED else ConnectionStatus.UNBOUND,
                    if (record.session != null) "已恢复加密凭据，正在联网校验…" else "请输入服务地址并绑定站主身份")
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { publish(ConnectionStatus.STORAGE_ERROR, "本机凭据不可读取。重新绑定可替换凭据，不会清理业务资料") }
            initialized = true
        }
        validate()
    }
    override suspend fun testConnection(url: String) = action {
        val normalized = ServerAddress.normalize(url, debug)
        val info = api(normalized).info()
        require(info.protocolVersion == 1) { "服务端移动协议版本不兼容" }
        require(info.ownerLoginConfigured) { "连接成功，但服务端尚未配置站主口令与AUTH_SECRET" }
        if (record.serverId == null) persist(record.copy(baseUrl = normalized))
        mutable.value = mutable.value.copy(configuredUrl = if (record.serverId == null) normalized else record.baseUrl, message = "连接成功 · ${info.appName} · 移动协议 v1")
    }
    override suspend fun bind(url: String, password: String, confirmReplacement: Boolean) = action {
        require(record.serverId == null || confirmReplacement) { "请确认重新绑定后再继续" }
        require(password.isNotEmpty()) { "请输入站主口令" }
        val normalized = ServerAddress.normalize(url, debug)
        val service = api(normalized)
        val dto = service.login(LoginDto(password, record.deviceId, deviceName.take(80)))
        val saved = session(dto)
        val identity = service.me("Bearer ${saved.accessToken}")
        require(identity.serverId == dto.serverId && identity.sessionId == dto.sessionId && identity.owner.role == "owner") { "站主身份验证失败" }
        persist(record.copy(baseUrl = normalized, serverId = dto.serverId, session = saved, pendingRefreshId = null))
        checkedAt = now()
        publish(ConnectionStatus.CONNECTED, "站主绑定成功，口令未保存在本机")
    }
    private suspend fun refresh(service: MobileApi) {
        val saved = record.session ?: return
        val requestId = record.pendingRefreshId ?: UUID.randomUUID().toString()
        if (record.pendingRefreshId == null) persist(record.copy(pendingRefreshId = requestId))
        try {
            val dto = service.refresh(RefreshDto(saved.refreshToken, requestId))
            require(dto.serverId == record.serverId && dto.sessionId == saved.sessionId) { "服务身份已改变，请重新绑定" }
            persist(record.copy(session = session(dto), pendingRefreshId = null))
        } catch (error: HttpException) {
            if (error.code() == 401 || error.code() == 403) {
                persist(record.copy(session = null, pendingRefreshId = null))
                publish(ConnectionStatus.REAUTH_REQUIRED, "会话已失效。本地绑定和业务资料已保留，请重新认证")
            }
            throw error
        }
    }
    override suspend fun validate(force: Boolean) = validateInternal(force, true)
    private suspend fun validateInternal(force: Boolean, showBusy: Boolean) = action(networkFailureAffectsBinding = true, showBusy = showBusy) {
        if (!initialized || record.session == null || (!force && state.value.status == ConnectionStatus.CONNECTED && now() - checkedAt < 30_000)) return@action
        val service = api(ServerAddress.normalize(record.baseUrl, debug))
        var saved = record.session!!
        if (record.pendingRefreshId != null || now() + saved.clockOffset >= saved.accessExpiresAt - 30_000) refresh(service)
        saved = record.session ?: return@action
        val dto = try { service.me("Bearer ${saved.accessToken}") } catch (error: HttpException) {
            if (error.code() != 401 && error.code() != 403) throw error
            refresh(service)
            service.me("Bearer ${record.session?.accessToken ?: return@action}")
        }
        require(dto.protocolVersion == 1 && dto.owner.role == "owner" && dto.owner.id == "site-owner" && dto.serverId == record.serverId && dto.sessionId == record.session?.sessionId) { "服务身份已改变，请重新绑定" }
        checkedAt = now()
        publish(ConnectionStatus.CONNECTED, "已联网校验站主身份")
    }
    override suspend fun revoke() = action(networkFailureAffectsBinding = true) {
        val saved = record.session ?: return@action
        api(ServerAddress.normalize(record.baseUrl, debug)).revoke(RevokeDto(saved.refreshToken))
        persist(record.copy(session = null, pendingRefreshId = null))
        publish(ConnectionStatus.REAUTH_REQUIRED, "本设备会话已撤销，本地资料保留；重新使用需认证")
    }
    /** Credentials stay inside the identity layer; worker gets only the authenticated response. */
    private suspend fun <T> readingCall(block: suspend (ReadingApi, String) -> T): T {
        initialize(); validateInternal(false, false)
        return mutex.withLock {
            check(state.value.status == ConnectionStatus.CONNECTED) { "需要恢复站主认证后阅读" }
            val service = MobileApiFactory.reading(record.baseUrl)
            try { block(service, "Bearer ${record.session!!.accessToken}") }
            catch (error: HttpException) {
                if (error.code() !in listOf(401,403)) throw error
                refresh(api(record.baseUrl)); block(service, "Bearer ${record.session!!.accessToken}")
            }
        }
    }
    suspend fun catalog(): CatalogDto = readingCall { service, bearer -> service.catalog(bearer) }
    suspend fun article(id: String, password: String? = null): ArticleDetailDto = readingCall { service, bearer ->
        service.detail(bearer, ReadingRequest(checkNotNull(record.serverId), id, password))
    }
    suspend fun readingInteraction(id:String,liked:Boolean?=null):ReadingInteractionDto = readingCall { service,bearer ->
        val body=ReadingRequest(checkNotNull(record.serverId),id,liked=liked)
        if(liked==null)service.view(bearer,body) else service.like(bearer,body)
    }
    suspend fun searchArticles(query:String):ArticleSearchDto = readingCall {service,bearer->service.search(bearer,query)}
    suspend fun readingDisplay():ReadingDisplayDto = readingCall {service,bearer->service.display(bearer)}
    suspend fun sync(body: SyncEnvelopeDto): SyncResultDto {
        initialize()
        validateInternal(false, false)
        return mutex.withLock {
            check(state.value.status == ConnectionStatus.CONNECTED && body.serverId == record.serverId) { "需要恢复站主认证后同步" }
            try { MobileApiFactory.sync(record.baseUrl).sync("Bearer ${record.session!!.accessToken}", body) }
            catch (error: HttpException) {
                if (error.code() == 401 || error.code() == 403) {
                    refresh(api(record.baseUrl))
                    MobileApiFactory.sync(record.baseUrl).sync("Bearer ${record.session!!.accessToken}", body)
                } else throw error
            }
        }
    }
}
