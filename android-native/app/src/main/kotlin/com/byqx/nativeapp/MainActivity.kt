@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.byqx.nativeapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.net.ConnectivityManager
import android.net.Network
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import com.byqx.core.designsystem.*
import com.byqx.core.model.*
import com.byqx.core.preferences.AppearanceStore
import com.byqx.feature.foundation.*
import com.byqx.feature.connection.ConnectionScreen
import com.byqx.feature.notes.*
import com.byqx.feature.reading.*

class MainActivity : ComponentActivity() {
    private val appearance: AppearanceViewModel by viewModels { AppearanceViewModel.Factory(AppearanceStore(applicationContext)) }
    private val connection: ConnectionViewModel by viewModels { ConnectionViewModel.Factory((application as NativeApplication).connectionRepository) }
    private val notes: NotesViewModel by viewModels { NotesViewModel.Factory((application as NativeApplication).notesRepository) }
    override fun onResume() { super.onResume(); connection.onNetworkAvailable() }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            DisposableEffect(Unit) {
                val manager = getSystemService(ConnectivityManager::class.java)
                val callback = object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) { connection.onNetworkAvailable() }
                    override fun onLost(network: Network) { connection.onNetworkLost() }
                }
                manager.registerDefaultNetworkCallback(callback)
                onDispose { manager.unregisterNetworkCallback(callback) }
            }
            val preferences by appearance.preferences.collectAsStateWithLifecycle()
            val systemReduced = rememberSystemReducedMotion()
            ByqxTheme(preferences ?: AppearancePreferences(), systemReduced) {
                val dark = MaterialTheme.colorScheme.background.luminance() < .5f
                SideEffect {
                    AppMotionDurationScale.scaleFactor = if (preferences?.reducedMotion == true || systemReduced) 0f
                        else Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
                    val bars = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT) else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                    enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
                    if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
                }
                if (preferences == null) Surface(Modifier.fillMaxSize()) { Box(contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                else NativeApp(preferences!!, systemReduced, appearance, connection, notes)
            }
        }
    }
}

@Composable
private fun rememberSystemReducedMotion(): Boolean {
    val context = LocalContext.current
    fun read() = context.getSystemService(PowerManager::class.java).isPowerSaveMode ||
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    var reduced by remember { mutableStateOf(read()) }
    DisposableEffect(context) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) { override fun onChange(selfChange: Boolean) { reduced = read() } }
        val receiver = object : BroadcastReceiver() { override fun onReceive(context: Context?, intent: Intent?) { reduced = read() } }
        context.contentResolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED), Context.RECEIVER_NOT_EXPORTED)
        else { @Suppress("DEPRECATION") context.registerReceiver(receiver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)) }
        onDispose { context.contentResolver.unregisterContentObserver(observer); context.unregisterReceiver(receiver) }
    }
    return reduced
}

private data class Destination(val route: String, val label: String)
private val destinations = listOf(Destination("home", "首页"), Destination("documents", "文档"), Destination("calendar", "日历"), Destination("schedule", "日程"), Destination("my", "我的"))

@Composable
private fun NativeApp(preferences: AppearancePreferences, systemReduced: Boolean, appearance: AppearanceViewModel, connection: ConnectionViewModel, notes: NotesViewModel) {
    val connectionState by connection.state.collectAsStateWithLifecycle()
    val notesState by notes.state.collectAsStateWithLifecycle()
    val noteMessage by notes.message.collectAsStateWithLifecycle()
    val noteConflict by notes.conflict.collectAsStateWithLifecycle()
    val readingRepository = (LocalContext.current.applicationContext as NativeApplication).readingRepository
    val readingState by readingRepository.state.collectAsStateWithLifecycle()
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route ?: "home"
    val secondary = route == "lab" || route == "module/{id}" || route == "connection" || route == "notes" || route == "note/{id}" || route == "articles" || route == "article/{id}"
    val motion = LocalMotionEnabled.current
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(if (route == "connection") "服务连接" else if (route == "notes" || route == "note/{id}") "随心录" else if (route == "articles" || route == "article/{id}") "文章阅读" else if (secondary) "原生体验" else "白衣卿相", style = MaterialTheme.typography.titleLarge) }, navigationIcon = {
                if (secondary) IconButton(onClick = { nav.popBackStack() }, modifier = Modifier.testTag("navigate_back")) {
                    Glyph("back", Modifier.semantics { contentDescription = "返回" })
                }
            }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background))
        },
        bottomBar = {
            if (!secondary) NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
                destinations.forEach { destination ->
                    NavigationBarItem(
                        selected = route == destination.route,
                        onClick = {
                            nav.navigate(destination.route) {
                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Glyph(destination.route, color = if (route == destination.route) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant) },
                        label = { Text(destination.label) }, modifier = Modifier.testTag("nav_${destination.route}"),
                    )
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = "home", modifier = Modifier.padding(padding).fillMaxSize(),
            enterTransition = { slideInHorizontally(tween(if (motion) 240 else 0)) { it / 10 } + fadeIn(tween(if(motion) 180 else 0)) },
            exitTransition = { fadeOut(tween(if(motion) 120 else 0)) },
            popEnterTransition = { fadeIn(tween(if(motion) 180 else 0)) },
            popExitTransition = { slideOutHorizontally(tween(if(motion) 180 else 0)) { it / 10 } + fadeOut(tween(if(motion) 120 else 0)) },
        ) {
            composable("home") { HomeScreen(onLab = { nav.navigate("lab") }, onModule = { nav.navigate(when(it) { "notes"->"notes";"articles"->"articles";else->"module/$it" }) }, readingHeader = { ReadingHome(readingState,readingRepository) { nav.navigate("articles") } }) }
            composable("articles") { ArticlesScreen(readingState,readingRepository,{ nav.navigate("article/$it") },{nav.navigate("connection")}) }
            composable("article/{id}") { entry -> entry.arguments?.getString("id")?.let { ArticleScreen(it,readingState,readingRepository) } }
            composable("documents") { ModuleScreen(FoundationCatalog.module("documents")!!, onLab = { nav.navigate("lab") }) }
            composable("calendar") { ModuleScreen(FoundationCatalog.module("calendar")!!, onLab = { nav.navigate("lab") }) }
            composable("schedule") { ModuleScreen(FoundationCatalog.module("schedule")!!, onLab = { nav.navigate("lab") }) }
            composable("my") { MyScreen(preferences, systemReduced, appearance::setTheme, appearance::setDynamicColor, appearance::setReducedMotion, connectionState) { nav.navigate("connection") } }
            composable("connection") { ConnectionScreen(connectionState, connection::test, connection::bind, connection::validate, connection::revoke) }
            composable("notes") { NotesScreen(notesState, { notes.new { nav.navigate("note/$it") } }, { id -> notes.edit(id) { nav.navigate("note/$id") } }, notes::sync, { nav.navigate("connection") }) }
            composable("note/{id}") { backStack ->
                val id = backStack.arguments?.getString("id") ?: return@composable
                val note = notesState.notes.firstOrNull { it.id == id }
                LaunchedEffect(id, note?.conflicted) { if (note?.conflicted == true) notes.inspect(id) }
                NoteEditorScreen(note, noteConflict, noteMessage, { notes.draft(id, it) }, { notes.save(id) }, { notes.delete(id) { nav.popBackStack() } }, { notes.resolve(id, it) { nav.popBackStack() } })
            }
            composable("lab") { LabScreen() }
            composable("module/{id}") { backStack ->
                FoundationCatalog.module(backStack.arguments?.getString("id") ?: "")?.let { ModuleScreen(it, onLab = { nav.navigate("lab") }) }
            }
        }
    }
}

