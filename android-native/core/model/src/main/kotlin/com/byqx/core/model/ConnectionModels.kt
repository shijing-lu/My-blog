package com.byqx.core.model

import kotlinx.coroutines.flow.StateFlow

enum class ConnectionStatus { LOADING, UNBOUND, CONNECTED, OFFLINE, REAUTH_REQUIRED, STORAGE_ERROR }
data class OwnerBinding(val serverId: String, val baseUrl: String, val sessionId: String?, val accessExpiresAt: Long?)
data class ConnectionState(
    val status: ConnectionStatus = ConnectionStatus.LOADING,
    val configuredUrl: String = "", val binding: OwnerBinding? = null,
    val busy: Boolean = false, val message: String = "正在恢复本机凭据…",
)
interface OwnerConnectionRepository {
    val state: StateFlow<ConnectionState>
    suspend fun initialize()
    suspend fun testConnection(url: String)
    suspend fun bind(url: String, password: String, confirmReplacement: Boolean)
    suspend fun validate(force: Boolean = false)
    suspend fun revoke()
}
