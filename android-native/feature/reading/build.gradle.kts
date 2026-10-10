plugins { alias(libs.plugins.android.library); alias(libs.plugins.compose.compiler); alias(libs.plugins.serialization) }
android { namespace = "com.byqx.feature.reading"; compileSdk = 37; defaultConfig { minSdk = 24 }; buildFeatures { compose = true }; compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 } }
dependencies {
    implementation(project(":core:model")); implementation(project(":core:designsystem")); api(project(":core:document"))
    implementation(project(":core:identity")); implementation(project(":core:network")); implementation(project(":core:database")); implementation(project(":core:sync"))
    implementation(platform(libs.compose.bom)); implementation(libs.compose.material3); implementation(libs.compose.foundation); implementation(libs.compose.ui)
    implementation(libs.lifecycle.viewmodel); implementation(libs.coroutines.android); implementation(libs.serialization.json)
    implementation(libs.activity.compose)
    implementation(libs.okhttp); api("ru.noties:jlatexmath-android:0.2.0")
    implementation("io.coil-kt.coil3:coil-compose:3.6.3"); implementation("io.coil-kt.coil3:coil-svg:3.6.3"); implementation("io.coil-kt.coil3:coil-gif:3.6.3")
    testImplementation(libs.junit)
}
