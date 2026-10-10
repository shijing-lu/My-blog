package com.byqx.core.designsystem

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byqx.core.model.AppearancePreferences
import com.byqx.core.model.ThemeMode

object ByqxTokens {
    val Paper = Color(0xFFFAF8F4)
    val Ink = Color(0xFF171717)
    val Yellow = Color(0xFFFFD43B)
    val Mint = Color(0xFF4DD4C6)
    val Lilac = Color(0xFFB9A4FF)
    val Border = 2.dp
    val CardRadius = 16.dp
    val HardShadow = 3.dp
}

val LocalMotionEnabled = staticCompositionLocalOf { true }

private val Light = lightColorScheme(
    primary = ByqxTokens.Ink, onPrimary = ByqxTokens.Paper,
    primaryContainer = ByqxTokens.Yellow, onPrimaryContainer = ByqxTokens.Ink,
    secondary = Color(0xFF006B60), secondaryContainer = ByqxTokens.Mint, onSecondaryContainer = ByqxTokens.Ink,
    tertiaryContainer = ByqxTokens.Lilac, onTertiaryContainer = ByqxTokens.Ink,
    background = ByqxTokens.Paper, onBackground = ByqxTokens.Ink,
    surface = ByqxTokens.Paper, onSurface = ByqxTokens.Ink,
    surfaceContainer = Color(0xFFF0EDE5), surfaceVariant = Color(0xFFECE8DF), onSurfaceVariant = Color(0xFF5B5750),
    outline = ByqxTokens.Ink,
)
private val Dark = darkColorScheme(
    primary = ByqxTokens.Yellow, onPrimary = ByqxTokens.Ink,
    primaryContainer = Color(0xFF5C4A00), onPrimaryContainer = ByqxTokens.Yellow,
    secondary = ByqxTokens.Mint, secondaryContainer = Color(0xFF004E46), onSecondaryContainer = ByqxTokens.Mint,
    tertiaryContainer = Color(0xFF4C3D72), onTertiaryContainer = ByqxTokens.Lilac,
    background = ByqxTokens.Ink, onBackground = ByqxTokens.Paper,
    surface = ByqxTokens.Ink, onSurface = ByqxTokens.Paper,
    surfaceContainer = Color(0xFF252525), surfaceVariant = Color(0xFF303030), onSurfaceVariant = Color(0xFFC9C5BB),
    outline = Color(0xFFD4CEC1),
)
private val Type = Typography(
    headlineLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 32.sp, lineHeight = 40.sp),
    headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 26.sp, lineHeight = 34.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 30.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp, lineHeight = 24.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 26.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 22.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 14.sp, lineHeight = 20.sp),
)

@Composable
fun ByqxTheme(preferences: AppearancePreferences, systemReducedMotion: Boolean, content: @Composable () -> Unit) {
    val dark = when (preferences.theme) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.DARK -> true
        ThemeMode.LIGHT -> false
    }
    val context = LocalContext.current
    val scheme = if (preferences.dynamicColor && Build.VERSION.SDK_INT >= 31) {
        if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    } else if (dark) Dark else Light
    val enabled = !(preferences.reducedMotion || systemReducedMotion)
    CompositionLocalProvider(LocalMotionEnabled provides enabled) {
        MaterialTheme(colorScheme = scheme, typography = Type, content = content)
    }
}
