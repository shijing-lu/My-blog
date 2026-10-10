package com.byqx.feature.connection

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.byqx.core.designsystem.NeoCard
import com.byqx.core.model.*

@Composable
fun ConnectionScreen(state: ConnectionState, onTest: (String) -> Unit, onBind: (String, String, Boolean) -> Unit,
                     onValidate: () -> Unit, onRevoke: () -> Unit) {
    var address by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") } // Secrets never enter saved instance state.
    var touched by rememberSaveable { mutableStateOf(false) }
    var confirmBind by remember { mutableStateOf(false) }
    var confirmRevoke by remember { mutableStateOf(false) }
    val binding = state.binding
    LaunchedEffect(state.configuredUrl) { if (!touched) address = state.configuredUrl }
    LaunchedEffect(state.status, state.busy) { if (state.status == ConnectionStatus.CONNECTED && !state.busy) password = "" }
    val title = when (state.status) {
        ConnectionStatus.LOADING -> "恢复凭据中"
        ConnectionStatus.UNBOUND -> "尚未绑定"
        ConnectionStatus.CONNECTED -> "已连接 · 站主"
        ConnectionStatus.OFFLINE -> "离线 · 保留本地绑定"
        ConnectionStatus.REAUTH_REQUIRED -> "需要重新认证"
        ConnectionStatus.STORAGE_ERROR -> "凭据需要恢复"
    }
    LazyColumn(Modifier.fillMaxSize().imePadding().testTag("connection_screen"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        item {
            Text("连接你的站点", style = MaterialTheme.typography.headlineLarge)
            Text("通过现有站主口令绑定，日常自动恢复身份。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            NeoCard(color = MaterialTheme.colorScheme.secondaryContainer) {
                Text(title, Modifier.testTag("connection_status"), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSecondaryContainer)
                Text(state.message, Modifier.testTag("connection_message"), color = MaterialTheme.colorScheme.onSecondaryContainer)
                if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 12.dp))
            }
        }
        item {
            OutlinedTextField(address, { address = it; touched = true }, label = { Text("服务地址") },
                supportingText = { Text("填写站点根地址；测试包USB连接可用 http://127.0.0.1:4321") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), singleLine = true,
                enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("server_address"))
        }
        item {
            OutlinedButton(onClick = { onTest(address) }, enabled = !state.busy && address.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("test_connection")) { Text("测试连接") }
        }
        item {
            OutlinedTextField(password, { password = it }, label = { Text("站主口令") },
                supportingText = { Text("口令只用于本次认证，不保存在手机，也不用于GitHub登录。") },
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                singleLine = true, enabled = !state.busy, modifier = Modifier.fillMaxWidth().testTag("owner_password"))
        }
        item {
            Button(onClick = {
                if (state.binding != null || state.status == ConnectionStatus.STORAGE_ERROR) confirmBind = true else onBind(address, password, false)
            }, enabled = !state.busy && password.isNotEmpty() && address.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("bind_owner")) {
                Text(if (state.binding == null) "绑定站主身份" else "重新认证 / 绑定")
            }
        }
        if (binding != null) item {
            Text("已绑定服务：${binding.baseUrl}", style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(onClick = onValidate, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("validate_session")) { Text("重新校验身份") }
            if (binding.sessionId != null) TextButton(onClick = { confirmRevoke = true }, enabled = !state.busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("revoke_session")) { Text("撤销本设备会话") }
        }
        item {
            Text("联网恢复后会重新校验身份。会话失效时保留本地绑定；内容缓存、草稿与离线编辑将在第3阶段开始交付。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (confirmBind) AlertDialog(onDismissRequest = { confirmBind = false }, title = { Text("确认重新绑定") },
        text = { Text("将使用当前服务地址和站主口令更新加密凭据。更换服务会建立新的身份绑定，原服务的本地资料不会被清理。") },
        confirmButton = { TextButton(onClick = { confirmBind = false; onBind(address, password, true) }, Modifier.testTag("confirm_bind")) { Text("确认绑定") } },
        dismissButton = { TextButton(onClick = { confirmBind = false }) { Text("取消") } })
    if (confirmRevoke) AlertDialog(onDismissRequest = { confirmRevoke = false }, title = { Text("撤销本设备会话？") },
        text = { Text("需要联网执行。撤销后需重新认证，本地绑定和资料保持。") },
        confirmButton = { TextButton(onClick = { confirmRevoke = false; onRevoke() }, Modifier.testTag("confirm_revoke")) { Text("撤销会话") } },
        dismissButton = { TextButton(onClick = { confirmRevoke = false }) { Text("取消") } })
}
