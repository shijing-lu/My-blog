package com.byqx.core.identity

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Serializable data class StoredSession(
    val sessionId: String, val accessToken: String, val refreshToken: String,
    val accessExpiresAt: Long, val refreshExpiresAt: Long, val clockOffset: Long,
) { override fun toString() = "StoredSession([redacted])" }
@Serializable data class ConnectionRecord(
    val baseUrl: String = "", val deviceId: String = UUID.randomUUID().toString(),
    val serverId: String? = null, val session: StoredSession? = null, val pendingRefreshId: String? = null,
) { override fun toString() = "ConnectionRecord([redacted])" }
interface ConnectionVault { suspend fun load(): ConnectionRecord?; suspend fun save(record: ConnectionRecord) }

class KeystoreConnectionVault(context: Context) : ConnectionVault {
    private val file = AtomicFile(File(context.noBackupFilesDir, "owner-session.enc"))
    private val json = Json { ignoreUnknownKeys = true }
    private val alias = "byqx_native_owner_v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }
    private fun cipher(mode: Int, iv: ByteArray? = null): Cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
        if (iv == null) init(mode, key()) else init(mode, key(), GCMParameterSpec(128, iv))
        updateAAD("com.byqx.blog.nativeapp:owner-v1".toByteArray(Charsets.UTF_8))
    }
    override suspend fun load(): ConnectionRecord? = withContext(Dispatchers.IO) {
        if (!file.baseFile.exists() && !File(file.baseFile.path + ".bak").exists()) return@withContext null
        val bytes = file.readFully()
        require(bytes.size > 29 && bytes[0] == 1.toByte()) { "凭据格式不可读取" }
        val plain = cipher(Cipher.DECRYPT_MODE, bytes.copyOfRange(1, 13)).doFinal(bytes.copyOfRange(13, bytes.size))
        try { json.decodeFromString<ConnectionRecord>(plain.toString(Charsets.UTF_8)) } finally { plain.fill(0) }
    }
    override suspend fun save(record: ConnectionRecord) = withContext(Dispatchers.IO) {
        val encryptor = cipher(Cipher.ENCRYPT_MODE)
        val plain = json.encodeToString(record).toByteArray(Charsets.UTF_8)
        val encrypted = try { encryptor.doFinal(plain) } finally { plain.fill(0) }
        val output = file.startWrite()
        try { output.write(byteArrayOf(1) + encryptor.iv + encrypted); file.finishWrite(output) }
        catch (error: Exception) { file.failWrite(output); throw error }
    }
}
