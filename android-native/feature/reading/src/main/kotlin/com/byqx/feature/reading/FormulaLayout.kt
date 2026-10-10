package com.byqx.feature.reading
import ru.noties.jlatexmath.JLatexMathDrawable
/** Independent native TeX layout, drawn on Android Canvas; no HTML or WebView. */
object FormulaLayout {
    @Synchronized fun layout(tex:String,pixels:Float,color:Int):JLatexMathDrawable = JLatexMathDrawable.builder(tex).textSize(pixels).color(color).padding(4).build().also { it.setBounds(0,0,it.intrinsicWidth,it.intrinsicHeight) }
}
