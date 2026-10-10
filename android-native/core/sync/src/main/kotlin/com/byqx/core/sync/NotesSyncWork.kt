package com.byqx.core.sync

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

interface NotesProvider { val notesRepository: NotesRepository }
class NotesSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = if ((applicationContext as NotesProvider).notesRepository.sync()) Result.success() else Result.retry()
}
object NotesSyncWork {
    fun enqueue(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val task = OneTimeWorkRequestBuilder<NotesSyncWorker>().setConstraints(constraints).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork("owner-notes-sync", ExistingWorkPolicy.APPEND_OR_REPLACE, task)
    }
    fun periodic(context: Context) {
        val task = PeriodicWorkRequestBuilder<NotesSyncWorker>(15, TimeUnit.MINUTES).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("owner-notes-periodic", ExistingPeriodicWorkPolicy.KEEP, task)
    }
}
