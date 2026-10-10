package com.byqx.feature.notes

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.byqx.core.designsystem.NeoCard
import com.byqx.core.model.*

@Composable
fun NotesScreen(state: NotesState, onNew: () -> Unit, onEdit: (String) -> Unit, onSync: () -> Unit, onConnection: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize().testTag("notes_list"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Text("随心录", style = MaterialTheme.typography.headlineLarge); Text(state.message, modifier = Modifier.testTag("sync_status")) }
        if (state.serverId == null) item { Button(onClick = onConnection) { Text("先绑定站主服务") } }
        else {
            item { Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = onNew, enabled = !state.storageError, modifier = Modifier.testTag("note_new")) { Text("新建记录") }
                OutlinedButton(onClick = onSync, enabled = !state.busy && !state.storageError, modifier = Modifier.testTag("notes_sync")) { Text(if (state.busy) "同步中…" else "立即同步") }
            } }
            if (state.notes.isEmpty()) item { NeoCard { Text("还没有本地记录"); Text("联网同步已有随心录，或离线新建。") } }
            items(state.notes, key = { it.id }) { note ->
                val value = note.draft ?: note.value
                NeoCard(modifier = Modifier.testTag("note_${note.id}"), onClick = { onEdit(note.id) }) {
                    Text(value?.title?.ifBlank { "未命名记录" } ?: "删除操作发生冲突", style = MaterialTheme.typography.titleMedium)
                    Text(value?.content?.take(120) ?: "核对远端变化后决定保留或删除。", style = MaterialTheme.typography.bodyMedium, maxLines = 4)
                    Text(when { note.conflicted -> "需要处理冲突"; note.draft != null -> "本机草稿"; note.pending -> "待同步"; else -> "已同步" }, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
        item { Text("当前支持离线源码记录与冲突同步；完整编辑器、预览和历史将在后续阶段交付。", style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
fun NoteEditorScreen(note: LocalNote?, conflict: NoteConflict?, message: String, onDraft: (NoteContent) -> Unit, onSave: () -> Unit, onDelete: () -> Unit, onResolve: (Boolean) -> Unit) {
    if (note == null) { Text("正在读取本机记录…", Modifier.padding(20.dp)); return }
    val initial = note.draft ?: note.value ?: NoteContent()
    var value by remember(note.id) { mutableStateOf(initial) }
    var tags by remember(note.id) { mutableStateOf(initial.tags.joinToString(", ")) }
    var confirmDelete by rememberSaveable(note.id) { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize().imePadding().testTag("note_editor"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Text(if (note.conflicted) "核对同步冲突" else "记录想法", style = MaterialTheme.typography.headlineMedium); Text(message, Modifier.testTag("note_message")) }
        if (note.conflicted && conflict != null) {
            item { Text("基础、本地、远端副本均已加密保留。选择后可再次同步；期间继续变化仍会提示冲突。") }
            item { ConflictCopy("基础版本", conflict.base) }
            item { ConflictCopy("本地版本", conflict.local) }
            item { ConflictCopy("远端版本", conflict.remote) }
            item { Button(onClick = { onResolve(true) }, Modifier.fillMaxWidth().testTag("resolve_local")) { Text("保留本地并重新同步") } }
            item { OutlinedButton(onClick = { onResolve(false) }, Modifier.fillMaxWidth().testTag("resolve_remote")) { Text("采用远端版本") } }
        } else {
            item { OutlinedTextField(value.title, { if (it.length <= 120) { value = value.copy(title = it); onDraft(value) } }, label = { Text("标题") }, modifier = Modifier.fillMaxWidth().testTag("note_title")) }
            item { OutlinedTextField(tags, { tags = it; value = value.copy(tags = it.split(',', '，').map(String::trim).filter(String::isNotEmpty).distinct()); onDraft(value) }, label = { Text("标签，用逗号分隔") }, modifier = Modifier.fillMaxWidth().testTag("note_tags")) }
            item { OutlinedTextField(value.content, { if (it.length <= 20000) { value = value.copy(content = it); onDraft(value) } }, label = { Text("正文源码") }, minLines = 10, modifier = Modifier.fillMaxWidth().testTag("note_content")) }
            item { Button(onClick = onSave, enabled = value.content.isNotBlank(), modifier = Modifier.fillMaxWidth().testTag("note_save")) { Text("保存到本机并同步") } }
            item { OutlinedButton(onClick = { confirmDelete = true }, modifier = Modifier.fillMaxWidth().testTag("note_delete")) { Text("删除记录") } }
            item { Text("输入会自动保存为加密草稿；正式保存后进入待同步队列。", style = MaterialTheme.typography.bodySmall) }
        }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text("删除这条记录？") }, text = { Text("联网后删除会同步到网站；如发生双端修改，将保留冲突副本。") }, confirmButton = { TextButton(onClick = { confirmDelete = false; onDelete() }, Modifier.testTag("note_delete_confirm")) { Text("删除") } }, dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("取消") } })
}
@Composable private fun ConflictCopy(title: String, value: NoteContent?) {
    NeoCard { Text(title, style = MaterialTheme.typography.titleMedium); Text(value?.title ?: "已删除 / 不存在"); Text(value?.content ?: "删除墓碑"); if (value != null) Text("标签：${value.tags.joinToString()}") }
}
