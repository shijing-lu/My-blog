package com.byqx.nativeapp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.byqx.core.document.*
import com.byqx.core.model.ConnectionStatus
import com.byqx.feature.reading.*
import kotlinx.coroutines.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.net.URL
import java.net.HttpURLConnection
import org.json.JSONObject

@RunWith(AndroidJUnit4::class) class ReadingAcceptanceTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private fun app()=compose.activity.application as NativeApplication
    private fun control(action:String):JSONObject { val c=URL("http://127.0.0.1:4343/$action").openConnection() as HttpURLConnection; c.connectTimeout=5000;c.readTimeout=5000;return try { JSONObject(c.inputStream.bufferedReader().readText()) } finally {c.disconnect()} }
    private fun bind() {
        control("reconnect")
        runBlocking { app().connectionRepository.initialize();app().connectionRepository.bind("http://127.0.0.1:4342","native-owner-fixture-only",true) }
        compose.waitUntil(15000) { app().connectionRepository.state.value.status==ConnectionStatus.CONNECTED && app().readingRepository.state.value.serverId!=null }
        runBlocking { app().readingRepository.refreshCatalog(true) }
        compose.waitUntil(5000) { app().readingRepository.state.value.articles.size==2 || app().readingRepository.state.value.message.contains("无法读取") }
        assertEquals(app().readingRepository.state.value.message,2,app().readingRepository.state.value.articles.size)
    }
    private fun openReader() { compose.onNodeWithTag("home_screen").performScrollToNode(hasTestTag("open_articles"));compose.onNodeWithTag("open_articles").performClick();compose.onNodeWithTag("articles_list").performScrollToNode(hasTestTag("article_native-reading-open"));compose.onNodeWithTag("article_native-reading-open").performClick();compose.waitUntil(10000) { app().readingRepository.state.value.details.containsKey("native-reading-open") } }
    private fun screenshot(name:String) { val context=InstrumentationRegistry.getInstrumentation().targetContext;val folder=context.getExternalFilesDir("stage-04-checks")!!;folder.mkdirs();val bitmap=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot();java.io.File(folder,"$name.png").outputStream().use {bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle() }
    @Test fun readerTocOfflineAndActivityRecreation() {
        bind();openReader();compose.onNodeWithTag("article_body").performScrollToIndex(0);screenshot("reader");compose.onNodeWithTag("article_toc").performClick();compose.onNodeWithTag("toc_drawer").assertExists();screenshot("toc");compose.onNodeWithText("宽内容").performClick();compose.onNodeWithTag("toc_drawer").assertDoesNotExist();screenshot("wide-content")
        control("disconnect")
        try {
            runBlocking { app().readingRepository.open("native-reading-open",force=true) }
            assertTrue(app().readingRepository.state.value.details.getValue("native-reading-open").source.contains(":::collapse"))
            compose.activityRule.scenario.recreate();compose.onNodeWithTag("article_reader").assertExists()
        } finally { control("reconnect") }
    }
    @Test fun correctPasswordAndCacheHitZeroReadingRequests() {
        bind();runBlocking { app().readingRepository.open("native-reading-locked","reading-fixture-only",true) }
        compose.waitUntil(5000) { app().readingRepository.state.value.details.containsKey("native-reading-locked") }
        control("reset-reading-count")
        runBlocking { app().readingRepository.refreshCatalog();app().readingRepository.open("native-reading-locked") }
        assertEquals(0,control("stats").getInt("readingRequests"))
        assertTrue(app().readingRepository.state.value.details.getValue("native-reading-locked").source.contains("仅正确密码"))
    }
    @Test fun nativeFormulaLayoutAndAllFixtureFamilies() {
        bind();runBlocking { app().readingRepository.open("native-reading-open",force=true) }
        compose.waitUntil(5000) { app().readingRepository.state.value.details.containsKey("native-reading-open") }
        val document=app().readingRepository.state.value.details.getValue("native-reading-open").document
        assertEquals(emptyList<String>(),document.unsupported)
        for(kind in listOf("math","inlineMath","footnote","footnoteRef","mark","spoiler","callout","collapse","tabs","columns","grid","code","table"))assertTrue("missing $kind",document.all().any{it.kind==kind})
        for(node in document.all().filter{it.kind in listOf("math","inlineMath")}) { val d=FormulaLayout.layout(node.text,36f,android.graphics.Color.BLACK);assertTrue(d.intrinsicWidth>0);assertTrue(d.intrinsicHeight>0) }
        val bytes=runBlocking { app().readingRepository.image("/reading-fixture.svg") };assertTrue(bytes.toString(Charsets.UTF_8).contains("<svg"))
    }
    @Test fun emptySearchIsCachedAndSearchFindsUncachedBody() {
        bind();val repository=app().readingRepository
        assertEquals(listOf("native-reading-open"),runBlocking {repository.search("宽表格只在自身区域横向滚动")}?.map{it.id})
        assertEquals(emptyList<Article>(),runBlocking {repository.search("stage4-no-match-unique")})
        control("reset-reading-count");assertEquals(emptyList<Article>(),runBlocking {repository.search("stage4-no-match-unique")});assertEquals(0,control("stats").getInt("readingRequests"))
    }
    @Test fun staleCacheFailureDoesNotDiscardBodyOrPosition() {
        bind();runBlocking {app().readingRepository.open("native-reading-open",force=true);app().readingRepository.position("native-reading-open",4,123)}
        compose.waitUntil(5000) {app().readingRepository.state.value.details.containsKey("native-reading-open")}
        control("disconnect")
        try {runBlocking {app().readingRepository.refreshCatalog(true);app().readingRepository.open("native-reading-open",force=true)};assertEquals(2,app().readingRepository.state.value.articles.size);assertTrue(app().readingRepository.state.value.details.containsKey("native-reading-open"));assertEquals(4 to 123,runBlocking {app().readingRepository.position("native-reading-open")})} finally {control("reconnect")}
    }
    @Test fun stage3EncryptedDraftStillExistsAfterUpgrade() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val database=androidx.room.Room.databaseBuilder(context,com.byqx.core.database.NativeDatabase::class.java,"private-notes.db").addMigrations(com.byqx.core.database.NativeDatabase.MIGRATION_1_2).build()
        try { val result=runBlocking(Dispatchers.IO) {
            database.openHelper.readableDatabase.query("SELECT serverId,draft FROM notes WHERE draft IS NOT NULL").use {cursor -> val cipher=com.byqx.core.sync.PrivateContentCipher();var found=false;while(cursor.moveToNext()) {if(cipher.decrypt(cursor.getString(0),cursor.getString(1)).contains("stage3-cold-draft-20261007"))found=true};found}
        };assertTrue("The previously verified stage3 draft must survive upgrade",result) } finally {database.close()}
    }
    @Test fun linkedTabsAccordionAndNativeImagePreview() {
        bind();openReader();val document=app().readingRepository.state.value.details.getValue("native-reading-open").document
        val tabs=document.nodes.filter {it.kind=="tabs"};val body=compose.onNodeWithTag("article_body")
        body.performScrollToNode(hasTestTag("tab_${tabs.first().id}_desktop"));compose.onNodeWithTag("tab_${tabs.first().id}_desktop").performClick();compose.onNodeWithText("电脑标签正文。").assertExists()
        body.performScrollToNode(hasTestTag("tab_${tabs.last().id}_desktop"));compose.onNodeWithText("联动电脑内容。").assertExists()
        val panels=document.all().filter {it.kind=="panel"};body.performScrollToNode(hasTestTag("panel_${panels.last().id}"));compose.onNodeWithTag("panel_${panels.last().id}").performClick();compose.onNodeWithText("第二面板正文。").assertExists();compose.onNodeWithText("第一面板正文。").assertDoesNotExist()
        val image=document.all().first {it.kind=="image"};body.performScrollToNode(hasTestTag("image_${image.id}"));compose.onNodeWithTag("image_${image.id}").performClick();compose.onNodeWithTag("image_preview").assertExists();screenshot("image-preview");compose.onNodeWithTag("image_close").performClick();compose.onNodeWithTag("image_preview").assertDoesNotExist()
    }
}
