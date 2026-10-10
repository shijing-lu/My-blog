package com.byqx.core.identity

import com.byqx.core.model.ConnectionStatus
import com.byqx.core.network.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class ConnectionRepositoryTest {
    private class Vault : ConnectionVault {
        var value: ConnectionRecord? = null
        override suspend fun load() = value
        override suspend fun save(record: ConnectionRecord) { value = record }
    }
    private class Api : MobileApi {
        var offline = false; var revoked = false; var failRefreshOnce = false; var unavailable = false
        var role = "owner"; var serverId = "a".repeat(64); var refreshCalls = mutableListOf<String>()
        var token = "A".repeat(43)
        private fun check() { if (offline) throw IOException(); if (revoked) throw HttpException(Response.error<Unit>(401, "".toResponseBody())); if (unavailable) throw HttpException(Response.error<Unit>(503, "".toResponseBody())) }
        private fun dto() = MobileSessionDto(1, serverId, "session", OwnerDto("site-owner", role), 900_000, 86400_000, 1000, "mb1a_$token", "mb1r_${"B".repeat(43)}")
        override suspend fun info(): ServerInfoDto { check(); return ServerInfoDto(1, "Test", true) }
        override suspend fun login(body: LoginDto): MobileSessionDto { check(); if (body.password != "fixture") throw HttpException(Response.error<Unit>(401, "".toResponseBody())); return dto() }
        override suspend fun me(bearer: String): MobileSessionDto { check(); return dto().copy(accessToken = null, refreshToken = null) }
        override suspend fun refresh(body: RefreshDto): MobileSessionDto {
            check(); refreshCalls.add(body.requestId)
            if (failRefreshOnce) { failRefreshOnce = false; throw IOException() }
            token = "C".repeat(43); return dto()
        }
        override suspend fun revoke(body: RevokeDto) { check(); revoked = true }
    }
    @Test fun persistsAndRestoresBindingWithoutPersistingPassword() = runBlocking {
        val vault = Vault(); val api = Api(); val repo = ConnectionRepository(vault, true, "test", { api }, { 1000 })
        repo.initialize(); repo.bind("http://127.0.0.1:4321", "fixture", false)
        assertEquals(ConnectionStatus.CONNECTED, repo.state.value.status)
        val fresh = ConnectionRepository(vault, true, "test", { api }, { 1000 })
        fresh.initialize()
        assertEquals(repo.state.value.binding, fresh.state.value.binding)
        assertFalse(vault.value.toString().contains("fixture"))
    }
    @Test fun offlineStartupKeepsExistingTokensAndRecovers() = runBlocking {
        val vault = Vault(); val api = Api(); val first = ConnectionRepository(vault, true, "test", { api }, { 1000 })
        first.initialize(); first.bind("http://localhost:4321", "fixture", false)
        val before = vault.value; api.offline = true
        val fresh = ConnectionRepository(vault, true, "test", { api }, { 1000 }); fresh.initialize()
        assertEquals(ConnectionStatus.OFFLINE, fresh.state.value.status); assertEquals(before, vault.value)
        api.offline = false; fresh.validate(true); assertEquals(ConnectionStatus.CONNECTED, fresh.state.value.status)
    }
    @Test fun invalidIdentityAndWrongPasswordCannotReplaceBinding() = runBlocking {
        val vault = Vault(); val api = Api(); val repo = ConnectionRepository(vault, true, "test", { api }, { 1000 })
        repo.initialize(); api.role = "github-top"; repo.bind("http://localhost:4321", "fixture", false)
        assertNull(vault.value?.session)
        api.role = "owner"; repo.bind("http://localhost:4321", "fixture", false)
        val before = vault.value; repo.bind("http://localhost:4321", "wrong", true)
        assertEquals(before, vault.value); assertEquals(ConnectionStatus.CONNECTED, repo.state.value.status)
        repo.bind("http://127.0.0.1:4322", "fixture", false); assertEquals(before, vault.value)
    }
    @Test fun rejectedRefreshRetainsBindingAndDropsOnlyInvalidCredentials() = runBlocking {
        val vault = Vault(); val api = Api(); val repo = ConnectionRepository(vault, true, "test", { api }, { 1000 })
        repo.initialize(); repo.bind("http://localhost:4321", "fixture", false); api.revoked = true
        repo.validate(true)
        assertEquals(ConnectionStatus.REAUTH_REQUIRED, repo.state.value.status)
        assertNotNull(vault.value?.serverId); assertNull(vault.value?.session)
    }
    @Test fun uncertainRefreshReusesEncryptedPendingRequestAfterRestart() = runBlocking {
        val vault = Vault(); val api = Api(); var clock = 1000L
        val first = ConnectionRepository(vault, true, "test", { api }, { clock })
        first.initialize(); first.bind("http://localhost:4321", "fixture", false)
        clock = 900_000; api.failRefreshOnce = true; first.validate(true)
        val requestId = vault.value?.pendingRefreshId; assertNotNull(requestId)
        val fresh = ConnectionRepository(vault, true, "test", { api }, { clock }); fresh.initialize()
        assertEquals(listOf(requestId, requestId), api.refreshCalls)
        assertNull(vault.value?.pendingRefreshId); assertEquals(ConnectionStatus.CONNECTED, fresh.state.value.status)
    }
    @Test fun revokeDoesNotQueueWhileOfflineAndRequiresExplicitRetry() = runBlocking {
        val vault = Vault(); val api = Api(); val repo = ConnectionRepository(vault, true, "test", { api }, { 1000 })
        repo.initialize(); repo.bind("http://localhost:4321", "fixture", false)
        api.offline = true; repo.revoke(); assertNotNull(vault.value?.session)
        api.offline = false; repo.validate(true); assertFalse(api.revoked)
        repo.revoke(); assertTrue(api.revoked); assertNull(vault.value?.session); assertNotNull(vault.value?.serverId)
    }
    @Test fun damagedVaultIsPreservedUntilExplicitBinding() = runBlocking {
        var writes = 0
        val vault = object : ConnectionVault {
            override suspend fun load(): ConnectionRecord? = throw IOException("synthetic corrupt ciphertext")
            override suspend fun save(record: ConnectionRecord) { writes++ }
        }
        val repo = ConnectionRepository(vault, true, "test", { Api() }, { 1000 }); repo.initialize()
        assertEquals(ConnectionStatus.STORAGE_ERROR, repo.state.value.status); assertEquals(0, writes)
    }
    @Test fun unavailableAuthorityDoesNotReportConnectedOrDiscardCredentials() = runBlocking {
        val vault = Vault(); val api = Api(); val repo = ConnectionRepository(vault, true, "test", { api }, { 1000 })
        repo.initialize(); repo.bind("http://localhost:4321", "fixture", false)
        val before = vault.value; api.unavailable = true; repo.validate(true)
        assertEquals(ConnectionStatus.OFFLINE, repo.state.value.status); assertEquals(before, vault.value)
    }
}
