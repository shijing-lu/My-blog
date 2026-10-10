package com.byqx.core.network

import kotlinx.serialization.json.Json

/** Limit by encoded UTF-8 bytes as well as count; Chinese and escaped control characters grow on the wire. */
object SyncBatching {
    private val json = Json { encodeDefaults = true }
    const val MAX_BYTES = 1_000_000 // Server accepts 1.2MB, leaving room for future envelope fields.
    fun envelope(server: String, cursor: String, available: List<SyncOperationDto>): SyncEnvelopeDto {
        val chosen = mutableListOf<SyncOperationDto>()
        for (operation in available.take(50)) {
            val next = SyncEnvelopeDto(server, cursor, chosen + operation)
            if (json.encodeToString(next).toByteArray(Charsets.UTF_8).size > MAX_BYTES) break
            chosen.add(operation)
        }
        require(available.isEmpty() || chosen.isNotEmpty()) { "单条记录超过同步批次限制" }
        return SyncEnvelopeDto(server, cursor, chosen)
    }
}
