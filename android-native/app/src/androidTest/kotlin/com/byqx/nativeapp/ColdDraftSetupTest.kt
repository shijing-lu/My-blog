package com.byqx.nativeapp

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.byqx.core.model.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Creates only a synthetic unsaved draft; ADB performs the actual process kill and verifies the reopened UI. */
@RunWith(AndroidJUnit4::class)
class ColdDraftSetupTest {
    @Test fun prepareEncryptedColdStartDraft() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<NativeApplication>()
        app.connectionRepository.initialize()
        app.connectionRepository.bind("http://127.0.0.1:4332", "native-owner-fixture-only", true)
        assertEquals(ConnectionStatus.CONNECTED, app.connectionRepository.state.value.status)
        val id = app.notesRepository.newDraft()
        app.notesRepository.draft(id, NoteContent("进程恢复验收", "杀进程后保留的中文草稿 stage3-cold-draft-20261007"))
        withTimeout(5000) { while (app.notesRepository.state.value.notes.none { it.id == id && it.draft?.content?.contains("stage3-cold-draft-20261007") == true }) delay(20) }
        assertTrue(app.notesRepository.state.value.notes.first { it.id == id }.draft != null)
    }
}
