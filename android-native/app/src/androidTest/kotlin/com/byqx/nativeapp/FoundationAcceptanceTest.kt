package com.byqx.nativeapp

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FoundationAcceptanceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun awaitHome() { compose.waitUntil(10_000) { compose.onAllNodesWithTag("home_screen").fetchSemanticsNodes().isNotEmpty() } }
    // DataStore writes run on IO; Compose idleness alone does not await persisted settings.
    private fun awaitSelected(tag: String) { compose.waitUntil(10_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().any { it.config.getOrElse(androidx.compose.ui.semantics.SemanticsProperties.Selected) { false } } } }
    private fun awaitReducedMotion(enabled: Boolean) { compose.waitUntil(10_000) { compose.onAllNodesWithTag("reduced_motion").fetchSemanticsNodes().any { it.config.getOrElse(androidx.compose.ui.semantics.SemanticsProperties.ToggleableState) { androidx.compose.ui.state.ToggleableState.Off } == if (enabled) androidx.compose.ui.state.ToggleableState.On else androidx.compose.ui.state.ToggleableState.Off } } }

    @Test fun fiveDestinationsAndBackNavigation() {
        awaitHome()
        for ((route, tag) in listOf("documents" to "module_screen_documents", "calendar" to "module_screen_calendar", "schedule" to "module_screen_schedule", "my" to "my_screen")) {
            compose.onNodeWithTag("nav_$route").performClick()
            compose.onNodeWithTag(tag).assertIsDisplayed()
        }
        compose.onNodeWithTag("nav_home").performClick()
        compose.onNodeWithTag("open_lab").performScrollTo().performClick()
        compose.onNodeWithTag("lab_screen").assertIsDisplayed()
        compose.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        compose.onNodeWithTag("home_screen").assertIsDisplayed()
    }

    @Test fun inputAndInteractionSurviveActivityRecreation() {
        awaitHome()
        compose.onNodeWithTag("open_lab").performScrollTo().performClick()
        compose.onNodeWithTag("press_card").performClick()
        compose.onNodeWithTag("demo_input").performTextInput("中文输入保持：阶段一")
        compose.activityRule.scenario.recreate()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("lab_screen").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("demo_input").assertTextContains("中文输入保持：阶段一")
        compose.onNodeWithText("已按压 1 次").assertExists()
    }

    @Test fun dialogAndSheetDismissReturnToLab() {
        awaitHome()
        compose.onNodeWithTag("open_lab").performScrollTo().performClick()
        compose.onNodeWithTag("open_dialog").performScrollTo().performClick()
        compose.onNodeWithText("原生确认弹窗").assertIsDisplayed()
        compose.onNodeWithTag("confirm_dialog").performClick()
        compose.onNodeWithText("原生确认弹窗").assertDoesNotExist()
        compose.onNodeWithTag("open_sheet").performScrollTo().performClick()
        compose.onNodeWithText("拇指可达的操作面板").assertIsDisplayed()
        compose.onNodeWithTag("close_sheet").performClick()
        compose.onNodeWithTag("lab_screen").assertIsDisplayed()
    }

    @Test fun preferencesPersistAcrossActivityRecreation() {
        awaitHome()
        compose.onNodeWithTag("nav_my").performClick()
        compose.onNodeWithTag("theme_DARK").performScrollTo().performClick()
        awaitSelected("theme_DARK")
        compose.onNodeWithTag("theme_DARK").assertIsSelected()
        val reduced = compose.onNodeWithTag("reduced_motion").performScrollTo()
        if (reduced.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.ToggleableState] != androidx.compose.ui.state.ToggleableState.On) reduced.performClick()
        awaitReducedMotion(true)
        compose.onNodeWithTag("reduced_motion").assertIsOn()
        compose.activityRule.scenario.recreate()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("my_screen").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("theme_DARK").performScrollTo().assertIsSelected()
        compose.onNodeWithTag("reduced_motion").performScrollTo().assertIsOn()
        // Restore the agreed defaults for the user's acceptance session.
        compose.onNodeWithTag("reduced_motion").performClick()
        awaitReducedMotion(false)
        compose.onNodeWithTag("theme_SYSTEM").performScrollTo().performClick()
        awaitSelected("theme_SYSTEM")
    }
}
