@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.byqx.feature.foundation

import android.os.Build
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byqx.core.designsystem.*
import com.byqx.core.model.*

@Composable
private fun SectionTitle(title: String, detail: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        if (detail != null) Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun HomeScreen(onLab: () -> Unit, onModule: (String) -> Unit, readingHeader: (@Composable () -> Unit)? = null) {
    LazyColumn(Modifier.fillMaxSize().testTag("home_screen"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                    Text("你的个人工作台", style = MaterialTheme.typography.headlineMedium)
                    Text("把知识、想法和日常带在身边。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text("04 / 16", style = MaterialTheme.typography.labelLarge)
            }
        }
        item {
            if (readingHeader != null) readingHeader() else NeoCard(color = MaterialTheme.colorScheme.primaryContainer) {
                Text("白衣卿相", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                Text("从这里，建立你的随身世界。", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                val illustrationColor = MaterialTheme.colorScheme.onPrimaryContainer
                Canvas(Modifier.fillMaxWidth().height(70.dp).padding(top = 12.dp)) {
                    val path = Path().apply {
                        moveTo(0f, size.height * .65f)
                        cubicTo(size.width*.2f, -size.height*.2f, size.width*.3f, size.height*1.4f, size.width*.5f, size.height*.45f)
                        cubicTo(size.width*.68f, -size.height*.2f, size.width*.8f, size.height*1.2f, size.width, size.height*.15f)
                    }
                    drawPath(path, illustrationColor, style = Stroke(3.dp.toPx()))
                    drawCircle(illustrationColor, 5.dp.toPx(), Offset(size.width*.5f,size.height*.45f))
                }
                Spacer(Modifier.height(12.dp))
                Text("阶段 3 · 离线随心录与同步", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                Text("离线记录想法，联网同步；有冲突时保留各版本供你核对。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }
        item {
            NeoCard(color = MaterialTheme.colorScheme.secondaryContainer, onClick = onLab, modifier = Modifier.testTag("open_lab")) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("体验原生组件", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSecondaryContainer)
                        Text("按压、面板、弹窗与输入", color = MaterialTheme.colorScheme.onSecondaryContainer)
                    }
                    Glyph("arrow", color = MaterialTheme.colorScheme.onSecondaryContainer)
                }
            }
        }
        item { SectionTitle("所有工具，有序到来", "查看各模块的交付范围与阶段。") }
        items(FoundationCatalog.modules.chunked(2)) { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max)) {
                pair.forEach { module ->
                    NeoCard(Modifier.weight(1f).fillMaxHeight().testTag("module_${module.id}"), onClick = { onModule(module.id) }) {
                        Glyph(module.id)
                        Spacer(Modifier.height(12.dp))
                        Text(module.name, style = MaterialTheme.typography.titleMedium)
                        Text(module.caption, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(8.dp))
                        Text(when(module.id) { "notes"->"已交付 · 离线与同步";"articles"->"阶段 4 · 原生阅读";else->"待交付 · 阶段 ${module.stage}" }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        item { Text("随心录已支持离线记录与冲突同步，其余业务按阶段交付。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
fun ModuleScreen(module: ModuleInfo, onLab: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize().testTag("module_screen_${module.id}"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        item {
            Text(module.name, style = MaterialTheme.typography.headlineLarge)
            Text(module.caption, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            NeoCard(color = MaterialTheme.colorScheme.tertiaryContainer) {
                Text("尚未交付", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onTertiaryContainer)
                Text("计划从第 ${module.stage} 阶段开始建设。当前页面用于核对迁移范围。", color = MaterialTheme.colorScheme.onTertiaryContainer)
            }
        }
        item { SectionTitle("将迁移的能力") }
        items(module.abilities) { ability -> Text("• $ability", style = MaterialTheme.typography.bodyLarge) }
        item { OutlinedButton(onClick = onLab, modifier = Modifier.fillMaxWidth()) { Text("先体验原生组件") } }
    }
}

@Composable
fun MyScreen(
    preferences: AppearancePreferences,
    systemReducedMotion: Boolean,
    onTheme: (ThemeMode) -> Unit,
    onDynamicColor: (Boolean) -> Unit,
    onReducedMotion: (Boolean) -> Unit,
    connection: ConnectionState,
    onConnection: () -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize().testTag("my_screen"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        item {
            Text("我的空间", style = MaterialTheme.typography.headlineLarge)
            Text("个人专用 · 原生体验", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            NeoCard(onClick = onConnection, modifier = Modifier.testTag("open_connection")) {
                Text("站主服务绑定", style = MaterialTheme.typography.titleMedium)
                Text(if (connection.binding == null) "配置服务地址，绑定你的站主身份" else connection.message, style = MaterialTheme.typography.bodyMedium)
                Text("连接与认证 →", style = MaterialTheme.typography.labelLarge)
            }
        }
        item { SectionTitle("外观", "设置保存在本机，退出或重启后继续生效。") }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ThemeMode.entries.forEach { mode ->
                    FilterChip(
                        selected = preferences.theme == mode, onClick = { onTheme(mode) },
                        label = { Text(mode.label) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("theme_${mode.name}"),
                    )
                }
            }
        }
        item {
            PreferenceSwitch("动态取色", if (Build.VERSION.SDK_INT >= 31) "使用壁纸的系统配色" else "Android 12 及以上可用", preferences.dynamicColor, onDynamicColor, "dynamic_color", Build.VERSION.SDK_INT >= 31)
        }
        item {
            PreferenceSwitch("减少动效", "关闭页面和组件的过渡动画", preferences.reducedMotion, onReducedMotion, "reduced_motion")
            if (systemReducedMotion) Text("系统关闭动画或开启省电模式，当前已减少动效。", style = MaterialTheme.typography.bodySmall)
        }
        item {
            NeoCard {
                Text("基础版本 0.2.0", style = MaterialTheme.typography.titleMedium)
                Text("Kotlin + Jetpack Compose\n第 2 / 16 阶段\n内容与同步尚未交付", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun PreferenceSwitch(title: String, caption: String, checked: Boolean, onChange: (Boolean) -> Unit, tag: String, enabled: Boolean = true) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(caption, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange, enabled = enabled, modifier = Modifier.testTag(tag))
    }
}

@Composable
fun LabScreen() {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var showDialog by rememberSaveable { mutableStateOf(false) }
    var showSheet by rememberSaveable { mutableStateOf(false) }
    var draft by rememberSaveable { mutableStateOf("") }
    var selected by rememberSaveable { mutableStateOf("灵感") }
    var pressCount by rememberSaveable { mutableIntStateOf(0) }
    val motion = LocalMotionEnabled.current
    LazyColumn(Modifier.fillMaxSize().testTag("lab_screen"), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        item {
            Text("原生体验室", style = MaterialTheme.typography.headlineLarge)
            Text("真实组件交互，仅用于第 1 阶段验收。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            NeoCard(color = MaterialTheme.colorScheme.primaryContainer, onClick = { pressCount++ }, modifier = Modifier.testTag("press_card")) {
                Text("试着按一下", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                AnimatedContent(pressCount, label = "pressCounter", transitionSpec = {
                    androidx.compose.animation.fadeIn(tween(if(motion) 120 else 0)) togetherWith androidx.compose.animation.fadeOut(tween(if(motion) 90 else 0))
                }) { count -> Text("已按压 $count 次", color = MaterialTheme.colorScheme.onPrimaryContainer) }
                Text("描边、实心投影与按压位移", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }
        item {
            OutlinedTextField(value = draft, onValueChange = { draft = it }, label = { Text("输入一段中文") },
                supportingText = { Text("旋转屏幕后保留输入；这里不是业务笔记，也不会同步。") },
                modifier = Modifier.fillMaxWidth().testTag("demo_input"), minLines = 2, maxLines = 5)
        }
        item {
            Text("选择标签", style = MaterialTheme.typography.titleMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("灵感", "学习", "日常").forEach { label ->
                    FilterChip(selected = selected == label, onClick = { selected = label }, label = { Text(label) }, modifier = Modifier.heightIn(min = 48.dp))
                }
            }
        }
        item {
            NeoCard(onClick = { expanded = !expanded }, modifier = Modifier.testTag("expand_card")) {
                Text(if (expanded) "收起卡片" else "展开卡片", style = MaterialTheme.typography.titleMedium)
                AnimatedVisibility(expanded, enter = androidx.compose.animation.expandVertically(tween(if(motion) 220 else 0)), exit = androidx.compose.animation.shrinkVertically(tween(if(motion) 180 else 0))) {
                    Text("内容展开后参与布局，关闭动效时直接切换到终态。", Modifier.padding(top = 12.dp))
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = { showDialog = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("open_dialog")) { Text("打开确认弹窗") }
                OutlinedButton(onClick = { showSheet = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("open_sheet")) { Text("打开底部面板") }
            }
        }
        item { Text("主题与减少动效在「我的」中设置。以上状态支持屏幕重建恢复。", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium) }
    }
    if (showDialog) AlertDialog(
        onDismissRequest = { showDialog = false }, title = { Text("原生确认弹窗") },
        text = { Text("这是组件演示。返回键、点击遮罩和按钮都可以关闭，不会删除任何数据。") },
        confirmButton = { TextButton(onClick = { showDialog = false }, modifier = Modifier.testTag("confirm_dialog")) { Text("知道了") } },
    )
    if (showSheet) ModalBottomSheet(onDismissRequest = { showSheet = false }) {
        Column(Modifier.fillMaxWidth().padding(24.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("拇指可达的操作面板", style = MaterialTheme.typography.titleLarge)
            Text("后续编辑器菜单与模块操作将复用这个原生组件。可以下滑或按返回键关闭。")
            Button(onClick = { showSheet = false }, modifier = Modifier.fillMaxWidth().testTag("close_sheet")) { Text("关闭面板") }
        }
    }
}
