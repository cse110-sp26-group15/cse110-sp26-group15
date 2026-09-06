package com.sitrep.companion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sitrep.companion.ui.AppViewModel
import com.sitrep.companion.ui.SitRepAppRoot
import com.sitrep.companion.work.SyncWorker

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Anything left in the outbox from a previous process gets another go
        // as soon as there is a network. Nothing is replayed from memory.
        SyncWorker.enqueue(this)

        setContent {
            MaterialTheme {
                Surface {
                    val vm: AppViewModel = viewModel()
                    val state by vm.state.collectAsState()
                    SitRepAppRoot(state, vm)
                }
            }
        }
    }
}
