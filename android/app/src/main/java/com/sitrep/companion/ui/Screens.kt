package com.sitrep.companion.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.sitrep.companion.data.CachedTaskEntity

private val STATUSES = listOf("todo", "in-progress", "done")

@Composable
fun SitRepAppRoot(state: UiState, vm: AppViewModel) {
    if (!state.signedIn) LoginScreen(state, vm) else BoardScreen(state, vm)
}

@Composable
fun LoginScreen(state: UiState, vm: AppViewModel) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Text("SitRep companion", style = MaterialTheme.typography.headlineSmall)
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Email") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "email" },
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "password" },
        )
        Button(
            onClick = { vm.login(email.trim(), password) },
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.busy) "Signing in…" else "Sign in")
        }
        state.message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BoardScreen(state: UiState, vm: AppViewModel) {
    var editing by remember { mutableStateOf<CachedTaskEntity?>(null) }
    var creating by remember { mutableStateOf(false) }
    var resolving by remember { mutableStateOf<CachedTaskEntity?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(state.projectName.ifBlank { "My work" })
                        Text(
                            if (state.pending > 0) "${state.pending} change(s) waiting to sync"
                            else "Synced",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                },
                actions = {
                    TextButton(onClick = { vm.syncNow() }) { Text("Sync") }
                    TextButton(onClick = { vm.logout() }) { Text("Sign out") }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { creating = true }) { Text("+") }
        },
    ) { inner ->
        Column(modifier = Modifier.padding(inner).fillMaxSize()) {
            state.message?.let {
                Text(it, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
            if (state.notices.isNotEmpty()) {
                Card(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    colors =
                        CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer
                        ),
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text("Changes the server refused", style = MaterialTheme.typography.titleSmall)
                        state.notices.forEach { Text(it.message) }
                        TextButton(onClick = { vm.dismissNotices() }) { Text("Dismiss") }
                    }
                }
            }
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(state.tasks, key = { it.localId }) { task ->
                    TaskRow(
                        task = task,
                        onEdit = { editing = task },
                        onResolve = { resolving = task },
                    )
                }
            }
        }
    }

    if (creating) {
        TaskDialog(
            title = "New task",
            initialTitle = "",
            initialDescription = "",
            initialStatus = "todo",
            onDismiss = { creating = false },
            onSave = { t, d, s ->
                vm.createTask(t, d.ifBlank { null }, s)
                creating = false
            },
        )
    }

    editing?.let { task ->
        TaskDialog(
            title = "Edit task",
            initialTitle = task.title,
            initialDescription = task.description.orEmpty(),
            initialStatus = task.status,
            onDismiss = { editing = null },
            onSave = { t, d, s ->
                vm.editTask(task.localId, t, d.ifBlank { null }, s)
                editing = null
            },
        )
    }

    resolving?.let { task ->
        ConflictDialog(
            task = task,
            onDismiss = { resolving = null },
            onKeepMine = {
                vm.keepMine(task.localId)
                resolving = null
            },
            onKeepTheirs = {
                vm.keepTheirs(task.localId)
                resolving = null
            },
        )
    }
}

@Composable
internal fun TaskRow(task: CachedTaskEntity, onEdit: () -> Unit, onResolve: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(task.title, style = MaterialTheme.typography.titleMedium)
            task.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            Text(
                buildString {
                    append(task.status)
                    if (task.version != null) append("  ·  v${task.version}")
                    if (task.serverTaskId == null) append("  ·  not on the server yet")
                    if (task.pending && !task.conflict) append("  ·  queued")
                    if (task.conflict) append("  ·  CONFLICT")
                },
                style = MaterialTheme.typography.labelSmall,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onEdit) { Text("Edit") }
                if (task.conflict) TextButton(onClick = onResolve) { Text("Resolve") }
            }
        }
    }
}

@Composable
internal fun TaskDialog(
    title: String,
    initialTitle: String,
    initialDescription: String,
    initialStatus: String,
    onDismiss: () -> Unit,
    onSave: (String, String, String) -> Unit,
) {
    var t by remember { mutableStateOf(initialTitle) }
    var d by remember { mutableStateOf(initialDescription) }
    var s by remember { mutableStateOf(initialStatus) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = t,
                    onValueChange = { t = it },
                    label = { Text("Title") },
                    modifier = Modifier.semantics { contentDescription = "task title" },
                )
                OutlinedTextField(
                    value = d,
                    onValueChange = { d = it },
                    label = { Text("Update") },
                    modifier = Modifier.semantics { contentDescription = "task update" },
                )
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    STATUSES.forEach { option ->
                        TextButton(onClick = { s = option }) {
                            Text(if (option == s) "[$option]" else option)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(t, d, s) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
internal fun ConflictDialog(
    task: CachedTaskEntity,
    onDismiss: () -> Unit,
    onKeepMine: () -> Unit,
    onKeepTheirs: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("This task changed while you were offline") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Your edit", style = MaterialTheme.typography.titleSmall)
                Text("${task.title} · ${task.status}")
                task.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                Text("On the server (v${task.remoteVersion})", style = MaterialTheme.typography.titleSmall)
                Text("${task.remoteTitle} · ${task.remoteStatus}")
                task.remoteDescription?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = { TextButton(onClick = onKeepMine) { Text("Keep mine") } },
        dismissButton = { TextButton(onClick = onKeepTheirs) { Text("Keep theirs") } },
    )
}
