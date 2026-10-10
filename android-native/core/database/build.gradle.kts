plugins { alias(libs.plugins.android.library) }
android {
    namespace = "com.byqx.core.database"
    compileSdk = 37
    defaultConfig {
        minSdk = 24
        javaCompileOptions { annotationProcessorOptions { arguments["room.schemaLocation"] = "$projectDir/schemas" } }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies { api(libs.room.runtime); api(libs.room.ktx); api(libs.coroutines.android); annotationProcessor(libs.room.compiler) }
