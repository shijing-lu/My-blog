package com.byqx.nativeapp

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.byqx.core.database.NativeDatabase
import com.byqx.core.identity.*
import com.byqx.core.model.*
import com.byqx.core.network.*
import com.byqx.core.sync.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class OfflineSyncAcceptanceTest {
    private class Vault : ConnectionVault {
        var record: ConnectionRecord? = null
        override suspend fun load() = record
        override suspend fun save(record: ConnectionRecord) { this.record = record }
    }
    private class Api : MobileApi {
        var server = "a".repeat(64)
        private fun dto() = MobileSessionDto(1, server, "fixture", OwnerDto("site-owner", "owner"), System.currentTimeMillis() + 900000, System.currentTimeMillis() + 86400000, System.currentTimeMillis(), "mb1a_${"A".repeat(43)}", "mb1r_${"B".repeat(43)}")
        override suspend fun info() = ServerInfoDto(1, "fixture", true)
        override suspend fun login(body: LoginDto) = dto()
        override suspend fun me(bearer: String) = dto()
        override suspend fun refresh(body: RefreshDto) = dto()
        override suspend fun revoke(body: RevokeDto) = Unit
    }
    private class Remote {
        val records = mutableMapOf<String, SyncRecordDto>()
        val receipts = mutableMapOf<String, SyncAckDto>()
        val seen = mutableListOf<String>()
        var seq = 0L; var offline = false; var loseResponse = false; var calls = 0
        var gate: CompletableDeferred<Unit>? = null; var entered = CompletableDeferred<Unit>()
        fun change(id: String, value: NoteDto?) = SyncRecordDto(id, UUID.randomUUID().toString(), ++seq, value).also { records[id] = it }
        suspend fun call(body: SyncEnvelopeDto): SyncResultDto {
            calls++
            if (offline) throw IOException()
            entered.complete(Unit); gate?.await(); gate = null
            val acks = body.operations.map { op ->
                seen.add(op.opId)
                receipts.getOrPut(op.opId) {
                    val old = records[op.recordId]
                    val accepted = old?.revision == op.baseRevision
                    SyncAckDto(op.opId, if (accepted) "accepted" else "conflict", if (accepted) change(op.recordId, op.payload) else old ?: SyncRecordDto(op.recordId, "", 0, null))
                }
            }
            if (loseResponse) { loseResponse = false; throw IOException() }
            return SyncResultDto(1, acks, records.values.filter { it.seq > body.cursor.toLong() }, seq.toString(), false)
        }
    }
    private suspend fun identity(api: Api = Api()): ConnectionRepository = ConnectionRepository(Vault(), true, "fixture", { api }).also {
        it.initialize(); it.bind("http://localhost:4332", "synthetic", false)
    }
    private fun database(name: String? = null): NativeDatabase {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        return if (name == null) Room.inMemoryDatabaseBuilder(context, NativeDatabase::class.java).build()
        else Room.databaseBuilder(context, NativeDatabase::class.java, name).build()
    }
    private suspend fun create(repo: NotesRepository, content: String = "私人中文正文"): String = repo.newDraft().also {
        repo.draft(it, NoteContent("想法", content, listOf("灵感"))); repo.save(it)
    }
    @Test fun encryptedDraftAndOutboxSurviveDatabaseReopen() = runBlocking {
        val name = "acceptance-${UUID.randomUUID()}.db"; val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default); val auth = identity(); val remote = Remote().apply { offline = true }
        var db = database(name)
        try {
            var repo = NotesRepository(db, auth, PrivateContentCipher(), scope, {}, remote::call)
            val id = create(repo, "绝不能出现在SQLite明文中的正文")
            repo.draft(id, NoteContent("未提交草稿", "杀进程后保留的中文草稿"))
            assertFalse(repo.sync())
            withContext(Dispatchers.IO) { val row = db.notes().note("a".repeat(64), id); assertFalse(row.payload.contains("明文")); assertFalse(row.draft.contains("中文")); assertEquals(1, db.notes().pending("a".repeat(64)).size) }
            scope.coroutineContext.cancelChildren(); db.close(); db = database(name)
            repo = NotesRepository(db, auth, PrivateContentCipher(), scope, {}, remote::call)
            withTimeout(5000) { while (repo.state.value.notes.none { it.id == id }) delay(20) }
            assertEquals("杀进程后保留的中文草稿", repo.state.value.notes.first { it.id == id }.draft!!.content)
            remote.offline = false; assertTrue(repo.sync()); assertEquals("绝不能出现在SQLite明文中的正文", remote.records[id]!!.payload!!.content)
            assertEquals("杀进程后保留的中文草稿", withContext(Dispatchers.IO) { db.notes().note("a".repeat(64), id).draft.let { kotlinx.serialization.json.Json.decodeFromString<NoteDto>(PrivateContentCipher().decrypt("a".repeat(64), it)).content } })
        } finally { scope.cancel(); db.close(); context.deleteDatabase(name) }
    }
    @Test fun lostResponseRetriesTheSameOperation() = runBlocking {
        val db = database(); val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default); val remote = Remote()
        try {
            val repo = NotesRepository(db, identity(), PrivateContentCipher(), scope, {}, remote::call); val id = create(repo)
            remote.loseResponse = true; assertFalse(repo.sync()); assertTrue(repo.sync())
            assertEquals(2, remote.seen.size); assertEquals(remote.seen[0], remote.seen[1]); assertEquals(1, remote.records.size)
            assertEquals("私人中文正文", remote.records[id]!!.payload!!.content)
        } finally { scope.cancel(); db.close() }
    }
    @Test fun editDuringUploadQueuesNewVersionWithoutLosingIt() = runBlocking {
        val db = database(); val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default); val remote = Remote()
        try {
            val repo = NotesRepository(db, identity(), PrivateContentCipher(), scope, {}, remote::call); val id = create(repo, "首版")
            val release = CompletableDeferred<Unit>(); remote.gate = release
            val upload = async(Dispatchers.Default) { repo.sync() }; remote.entered.await()
            repo.draft(id, NoteContent("想法", "上传期间的新修改")); repo.save(id)
            release.complete(Unit); assertTrue(upload.await())
            assertEquals("上传期间的新修改", remote.records[id]!!.payload!!.content)
            assertEquals(2, remote.seen.distinct().size)
        } finally { scope.cancel(); db.close() }
    }
    @Test fun conflictKeepsThreeCopiesAndExplicitLocalResolution() = runBlocking {
        val db = database(); val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default); val remote = Remote()
        try {
            val repo = NotesRepository(db, identity(), PrivateContentCipher(), scope, {}, remote::call); val id = create(repo, "基础"); repo.sync()
            repo.draft(id, NoteContent("想法", "本地")); repo.save(id)
            remote.change(id, remote.records[id]!!.payload!!.copy(content = "远端"))
            assertTrue(repo.sync()); val conflict = repo.conflict(id)!!
            assertEquals("基础", conflict.base!!.content); assertEquals("本地", conflict.local!!.content); assertEquals("远端", conflict.remote!!.content)
            repo.resolve(id, true); assertTrue(repo.sync()); assertEquals("本地", remote.records[id]!!.payload!!.content)
            withContext(Dispatchers.IO) { assertTrue(db.openHelper.readableDatabase.query("SELECT resolved FROM conflicts").use { it.moveToFirst(); it.getInt(0) == 1 }) }
        } finally { scope.cancel(); db.close() }
    }
    @Test fun remoteRefreshCannotRebaseAnUnsavedDraftSilently() = runBlocking {
        val db = database(); val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default); val remote = Remote()
        try {
            val repo = NotesRepository(db, identity(), PrivateContentCipher(), scope, {}, remote::call); val id = create(repo, "基础"); repo.sync()
            repo.draft(id, NoteContent("想法", "离线草稿")); remote.change(id, remote.records[id]!!.payload!!.copy(content = "远端改动")); repo.sync()
            repo.save(id); repo.sync(); assertEquals("离线草稿", repo.conflict(id)!!.local!!.content); assertEquals("远端改动", remote.records[id]!!.payload!!.content)
        } finally { scope.cancel(); db.close() }
    }
    @Test fun outboxInsertFailureRollsBackTheNoteSave() = runBlocking {
        val db = database(); val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val repo = NotesRepository(db, identity(), PrivateContentCipher(), scope, {}, Remote()::call); val id = repo.newDraft(); repo.draft(id, NoteContent(content = "必须保留的草稿"))
            withContext(Dispatchers.IO) { db.openHelper.writableDatabase.execSQL("CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'fixture'); END") }
            var failed = false; try { repo.save(id) } catch (_: Exception) { failed = true }; assertTrue(failed)
            withContext(Dispatchers.IO) { val row = db.notes().note("a".repeat(64), id); assertNull(row.payload); assertNotNull(row.draft); assertTrue(db.notes().pending("a".repeat(64)).isEmpty()) }
        } finally { scope.cancel(); db.close() }
    }
    @Test fun deletingSyncedNotePropagatesTombstone() = runBlocking {
        val db = database(); val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default); val remote = Remote()
        try {
            val repo = NotesRepository(db, identity(), PrivateContentCipher(), scope, {}, remote::call); val id = create(repo); repo.sync(); repo.delete(id); repo.sync()
            assertNull(remote.records[id]!!.payload)
            withContext(Dispatchers.IO) { assertNull(db.notes().note("a".repeat(64), id).payload); assertNotNull(db.notes().note("a".repeat(64), id).revision) }
        } finally { scope.cancel(); db.close() }
    }
    @Test fun switchingServerPreservesOldPartition() = runBlocking {
        val db = database(); val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default); val api = Api()
        try {
            val auth = identity(api); val repo = NotesRepository(db, auth, PrivateContentCipher(), scope, {}, Remote()::call); val id = create(repo, "原站点私人资料")
            api.server = "b".repeat(64); auth.bind("http://localhost:4332", "synthetic", true)
            withTimeout(5000) { while (repo.state.value.serverId != api.server || repo.state.value.notes.isNotEmpty()) delay(20) }
            withContext(Dispatchers.IO) { assertNotNull(db.notes().note("a".repeat(64), id)); assertEquals(1, db.notes().pending("a".repeat(64)).size); assertNull(db.notes().note("b".repeat(64), id)) }
        } finally { scope.cancel(); db.close() }
    }
    @Test fun cachedEmptyListAndLocalBrowsingDoNotRequestTheNetwork() = runBlocking {
        val db = database(); val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default); val remote = Remote()
        try {
            val repo = NotesRepository(db, identity(), PrivateContentCipher(), scope, {}, remote::call)
            withTimeout(5000) { while (repo.state.value.serverId == null) delay(20) }
            assertTrue(repo.state.value.notes.isEmpty()); assertEquals(0, remote.calls)
            val id = create(repo); withTimeout(5000) { while (repo.state.value.notes.none { it.id == id }) delay(20) }
            assertEquals(0, remote.calls)
        } finally { scope.cancel(); db.close() }
    }
    @Test fun reachingPageLimitKeepsCursorAndRequestsContinuation() = runBlocking {
        val db = database(); val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default); var calls = 0
        try {
            val repo = NotesRepository(db, identity(), PrivateContentCipher(), scope, {}, { body ->
                calls++; SyncResultDto(1, emptyList(), emptyList(), (body.cursor.toLong() + 1).toString(), calls <= 50)
            })
            assertFalse(repo.sync()); assertEquals(50, calls)
            withContext(Dispatchers.IO) { assertEquals("50", db.notes().meta("a".repeat(64)).cursor) }
            assertTrue(repo.sync()); assertEquals(51, calls)
        } finally { scope.cancel(); db.close() }
    }
}
