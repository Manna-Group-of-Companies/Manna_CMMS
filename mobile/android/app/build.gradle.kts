import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing, read from `android/key.properties` (git-ignored):
//
//   storeFile=stockmaster-release.jks
//   storePassword=…
//   keyAlias=stockmaster
//   keyPassword=…
//
// The in-app updater installs *over* the copy already on the tablet, and
// Android only allows that when both APKs carry the same signature. So every
// release must be signed with the same key — see /README-UPDATES.md at the
// root of the repo.
//
// Without that file the build falls back to the debug key, exactly as before,
// so an existing checkout keeps producing installable APKs.
val keystoreProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val hasReleaseKeystore = keystoreProperties.getProperty("storeFile") != null

android {
    namespace = "com.mannarubber.stockmaster"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Never change this once tablets are in the field: an APK with a
        // different application ID installs as a *second* app instead of
        // updating the one that is already there.
        applicationId = "com.mannarubber.stockmaster"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Both come from `version:` in pubspec.yaml — bump it there and the
        // hosted version.json, and nowhere else.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                // No keystore configured yet. The debug key is machine-local
                // and expires, so releases built on a different machine will
                // NOT install over an existing copy — set up key.properties
                // before the tablets go out.
                signingConfigs.getByName("debug")
            }
        }
    }
}

dependencies {
    // FileProvider, used to hand the downloaded APK to the package installer.
    implementation("androidx.core:core-ktx:1.13.1")
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
