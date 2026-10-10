package com.byqx.core.model

data class NoteContent(val title: String = "", val content: String = "", val tags: List<String> = emptyList(), val createdAt: Long = System.currentTimeMillis(), val updatedAt: Long = createdAt)
data class LocalNote(val id: String, val value: NoteContent?, val draft: NoteContent?, val pending: Boolean, val conflicted: Boolean)
data class NoteConflict(val id: String, val base: NoteContent?, val local: NoteContent?, val remote: NoteContent?)
data class NotesState(val serverId: String? = null, val notes: List<LocalNote> = emptyList(), val busy: Boolean = false, val message: String = "正在读取本地资料…", val storageError: Boolean = false)
