plugins { alias(libs.plugins.android.library); alias(libs.plugins.serialization) }
android { namespace = "com.byqx.core.document"; compileSdk = 37; defaultConfig { minSdk = 24 }; compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }; testOptions.unitTests.all { it.systemProperty("nativeFixturePath", "${rootDir.parent}/scripts/native-reading-fixture.md") } }
dependencies {
    api(libs.serialization.json)
    implementation("org.commonmark:commonmark:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-tables:0.24.0")
    implementation("org.commonmark:commonmark-ext-gfm-strikethrough:0.24.0")
    testImplementation(libs.junit)
}
