package com.byqx.nativeapp

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.byqx.core.identity.KeystoreConnectionVault
import com.byqx.core.model.ConnectionStatus
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Uses the isolated native-auth-fixture server, never real owner credentials. */
@RunWith(AndroidJUnit4::class)
class ConnectionAcceptanceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun repository() = (compose.activity.application as NativeApplication).connectionRepository
    private fun waitReady(status: ConnectionStatus) = compose.waitUntil(20_000) { repository().state.value.let { !it.busy && it.status == status } }
    private fun field(tag: String): SemanticsNodeInteraction {
        compose.onNodeWithTag("connection_screen").performScrollToNode(hasTestTag(tag))
        return compose.onNodeWithTag(tag)
    }
    private fun openConnection() {
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("home_screen").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("nav_my").performClick()
        compose.onNodeWithTag("open_connection").performScrollTo().performClick()
        field("server_address").performTextReplacement("http://127.0.0.1:4322")
    }
    private fun control(action: String): String {
        val connection = URL("http://127.0.0.1:4323/$action").openConnection() as HttpURLConnection
        connection.connectTimeout = 5000; connection.readTimeout = 5000
        return try { connection.inputStream.bufferedReader().use { it.readText() } } finally { connection.disconnect() }
    }
    private fun bind() {
        control("reconnect")
        openConnection()
        field("owner_password").performTextReplacement("native-owner-fixture-only")
        field("bind_owner").performClick()
        if (compose.onAllNodesWithTag("confirm_bind").fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithTag("confirm_bind").performClick()
        // CONNECTED may be the previous state; await the new successful binding message too.
        compose.waitUntil(20_000) { repository().state.value.let { !it.busy && it.status == ConnectionStatus.CONNECTED && it.message.contains("绑定成功") } }
    }
    @Test fun passwordDoesNotEnterSavedInstanceState() {
        openConnection()
        field("owner_password").performTextInput("ephemeral-fixture-password")
        compose.activityRule.scenario.recreate()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("connection_screen").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("connection_screen").performScrollToNode(hasTestTag("owner_password"))
        compose.onNodeWithTag("owner_password").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        field("server_address").assertTextContains("http://127.0.0.1:4322")
    }
    @Test fun ownerBindingUsesKeystoreAndSurvivesRecreation() {
        bind()
        val context = compose.activity.applicationContext
        val record = runBlocking { KeystoreConnectionVault(context).load() }!!
        assertNotNull(record.session)
        val disk = File(context.noBackupFilesDir, "owner-session.enc").readBytes().toString(Charsets.ISO_8859_1)
        assertFalse(disk.contains(record.session!!.accessToken)); assertFalse(disk.contains(record.session!!.refreshToken))
        assertFalse(disk.contains("native-owner-fixture-only"))
        compose.activityRule.scenario.recreate(); waitReady(ConnectionStatus.CONNECTED)
        compose.onNodeWithTag("connection_status").assertTextEquals("已连接 · 站主")
        compose.onNodeWithTag("connection_screen").performScrollToNode(hasTestTag("owner_password"))
        compose.onNodeWithTag("owner_password").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
    }
    @Test fun wrongPasswordKeepsExistingBinding() {
        bind(); val before = repository().state.value.binding
        field("owner_password").performTextReplacement("incorrect-fixture-password")
        field("bind_owner").performClick()
        compose.onNodeWithTag("confirm_bind").performClick()
        compose.waitUntil(20_000) { repository().state.value.let { !it.busy && it.message.contains("口令错误") } }
        assertEquals(before, repository().state.value.binding)
    }
    @Test fun realNetworkFailurePreservesCredentialsAndRecovers() {
        bind()
        val vault = KeystoreConnectionVault(compose.activity.applicationContext)
        val before = runBlocking { vault.load() }
        try {
            control("disconnect")
            field("validate_session").performClick(); waitReady(ConnectionStatus.OFFLINE)
            assertEquals(before, runBlocking { vault.load() })
        } finally { control("reconnect") }
        field("validate_session").performClick(); waitReady(ConnectionStatus.CONNECTED)
    }
    @Test fun expiredAccessRefreshesAndServerRevocationRequiresReauthentication() {
        bind()
        val vault = KeystoreConnectionVault(compose.activity.applicationContext)
        val before = runBlocking { vault.load() }!!.session!!.accessToken
        control("expire")
        field("validate_session").performClick()
        compose.waitUntil(20_000) { runBlocking { vault.load() }?.session?.accessToken != before && !repository().state.value.busy }
        waitReady(ConnectionStatus.CONNECTED)
        control("revoke")
        field("validate_session").performClick(); waitReady(ConnectionStatus.REAUTH_REQUIRED)
        val saved = runBlocking { vault.load() }!!
        assertNotNull(saved.serverId); assertNull(saved.session)
    }
    @Test fun explicitRevokeRequiresConfirmationAndPreservesBinding() {
        bind()
        field("revoke_session").performClick()
        compose.onNodeWithText("撤销本设备会话？").assertIsDisplayed()
        compose.onNodeWithTag("confirm_revoke").performClick(); waitReady(ConnectionStatus.REAUTH_REQUIRED)
        assertNotNull(repository().state.value.binding); assertNull(repository().state.value.binding!!.sessionId)
    }
}
