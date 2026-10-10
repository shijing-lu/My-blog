package com.byqx.nativeapp

import android.app.Application
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.InternalComposeUiApi
import androidx.compose.ui.platform.WindowRecomposerFactory
import androidx.compose.ui.platform.WindowRecomposerPolicy
import androidx.compose.ui.platform.createLifecycleAwareWindowRecomposer
import com.byqx.core.identity.ConnectionRepository
import com.byqx.core.identity.KeystoreConnectionVault
import com.byqx.core.model.OwnerConnectionRepository
import com.byqx.core.sync.*
import kotlinx.coroutines.*

/** App-local animation clock; never changes the device's global animation settings. */
internal object AppMotionDurationScale : MotionDurationScale {
    override var scaleFactor: Float by mutableFloatStateOf(1f)
}

// Window factory is isolated here and version-pinned by the Compose BOM. Recheck it on BOM upgrades.
@OptIn(InternalComposeUiApi::class)
class NativeApplication : Application(), NotesProvider {
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val connectionRepository: ConnectionRepository by lazy {
        ConnectionRepository(KeystoreConnectionVault(this), BuildConfig.DEBUG, android.os.Build.MODEL)
    }
    override val notesRepository by lazy { NotesRepository.create(this, connectionRepository, appScope) }
    val readingRepository by lazy { com.byqx.feature.reading.ReadingRepository.create(this, connectionRepository, appScope) }
    override fun onCreate() {
        super.onCreate()
        notesRepository
        readingRepository
        NotesSyncWork.periodic(this)
        AppMotionDurationScale.scaleFactor = Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        WindowRecomposerPolicy.setFactory(WindowRecomposerFactory { view ->
            view.createLifecycleAwareWindowRecomposer(coroutineContext = AppMotionDurationScale)
        })
    }
}
