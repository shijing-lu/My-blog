plugins { alias(libs.plugins.android.library); alias(libs.plugins.serialization) }
android {
    namespace = "com.byqx.core.network"
    compileSdk = 37
    defaultConfig { minSdk = 24 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    api(libs.retrofit)
    api(libs.serialization.json)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    testImplementation(libs.junit)
}
