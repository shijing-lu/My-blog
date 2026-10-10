package com.byqx.nativeapp

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.byqx.core.model.*
import com.byqx.core.sync.NotesRepository
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException

class NotesViewModel(private val repository: NotesRepository) : ViewModel() {
    val state = repository.state
    private val mutableMessage = MutableStateFlow("输入自动保存到本机草稿")
    val message = mutableMessage.asStateFlow()
    private val mutableConflict = MutableStateFlow<NoteConflict?>(null)
    val conflict = mutableConflict.asStateFlow()
    // Sequential actor preserves IME event order, and a save waits for all preceding keystrokes.
    private val edits = Channel<suspend () -> Unit>(Channel.UNLIMITED)
    init { viewModelScope.launch { for (work in edits) try { work() }
        catch (error: CancellationException) { throw error }
        catch (error: IllegalArgumentException) { mutableMessage.value = error.message ?: "字段超过限制，原草稿已保留" }
        catch (error: IllegalStateException) { mutableMessage.value = error.message ?: "操作暂不可用，原草稿已保留" }
        catch (_: Exception) { mutableMessage.value = "本机操作未完成，原资料已保留，请检查字段或存储" }
    } }
    fun new(onCreated: (String) -> Unit) { edits.trySend { onCreated(repository.newDraft()) } }
    fun edit(id: String, onOpened: () -> Unit) { edits.trySend { repository.beginEditing(id); onOpened() } }
    fun draft(id: String, value: NoteContent) { edits.trySend { repository.draft(id, value); mutableMessage.value = "草稿已加密保存" } }
    fun save(id: String) { edits.trySend { repository.save(id); mutableMessage.value = "已保存到本机，联网后同步" } }
    fun delete(id: String, onDone: () -> Unit) { edits.trySend { repository.delete(id); onDone() } }
    fun sync() { viewModelScope.launch { repository.sync() } }
    fun inspect(id: String) { viewModelScope.launch { mutableConflict.value = repository.conflict(id) } }
    fun resolve(id: String, local: Boolean, onDone: () -> Unit) { edits.trySend { repository.resolve(id, local); mutableConflict.value = null; onDone() } }
    class Factory(private val repository: NotesRepository) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = NotesViewModel(repository) as T
    }
}
