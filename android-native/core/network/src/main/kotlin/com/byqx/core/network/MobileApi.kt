package com.byqx.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.*
import java.net.URI
import java.util.concurrent.TimeUnit

@Serializable data class ServerInfoDto(val protocolVersion: Int, val appName: String, val ownerLoginConfigured: Boolean)
@Serializable data class OwnerDto(val id: String, val role: String)
@Serializable data class MobileSessionDto(
    val protocolVersion: Int, val serverId: String, val sessionId: String, val owner: OwnerDto,
    val accessExpiresAt: Long, val refreshExpiresAt: Long, val serverTime: Long,
    val accessToken: String? = null, val refreshToken: String? = null,
) { override fun toString() = "MobileSessionDto([redacted])" }
@Serializable data class LoginDto(val password: String, val deviceId: String, val deviceName: String) { override fun toString() = "LoginDto([redacted])" }
@Serializable data class RefreshDto(val refreshToken: String, val requestId: String) { override fun toString() = "RefreshDto([redacted])" }
@Serializable data class RevokeDto(val refreshToken: String) { override fun toString() = "RevokeDto([redacted])" }
interface MobileApi {
    @GET("api/mobile/v1/auth/info") suspend fun info(): ServerInfoDto
    @POST("api/mobile/v1/auth/login") suspend fun login(@Body body: LoginDto): MobileSessionDto
    @GET("api/mobile/v1/auth/me") suspend fun me(@Header("Authorization") bearer: String): MobileSessionDto
    @POST("api/mobile/v1/auth/refresh") suspend fun refresh(@Body body: RefreshDto): MobileSessionDto
    @POST("api/mobile/v1/auth/revoke") suspend fun revoke(@Body body: RevokeDto)
}
object ServerAddress {
    fun normalize(raw: String, debug: Boolean): String {
        val uri = try { URI(raw.trim()) } catch (_: Exception) { throw IllegalArgumentException("请输入完整服务地址") }
        require(uri.userInfo == null && uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/")) { "地址只能包含协议、主机和端口" }
        val host = uri.host?.lowercase() ?: throw IllegalArgumentException("服务地址缺少主机")
        val local = host in setOf("127.0.0.1", "localhost", "10.0.2.2")
        require(uri.scheme == "https" || (debug && uri.scheme == "http" && local)) { "请使用HTTPS；测试包仅允许本机USB地址使用HTTP" }
        require(uri.port == -1 || uri.port in 1..65535) { "端口无效" }
        return URI(uri.scheme, null, host, uri.port, "/", null, null).toASCIIString()
    }
}
object MobileApiFactory {
    fun reading(baseUrl: String): ReadingApi = Retrofit.Builder().baseUrl(baseUrl).client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(ReadingApi::class.java)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).callTimeout(20, TimeUnit.SECONDS).build()
    fun create(baseUrl: String): MobileApi = Retrofit.Builder().baseUrl(baseUrl).client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(MobileApi::class.java)
    fun sync(baseUrl: String): SyncApi = Retrofit.Builder().baseUrl(baseUrl).client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(SyncApi::class.java)
}
