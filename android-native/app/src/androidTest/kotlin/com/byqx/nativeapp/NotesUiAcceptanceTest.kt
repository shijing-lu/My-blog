package com.byqx.nativeapp

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.byqx.core.model.ConnectionStatus
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NotesUiAcceptanceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun app() = compose.activity.application as NativeApplication
    private fun control(action: String) { (URL("http://127.0.0.1:4333/$action").openConnection() as HttpURLConnection).let { c -> c.connectTimeout = 5000; c.readTimeout = 5000; try { c.inputStream.close() } finally { c.disconnect() } } }
    private fun bind() {
        control("reconnect")
        runBlocking { app().connectionRepository.initialize(); app().connectionRepository.bind("http://127.0.0.1:4332", "native-owner-fixture-only", true) }
        compose.waitUntil(15000) { app().connectionRepository.state.value.status == ConnectionStatus.CONNECTED && app().notesRepository.state.value.serverId != null }
    }
    private fun openNotes() {
        compose.onNodeWithTag("home_screen").performScrollToNode(hasTestTag("module_notes"))
        compose.onNodeWithTag("module_notes").performClick()
        compose.onNodeWithTag("note_new").performClick()
        compose.waitUntil(5000) { compose.onAllNodesWithTag("note_editor").fetchSemanticsNodes().isNotEmpty() }
    }
    private fun field(tag: String): SemanticsNodeInteraction {
        compose.onNodeWithTag("note_editor").performScrollToNode(hasTestTag(tag)); return compose.onNodeWithTag(tag)
    }
    @Test fun chineseDraftSurvivesRecreationAndSavesToRealService() {
        bind(); openNotes(); val marker = "中文真机记录-${UUID.randomUUID()}"
        field("note_title").performTextReplacement("真机随心录")
        field("note_content").performTextReplacement(marker)
        compose.waitUntil(5000) { app().notesRepository.state.value.notes.any { it.draft?.content == marker } }
        compose.activityRule.scenario.recreate()
        compose.waitUntil(5000) { compose.onAllNodesWithTag("note_editor").fetchSemanticsNodes().isNotEmpty() }
        field("note_content").assertTextContains(marker)
        field("note_save").performClick()
        compose.waitUntil(5000) { app().notesRepository.state.value.notes.any { it.value?.content == marker && it.draft == null } }
        runBlocking { assertTrue(app().notesRepository.sync()) }
        compose.waitUntil(5000) { app().notesRepository.state.value.notes.any { it.value?.content == marker && !it.pending } }
    }
    @Test fun offlineUiSaveRetainsOutboxAndReconnectUploads() {
        bind(); control("disconnect")
        try {
            openNotes(); val marker = "断网保存-${UUID.randomUUID()}"
            field("note_content").performTextReplacement(marker)
            field("note_save").performClick()
            compose.waitUntil(5000) { app().notesRepository.state.value.notes.any { it.value?.content == marker && it.pending } }
            runBlocking { assertFalse(app().notesRepository.sync()) }
            assertTrue(app().notesRepository.state.value.notes.any { it.value?.content == marker && it.pending })
            control("reconnect")
            runBlocking { assertTrue(app().notesRepository.sync()) }
            compose.waitUntil(5000) { app().notesRepository.state.value.notes.any { it.value?.content == marker && !it.pending } }
        } finally { control("reconnect") }
    }
}
