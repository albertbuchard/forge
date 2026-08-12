package com.aurel.forge.companion

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import java.net.URLDecoder

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = MaterialTheme.colorScheme.copy(primary = Color(0xFF526A47), secondary = Color(0xFF725D3E), background = Color(0xFFF7F4EC), surface = Color(0xFFFFFCF5))) {
                ForgeCompanionScreen(deepLinkPayload = intent?.data?.getQueryParameter("payload")?.let { URLDecoder.decode(it, Charsets.UTF_8.name()) })
            }
        }
    }
}

@Composable
fun ForgeCompanionScreen(deepLinkPayload: String?, model: MainViewModel = viewModel()) {
    val state by model.state.collectAsState()
    val context = LocalContext.current
    val healthAvailable = remember { HealthPayloadBuilder(context).available() }
    val permissionLauncher = rememberLauncherForActivityResult(PermissionController.createRequestPermissionResultContract()) { }
    val scanner = remember {
        GmsBarcodeScanning.getClient(
            context,
            GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build()
        )
    }

    androidx.compose.runtime.LaunchedEffect(deepLinkPayload) {
        if (!deepLinkPayload.isNullOrBlank() && state.pairing == null) model.pair(deepLinkPayload)
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Forge Companion", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text("Pair this device deliberately. No Health Connect category is selected or shared by default.", color = MaterialTheme.colorScheme.onSurfaceVariant)

            state.notice?.let { Card(Modifier.fillMaxWidth()) { Text(it, Modifier.padding(16.dp), color = Color(0xFF315D31)) } }
            state.error?.let { Card(Modifier.fillMaxWidth()) { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error) } }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("1. Secure pairing", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    if (state.pairing == null) {
                        Text("In Forge, create a companion pairing session and scan its QR code. Android accepts HTTPS targets only; the token is encrypted with Android Keystore.")
                        Button(enabled = !state.busy, onClick = {
                            scanner.startScan().addOnSuccessListener { barcode -> barcode.rawValue?.let(model::pair) }
                        }) { Text("Scan Forge pairing QR") }
                    } else {
                        Text("Paired with ${state.pairing?.apiBaseUrl}")
                        Text("Capabilities: ${state.pairing?.capabilities?.sorted()?.joinToString().orEmpty()}", style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(enabled = !state.busy, onClick = model::disconnect) { Text("Disconnect this device") }
                    }
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("2. Choose Health Connect data", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    if (!healthAvailable) Text("Health Connect is unavailable on this device.", color = MaterialTheme.colorScheme.error)
                    HealthCategory.entries.forEach { category ->
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = category in state.selectedCategories, onCheckedChange = { model.toggleCategory(category) })
                            Spacer(Modifier.width(8.dp))
                            Column { Text(category.label, fontWeight = FontWeight.Medium); Text(category.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                    Button(enabled = healthAvailable && state.selectedCategories.isNotEmpty() && !state.busy, onClick = { permissionLauncher.launch(permissionsFor(state.selectedCategories)) }) { Text("Review selected permissions") }
                    OutlinedButton(enabled = healthAvailable, onClick = { context.startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)) }) { Text("Manage access in Health Connect") }
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("3. Sync and inspect", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text("Background sync", fontWeight = FontWeight.Medium); Text("Pause at any time. Only selected categories are read.", style = MaterialTheme.typography.bodySmall) }
                        Switch(checked = state.syncEnabled, enabled = state.pairing != null && state.selectedCategories.isNotEmpty(), onCheckedChange = model::setSyncEnabled)
                    }
                    Button(enabled = state.pairing != null && state.selectedCategories.isNotEmpty() && !state.busy, onClick = model::syncNow) { Text(if (state.busy) "Working…" else "Sync now") }
                    HorizontalDivider()
                    Text("Sync queue", fontWeight = FontWeight.SemiBold)
                    if (state.queue.isEmpty()) Text("No pending or failed uploads.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    state.queue.forEach { item ->
                        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("${item.state.replaceFirstChar { it.uppercase() }} · attempt ${item.attempts}", fontWeight = FontWeight.Medium)
                            item.lastError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(enabled = !state.busy, onClick = { model.retry(item.id) }) { Text("Retry") }
                                OutlinedButton(enabled = !state.busy, onClick = { model.discard(item.id) }) { Text("Discard") }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
