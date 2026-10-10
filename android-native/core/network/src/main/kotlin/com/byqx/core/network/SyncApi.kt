package com.byqx.core.network

import kotlinx.serialization.Serializable
import retrofit2.http.*

@Serializable data class NoteDto(val title: String, val content: String, val tags: List<String>, val createdAt: Long, val updatedAt: Long) {
    override fun toString() = "NoteDto([private])"
}
@Serializable data class SyncRecordDto(val recordId: String, val revision: String, val seq: Long, val payload: NoteDto?)
@Serializable data class SyncOperationDto(val opId: String, val recordId: String, val baseRevision: String?, val payload: NoteDto?)
@Serializable data class SyncEnvelopeDto(val serverId: String, val cursor: String, val operations: List<SyncOperationDto>, val protocolVersion: Int = 1)
@Serializable data class SyncAckDto(val opId: String, val status: String, val record: SyncRecordDto)
@Serializable data class SyncResultDto(val protocolVersion: Int, val acknowledgements: List<SyncAckDto>, val records: List<SyncRecordDto>, val cursor: String, val hasMore: Boolean)
interface SyncApi { @POST("api/mobile/v1/sync") suspend fun sync(@Header("Authorization") bearer: String, @Body body: SyncEnvelopeDto): SyncResultDto }
