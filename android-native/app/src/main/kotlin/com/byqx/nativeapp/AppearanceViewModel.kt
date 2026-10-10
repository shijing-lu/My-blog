package com.byqx.nativeapp

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.byqx.core.model.AppearancePreferences
import com.byqx.core.model.ThemeMode
import com.byqx.core.preferences.AppearanceStore
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class AppearanceViewModel(private val store: AppearanceStore) : ViewModel() {
    val preferences: StateFlow<AppearancePreferences?> = store.preferences.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    fun setTheme(theme: ThemeMode) { viewModelScope.launch { store.setTheme(theme) } }
    fun setDynamicColor(enabled: Boolean) { viewModelScope.launch { store.setDynamicColor(enabled) } }
    fun setReducedMotion(enabled: Boolean) { viewModelScope.launch { store.setReducedMotion(enabled) } }
    class Factory(private val store: AppearanceStore) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(AppearanceViewModel::class.java))
            @Suppress("UNCHECKED_CAST")
            return AppearanceViewModel(store) as T
        }
    }
}
