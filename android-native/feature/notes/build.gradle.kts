plugins { alias(libs.plugins.android.library); alias(libs.plugins.compose.compiler) }
android {
    namespace = "com.byqx.feature.notes"
    compileSdk = 37
    defaultConfig { minSdk = 24 }
    buildFeatures { compose = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    implementation(project(":core:model")); implementation(project(":core:designsystem"))
    implementation(platform(libs.compose.bom)); implementation(libs.compose.material3); implementation(libs.compose.foundation); implementation(libs.compose.ui)
}
