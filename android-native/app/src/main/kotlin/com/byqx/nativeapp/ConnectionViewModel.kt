package com.byqx.nativeapp

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.byqx.core.model.OwnerConnectionRepository
import kotlinx.coroutines.launch

class ConnectionViewModel(private val repository: OwnerConnectionRepository) : ViewModel() {
    val state = repository.state
    init { viewModelScope.launch { repository.initialize() } }
    fun test(url: String) { viewModelScope.launch { repository.testConnection(url) } }
    fun bind(url: String, password: String, confirmed: Boolean) { viewModelScope.launch { repository.bind(url, password, confirmed) } }
    fun validate() { viewModelScope.launch { repository.validate(force = true) } }
    fun onNetworkAvailable() { viewModelScope.launch { repository.validate() } }
    fun onNetworkLost() { viewModelScope.launch { repository.validate(force = true) } }
    fun revoke() { viewModelScope.launch { repository.revoke() } }
    class Factory(private val repository: OwnerConnectionRepository) : ViewModelProvider.Factory {
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(ConnectionViewModel::class.java))
            @Suppress("UNCHECKED_CAST") return ConnectionViewModel(repository) as T
        }
    }
}
