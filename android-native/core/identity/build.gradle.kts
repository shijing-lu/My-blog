plugins { alias(libs.plugins.android.library); alias(libs.plugins.serialization) }
android {
    namespace = "com.byqx.core.identity"
    compileSdk = 37
    defaultConfig { minSdk = 24 }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    api(project(":core:model"))
    implementation(project(":core:network"))
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)
    testImplementation(libs.junit)
}
