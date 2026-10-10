package com.byqx.core.preferences

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.byqx.core.model.AppearancePreferences
import com.byqx.core.model.ThemeMode
import java.io.IOException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map

private val Context.appearanceDataStore by preferencesDataStore("native_appearance")

class AppearanceStore(context: Context) {
    private val store = context.applicationContext.appearanceDataStore
    private val themeKey = stringPreferencesKey("theme")
    private val dynamicKey = booleanPreferencesKey("dynamic_color")
    private val motionKey = booleanPreferencesKey("reduced_motion")

    val preferences: Flow<AppearancePreferences> = store.data.catch { error ->
        if (error is IOException) emit(emptyPreferences()) else throw error
    }.map { values ->
        AppearancePreferences(ThemeMode.fromStored(values[themeKey]), values[dynamicKey] ?: false, values[motionKey] ?: false)
    }

    suspend fun setTheme(value: ThemeMode) { store.edit { it[themeKey] = value.name } }
    suspend fun setDynamicColor(value: Boolean) { store.edit { it[dynamicKey] = value } }
    suspend fun setReducedMotion(value: Boolean) { store.edit { it[motionKey] = value } }
}
