pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "ByqxNative"
include(":app", ":core:model", ":core:designsystem", ":core:preferences", ":feature:foundation")
include(":core:network", ":core:identity", ":feature:connection")
include(":core:database", ":core:sync", ":feature:notes")
include(":core:document", ":feature:reading")
