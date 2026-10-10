package com.byqx.core.designsystem

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

@Composable
fun NeoCard(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.surfaceContainer,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val border = MaterialTheme.colorScheme.outline
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()
    val displacement by animateFloatAsState(if (pressed) 2f else 0f, tween(if (LocalMotionEnabled.current) 120 else 0), label = "cardPress")
    val shape = RoundedCornerShape(ByqxTokens.CardRadius)
    Box(modifier.padding(end = 3.dp, bottom = 3.dp).drawBehind {
        drawRoundRect(border, Offset(3.dp.toPx(), 3.dp.toPx()), size, CornerRadius(16.dp.toPx()))
    }) {
        Column(
            Modifier.fillMaxWidth().graphicsLayer { translationX = displacement.dp.toPx(); translationY = displacement.dp.toPx() }
                .clip(shape).background(color).border(ByqxTokens.Border, border, shape)
                .then(if (onClick != null) Modifier.clickable(interactionSource = interactions, indication = null, role = Role.Button, onClick = onClick) else Modifier)
                .padding(16.dp), content = content,
        )
    }
}

/** Small vector glyphs are decorative; the parent navigation item supplies its accessible label. */
@Composable
fun Glyph(name: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurface) {
    Canvas(modifier.size(24.dp)) {
        val s = size.width / 24f
        fun p(x: Float, y: Float) = Offset(x * s, y * s)
        val stroke = Stroke(1.8f * s)
        when (name) {
            "home" -> {
                val path = Path().apply { moveTo(3*s, 11*s); lineTo(12*s, 3*s); lineTo(21*s, 11*s); moveTo(5*s, 10*s); lineTo(5*s, 21*s); lineTo(19*s, 21*s); lineTo(19*s, 10*s); moveTo(9*s, 21*s); lineTo(9*s, 14*s); lineTo(15*s, 14*s); lineTo(15*s, 21*s) }
                drawPath(path, color, style = stroke)
            }
            "documents", "articles" -> {
                drawRoundRect(color, p(4f, 3f), Size(16*s, 18*s), CornerRadius(2*s), style = stroke)
                for (y in listOf(8f, 12f, 16f)) drawLine(color, p(8f,y),p(if(y==16f) 14f else 17f,y),1.8f*s)
            }
            "calendar" -> {
                drawRoundRect(color,p(3f,5f),Size(18*s,16*s),CornerRadius(2*s),style=stroke)
                drawLine(color,p(3f,10f),p(21f,10f),1.8f*s)
                drawLine(color,p(8f,2f),p(8f,7f),1.8f*s); drawLine(color,p(16f,2f),p(16f,7f),1.8f*s)
                drawCircle(color,1.5f*s,p(8f,15f)); drawCircle(color,1.5f*s,p(15f,15f))
            }
            "schedule" -> {
                drawCircle(color,9*s,p(12f,12f),style=stroke)
                drawLine(color,p(12f,6f),p(12f,12f),1.8f*s);drawLine(color,p(12f,12f),p(17f,15f),1.8f*s)
            }
            "my" -> { drawCircle(color,4*s,p(12f,7f),style=stroke);drawArc(color,180f,180f,false,p(4f,13f),Size(16*s,14*s),style=stroke) }
            "back" -> { drawLine(color,p(15f,4f),p(7f,12f),1.8f*s);drawLine(color,p(7f,12f),p(15f,20f),1.8f*s) }
            "arrow" -> { drawLine(color,p(5f,12f),p(20f,12f),1.8f*s);drawLine(color,p(14f,6f),p(20f,12f),1.8f*s);drawLine(color,p(14f,18f),p(20f,12f),1.8f*s) }
            else -> { drawRoundRect(color,p(3f,3f),Size(18*s,18*s),CornerRadius(4*s),style=stroke); drawLine(color,p(7f,12f),p(17f,12f),1.8f*s);drawLine(color,p(12f,7f),p(12f,17f),1.8f*s) }
        }
    }
}
