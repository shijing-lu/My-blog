package com.byqx.core.sync

import android.content.Context
import androidx.room.Room
import com.byqx.core.database.*
import com.byqx.core.identity.ConnectionRepository
import com.byqx.core.model.*
import com.byqx.core.network.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.util.UUID

class NotesRepository(
    private val db: NativeDatabase, private val identity: ConnectionRepository,
    private val cipher: ContentCipher, private val scope: CoroutineScope,
    private val schedule: () -> Unit,
    private val transport: suspend (SyncEnvelopeDto) -> SyncResultDto = identity::sync,
) {
    private val dao = db.notes()
    private val json = Json { ignoreUnknownKeys = true }
    private val mutable = MutableStateFlow(NotesState())
    val state = mutable.asStateFlow()
    private val syncMutex = Mutex()
    private fun NoteContent.dto() = NoteDto(title, content, tags, createdAt, updatedAt)
    private fun NoteDto.domain() = NoteContent(title, content, tags, createdAt, updatedAt)
    private fun encode(server: String, value: NoteDto?) = value?.let { cipher.encrypt(server, json.encodeToString(it)) }
    private fun decode(server: String, value: String?) = value?.let { json.decodeFromString<NoteDto>(cipher.decrypt(server, it)) }
    private fun same(server: String, a: String?, b: String?) = decode(server, a) == decode(server, b)
    private suspend fun <T> transaction(work: () -> T): T = withContext(Dispatchers.IO) { db.runInTransaction(java.util.concurrent.Callable { work() }) }
    init {
        scope.launch {
            identity.state.map { it.binding?.serverId }.distinctUntilChanged().collectLatest { server ->
                mutable.value = NotesState(serverId = server, message = if (server == null) "先在「我的」绑定站主服务" else "读取加密本地资料")
                if (server != null) try {
                    dao.observe(server).flowOn(Dispatchers.IO).collect { rows ->
                        val list = withContext(Dispatchers.IO) { rows.mapNotNull { r ->
                            if (r.payload == null && r.draft == null && !r.conflicted) null
                            else LocalNote(r.id, decode(server, r.payload)?.domain(), decode(server, r.draft)?.domain(), dao.operation(server, r.id) != null, r.conflicted)
                        } }
                        mutable.value = mutable.value.copy(notes = list, storageError = false)
                    }
                } catch (error: CancellationException) { throw error }
                catch (_: Exception) { mutable.value = mutable.value.copy(storageError = true, message = "私人资料不可解密或本机存储异常，原文件已保留，请勿清理应用数据") }
            }
        }
        scope.launch {
            identity.state.map { it.binding?.serverId to it.status }.distinctUntilChanged().collect { (_, status) ->
                if (status == ConnectionStatus.CONNECTED) schedule()
            }
        }
    }
    private fun server() = checkNotNull(identity.state.value.binding?.serverId) { "请先绑定站主服务" }
    private fun enqueue(row: NoteEntity) {
        if (dao.operation(row.serverId, row.id) != null || row.conflicted) return
        dao.enqueue(OutboxEntity().apply { opId = UUID.randomUUID().toString(); serverId = row.serverId; noteId = row.id; baseRevision = row.revision; basePayload = row.basePayload; payload = row.payload })
    }
    suspend fun newDraft(): String {
        val server = server(); val id = UUID.randomUUID().toString()
        transaction { dao.put(NoteEntity().apply { this.serverId = server; this.id = id; draft = encode(server, NoteContent().dto()); localUpdatedAt = System.currentTimeMillis() }) }
        return id
    }
    suspend fun draft(id: String, value: NoteContent) {
        val server = server()
        require(value.title.length <= 120 && value.content.length <= 20000 && value.tags.size <= 10 && value.tags.all { it.length <= 20 }) { "标题、正文或标签超过限制" }
        transaction { val row = checkNotNull(dao.note(server, id)); row.draft = encode(server, value.dto()); row.localUpdatedAt = System.currentTimeMillis(); dao.put(row) }
    }
    suspend fun beginEditing(id: String) {
        val server = server()
        transaction {
            val row = checkNotNull(dao.note(server, id))
            if (!row.conflicted && row.draft == null && row.payload != null) { row.draft = row.payload; dao.put(row) }
        }
    }
    suspend fun save(id: String) {
        val server = server()
        transaction {
            val row = checkNotNull(dao.note(server, id)); val content = checkNotNull(decode(server, row.draft ?: row.payload))
            require(content.content.isNotBlank()) { "正文不能为空" }; check(!row.conflicted) { "请先处理这条记录的同步冲突，草稿已保留" }
            row.payload = encode(server, content.copy(updatedAt = maxOf(System.currentTimeMillis(), content.createdAt)))
            row.draft = null; row.localUpdatedAt = System.currentTimeMillis(); enqueue(row); dao.put(row)
        }
        mutable.value = mutable.value.copy(message = "已保存到本机，等待联网同步")
        schedule()
    }
    suspend fun delete(id: String) {
        val server = server()
        transaction { val row = checkNotNull(dao.note(server, id)); check(!row.conflicted) { "先处理同步冲突" }; row.payload = null; row.draft = null; enqueue(row); dao.put(row) }
        schedule()
    }
    suspend fun conflict(id: String): NoteConflict? = withContext(Dispatchers.IO) {
        val server = server(); dao.conflictFor(server, id)?.let { NoteConflict(it.id, decode(server, it.basePayload)?.domain(), decode(server, it.localPayload)?.domain(), decode(server, it.remotePayload)?.domain()) }
    }
    suspend fun resolve(id: String, keepLocal: Boolean) {
        val server = server()
        transaction {
            val row = checkNotNull(dao.note(server, id)); val conflict = checkNotNull(dao.conflictFor(server, id))
            row.basePayload = conflict.remotePayload; row.revision = conflict.remoteRevision.ifEmpty { null }; row.serverSeq = conflict.remoteSeq
            row.payload = if (keepLocal) conflict.localPayload else conflict.remotePayload
            row.conflicted = false; dao.resolve(conflict.id)
            if (keepLocal && !same(server, row.payload, row.basePayload)) enqueue(row)
            dao.put(row)
            dao.meta(SyncMetaEntity().apply { serverId = server; cursor = "0" })
        }
        schedule()
    }
    suspend fun sync(): Boolean = syncMutex.withLock {
        val server = identity.state.value.binding?.serverId ?: return@withLock true
        if (mutable.value.storageError) return@withLock false
        mutable.value = mutable.value.copy(busy = true, message = "正在同步…")
        try {
            var pages = 0
            var more = false
            do {
                val batch = transaction { dao.pending(server) to (dao.meta(server)?.cursor ?: "0") }
                val request = SyncBatching.envelope(server, batch.second, batch.first.map { SyncOperationDto(it.opId, it.noteId, it.baseRevision, decode(server, it.payload)) })
                val result = transport(request)
                require(result.protocolVersion == 1 && result.cursor.toLong() >= batch.second.toLong())
                require(result.acknowledgements.map { it.opId }.toSet() == request.operations.map { it.opId }.toSet())
                transaction {
                    for (ack in result.acknowledgements) {
                        val op = batch.first.first { it.opId == ack.opId }; val row = checkNotNull(dao.note(server, op.noteId))
                        require(ack.record.recordId == op.noteId && ack.status in setOf("accepted", "conflict"))
                        dao.acknowledge(op.opId)
                        if (ack.status == "conflict") {
                            dao.conflict(ConflictEntity().apply { id = UUID.randomUUID().toString(); serverId = server; noteId = row.id; basePayload = op.basePayload; localPayload = row.payload; remotePayload = encode(server, ack.record.payload); remoteRevision = ack.record.revision; remoteSeq = ack.record.seq })
                            row.conflicted = true
                        } else {
                            row.basePayload = encode(server, ack.record.payload); row.revision = ack.record.revision; row.serverSeq = ack.record.seq
                            if (same(server, row.payload, op.payload)) row.payload = row.basePayload else enqueue(row)
                        }
                        dao.put(row)
                    }
                    for (remote in result.records) {
                        val row = dao.note(server, remote.recordId) ?: NoteEntity().apply { serverId = server; id = remote.recordId }
                        if (row.serverSeq >= remote.seq || row.conflicted || row.draft != null || dao.operation(server, row.id) != null) continue
                        row.payload = encode(server, remote.payload); row.basePayload = row.payload; row.revision = remote.revision; row.serverSeq = remote.seq
                        row.localUpdatedAt = remote.payload?.updatedAt ?: System.currentTimeMillis(); dao.put(row)
                    }
                    dao.meta(SyncMetaEntity().apply { serverId = server; cursor = result.cursor })
                }
                pages++
                more = result.hasMore
                val pending = transaction { dao.pending(server).isNotEmpty() }
            } while ((result.hasMore || pending) && pages < 50)
            val complete = !more && transaction { dao.pending(server).isEmpty() }
            mutable.value = mutable.value.copy(message = if (complete) "本机资料已同步；冲突记录需手动处理" else "本批资料已保存，将从当前游标继续同步")
            complete
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            mutable.value = mutable.value.copy(message = if (identity.state.value.status == ConnectionStatus.REAUTH_REQUIRED || error is HttpException && error.code() in listOf(401, 403)) "身份已失效，草稿和待同步修改已保留，请重新认证" else "同步未完成，本机草稿和队列已保留，联网后重试")
            false
        } finally { mutable.value = mutable.value.copy(busy = false) }
    }
    companion object {
        fun create(context: Context, identity: ConnectionRepository, scope: CoroutineScope): NotesRepository = NotesRepository(
            Room.databaseBuilder(context, NativeDatabase::class.java, "private-notes.db").addMigrations(NativeDatabase.MIGRATION_1_2).build(), identity, PrivateContentCipher(), scope,
            { NotesSyncWork.enqueue(context) },
        )
    }
}
