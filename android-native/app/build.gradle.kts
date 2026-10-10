plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}
android {
    namespace = "com.byqx.nativeapp"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.byqx.blog.nativeapp"
        minSdk = 24
        targetSdk = 37
        versionCode = 4
        versionName = "0.4.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes { release { isMinifyEnabled = true; isShrinkResources = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt")) } }
}
dependencies {
    implementation(project(":feature:reading"))
    implementation(project(":core:sync"))
    implementation(project(":feature:notes"))
    implementation(project(":core:identity"))
    implementation(project(":feature:connection"))
    implementation(project(":core:model"))
    implementation(project(":core:designsystem"))
    implementation(project(":core:preferences"))
    implementation(project(":feature:foundation"))
    implementation(platform(libs.compose.bom))
    implementation(libs.activity.compose)
    implementation(libs.compose.material3)
    implementation(libs.compose.animation)
    implementation(libs.navigation.compose)
    implementation(libs.lifecycle.compose)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.coroutines.android)
    debugImplementation(libs.compose.tooling)
    debugImplementation(libs.compose.test.manifest)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.test)
    androidTestImplementation(libs.test.runner)
    androidTestImplementation(libs.test.junit)
    androidTestImplementation(project(":core:database"))
    androidTestImplementation(project(":core:network"))
    androidTestImplementation(project(":feature:reading"))
}
