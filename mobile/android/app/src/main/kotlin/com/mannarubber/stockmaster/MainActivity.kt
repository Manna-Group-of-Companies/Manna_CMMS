package com.mannarubber.stockmaster

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * Hosts the Flutter UI, plus the small bridge the in-app updater uses to hand
 * a downloaded APK to Android's package installer.
 *
 * Nothing here installs anything by itself — a normal app cannot. It opens the
 * stock installer screen and Android takes over: the user confirms, Android
 * checks the new APK carries the same signature as the installed copy, and
 * upgrades it in place without touching the app's data.
 */
class MainActivity : FlutterActivity() {

    private var pendingPermissionResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result -> onMethodCall(call, result) }
    }

    private fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "canInstallPackages" -> result.success(canInstallPackages())
            "requestInstallPermission" -> requestInstallPermission(result)
            "installApk" -> installApk(call.argument<String>("path"), result)
            else -> result.notImplemented()
        }
    }

    /**
     * Whether "Install unknown apps" is granted for this app. Below Android 8
     * it was a single device-wide setting rather than a per-app one, so there
     * is nothing to ask for.
     */
    private fun canInstallPackages(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            packageManager.canRequestPackageInstalls()
        } else {
            true
        }

    /**
     * Sends the user to the system screen where the permission is granted and
     * answers once they come back, so the Dart side can carry straight on.
     */
    private fun requestInstallPermission(result: MethodChannel.Result) {
        if (canInstallPackages()) {
            result.success(true)
            return
        }
        if (pendingPermissionResult != null) {
            result.error("busy", "A permission request is already in progress.", null)
            return
        }
        try {
            pendingPermissionResult = result
            startActivityForResult(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:$packageName"),
                ),
                REQUEST_INSTALL_PERMISSION,
            )
        } catch (error: Exception) {
            pendingPermissionResult = null
            result.error("settings_unavailable", error.message, null)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_INSTALL_PERMISSION) return
        // The settings screen reports RESULT_CANCELED whichever way the toggle
        // was left, so ask the package manager rather than trusting resultCode.
        pendingPermissionResult?.success(canInstallPackages())
        pendingPermissionResult = null
    }

    /**
     * Opens the package installer for the APK at [path].
     *
     * The file lives in this app's private cache, so it is shared through a
     * [FileProvider] content URI — handing over a `file://` URI has thrown
     * FileUriExposedException since Android 7.
     */
    private fun installApk(path: String?, result: MethodChannel.Result) {
        val file = path?.let { File(it) }
        if (file == null || !file.exists()) {
            result.error("missing_file", "The downloaded update is no longer on the device.", null)
            return
        }

        try {
            val uri = FileProvider.getUriForFile(this, "$packageName.updateprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, APK_MIME_TYPE)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
            result.success(true)
        } catch (error: Exception) {
            result.error("install_failed", error.message ?: "Could not open the installer.", null)
        }
    }

    private companion object {
        const val CHANNEL = "com.mannarubber.stockmaster/apk_installer"
        const val APK_MIME_TYPE = "application/vnd.android.package-archive"
        const val REQUEST_INSTALL_PERMISSION = 7341
    }
}
