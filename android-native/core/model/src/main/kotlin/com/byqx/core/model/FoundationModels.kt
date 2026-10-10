package com.byqx.core.model

enum class ThemeMode(val label: String) {
    SYSTEM("跟随系统"), LIGHT("浅色"), DARK("深色");
    companion object { fun fromStored(value: String?) = entries.firstOrNull { it.name == value } ?: SYSTEM }
}

data class AppearancePreferences(
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val dynamicColor: Boolean = false,
    val reducedMotion: Boolean = false,
)

data class ModuleInfo(val id: String, val name: String, val caption: String, val stage: Int, val abilities: List<String>)

object FoundationCatalog {
    const val STAGE = 4
    const val TOTAL_STAGES = 16
    val modules = listOf(
        ModuleInfo("articles", "文章", "阅读与创作", 4, listOf("分类、标签、归档与搜索", "目录、公式、扩展正文与解锁", "完整编辑器在第 5 阶段交付")),
        ModuleInfo("documents", "文档", "知识归入有序", 6, listOf("分类、文档册与目录树", "搜索、移动、排序与编辑", "整册离线下载与导出")),
        ModuleInfo("notes", "随心录", "随手记录想法", 3, listOf("第 3 阶段验证离线编辑与冲突同步", "第 7 阶段完善搜索与预览", "本地草稿与历史保留")),
        ModuleInfo("calendar", "日历", "日期与学习", 8, listOf("农历、重要日期与传统待办", "日记、热力图与学习记录", "与独立 Cadence 日程保持分工")),
        ModuleInfo("schedule", "日程", "计划与执行", 9, listOf("长期计划、每日计划与 1 分钟时间轴", "执行计时、完成联动", "第 10 阶段交付复盘、XY 待办与统计")),
        ModuleInfo("diary", "日志", "留下每日回顾", 7, listOf("历史日志与编辑", "来源日期与生成", "离线保存与私人数据保护")),
        ModuleInfo("gallery", "相册", "光影与瞬间", 11, listOf("浏览、上传与批量标签", "图片缩放、排序与编辑", "媒体缓存与上传重试")),
        ModuleInfo("moments", "动态", "分享与管理", 11, listOf("发布、预览、修改与删除", "评论与互动管理", "保留 Web 端数据与字段")),
        ModuleInfo("navigation", "导航站", "常用链接收藏", 11, listOf("分类、子分类与站点", "扫描元数据与排序", "系统浏览器打开外链")),
        ModuleInfo("mindmaps", "思维导图", "连接你的思路", 12, listOf("原生画布、节点编辑与正文引用", "布局、主题与自动保存", "PNG、SVG 与大纲导出")),
        ModuleInfo("netdisk", "网盘", "文件随身可达", 12, listOf("连接配置与测试", "目录、链接与下载", "现有文件操作的原生适配")),
        ModuleInfo("ai", "小卿 AI", "你的思考伙伴", 13, listOf("流式聊天、上下文与历史", "摘要、记忆与养成", "Cadence 助手与真实操作回执")),
        ModuleInfo("management", "站点管理", "管理你的 Web 站点", 14, listOf("内容管理、网站账号授权与评论", "图床、字体、CSS 与站点配置", "同步配置、迁移工具与备份")),
    )
    fun module(id: String) = modules.firstOrNull { it.id == id }
}
