package com.byqx.core.network

import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class SyncBatchingTest {
    @Test fun largeChineseAndEscapedNotesSplitWithoutChangingOperationIds() {
        for (content in listOf("中".repeat(20000), "\u0000".repeat(20000))) {
            val pending = (1..50).map { SyncOperationDto("op-$it", "note-$it", null, NoteDto("标题", content, emptyList(), 1, 2)) }
            val envelope = SyncBatching.envelope("fixture", "0", pending)
            assertTrue(envelope.operations.isNotEmpty()); assertTrue(envelope.operations.size < 50)
            assertEquals(pending.take(envelope.operations.size), envelope.operations)
            assertTrue(Json { encodeDefaults = true }.encodeToString(envelope).toByteArray(Charsets.UTF_8).size <= SyncBatching.MAX_BYTES)
        }
    }
    @Test fun emptyPullStillIncludesProtocolVersion() {
        val envelope = SyncBatching.envelope("fixture", "23", emptyList())
        assertTrue(Json { encodeDefaults = true }.encodeToString(envelope).contains("\"protocolVersion\":1"))
        assertEquals("23", envelope.cursor)
    }
}
