plugins { alias(libs.plugins.android.library) }
android {
    namespace = "com.byqx.core.preferences"
    compileSdk = 37
    defaultConfig { minSdk = 24 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    implementation(project(":core:model"))
    implementation(libs.datastore.preferences)
    implementation(libs.coroutines.android)
}
