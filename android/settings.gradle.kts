// The Android companion is a standalone Gradle build inside the SitRep repo.
// It is deliberately NOT wired into the npm project: `npm run build`,
// `npm test` and the Cloudflare Pages deploy never see this directory.
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "sitrep-companion"
include(":app")
