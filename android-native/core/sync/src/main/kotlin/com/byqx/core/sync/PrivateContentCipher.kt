package com.byqx.core.sync

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface ContentCipher { fun encrypt(server: String, plain: String): String; fun decrypt(server: String, encrypted: String): String }
class PrivateContentCipher : ContentCipher {
    private val key: SecretKey by lazy {
        val alias = "byqx_native_private_content_v1"
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        }.generateKey()
    }
    override fun encrypt(server: String, plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key); updateAAD("byqx:private-v1:$server".toByteArray()) }
        val bytes = plain.toByteArray(Charsets.UTF_8)
        val encrypted = try { cipher.doFinal(bytes) } finally { bytes.fill(0) }
        return Base64.encodeToString(byteArrayOf(1) + cipher.iv + encrypted, Base64.NO_WRAP)
    }
    override fun decrypt(server: String, encrypted: String): String {
        val bytes = Base64.decode(encrypted, Base64.NO_WRAP)
        require(bytes.size >= 29 && bytes[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(1, 13))); updateAAD("byqx:private-v1:$server".toByteArray()) }
        val plain = cipher.doFinal(bytes.copyOfRange(13, bytes.size))
        return try { plain.toString(Charsets.UTF_8) } finally { plain.fill(0) }
    }
}
