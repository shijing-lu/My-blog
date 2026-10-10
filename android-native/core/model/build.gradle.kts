plugins { alias(libs.plugins.android.library) }
android {
    namespace = "com.byqx.core.model"
    compileSdk = 37
    defaultConfig { minSdk = 24 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies { api(libs.coroutines.android); testImplementation(libs.junit) }
