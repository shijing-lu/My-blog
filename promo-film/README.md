# 白衣卿相 · 把思考，变成自己的世界。

为 My-Blog 制作的 56 秒品牌宣传片。大幅中文标题、电影感风景、界面动效与原创配乐，串起阅读、创作、生活记录和日程专注。

## 交付内容

| 项目             | 位置                                                       |
| ---------------- | ---------------------------------------------------------- |
| 完整视频         | `../outputs/promo-20261002/baiyi-personal-world-1080p.mp4` |
| 封面             | `../outputs/promo-20261002/poster.png`                     |
| 分镜与文案       | [storyboard.md](storyboard.md)                             |
| 图片提示词与来源 | [image-prompts.md](image-prompts.md)                       |
| 交付检查记录     | `../outputs/promo-20261002/交付说明.md`                    |
| 可编辑工程       | 本目录，Remotion 4.0.532 / React / TypeScript              |
| 本地预览         | 启动后访问 <http://localhost:3334/Baiyi-Promo>             |

**规格：** 1920 × 1080，16:9，30 fps，1680 帧，56 秒；H.264 视频、AAC 立体声。当前为音乐与文字版，没有旁白。

## 视觉与声音

从“世界很大”的情绪开场，进入“白衣卿相”的个人空间。在知识、写作、摄影、日程和灵感之间切换，最后回到山顶与品牌。

| 元素     | 处理方式                                                         |
| -------- | ---------------------------------------------------------------- |
| 博客配色 | 暖白 `#faf9f5`、墨黑 `#141413`、陶土橙 `#b3542d`、铜色 `#e08b6e` |
| 文字     | 霞鹜文楷中文大标题，短文案与字级对比                             |
| 品牌     | 使用现有像素“白”标记与“白衣卿相”名称                             |
| 界面     | 按博客导航、内容与色彩重构演示画面，加入透视、输入和主题切换     |
| 风景     | 生成的山顶云海、秋日湖泊、雨后城市；推进、遮罩与三联画切换       |
| 声音     | 120 BPM 原创合成配乐：钢琴琶音、铺底、低音、鼓点、气流与转场冲击 |

## 素材说明

- 界面为**功能演示视觉重构，非网站页面录像**。
- 文章、日程、随心录条目是演示文案，没有展示站主私密记录。
- 日程镜头标注“站主工作台”，对应站主的计划、专注和复盘功能。
- 三张风景图由内置 imagegen 生成，作为宣传意象，并非站主拍摄作品。
- 配乐与音效由 `scripts/make-score.py` 原创合成，未使用第三方音乐采样。
- 片尾没有加入未经确认的站点域名，以品牌和“从一次记录开始”收束。

## 预览和导出

在本目录运行：

```powershell
npm install --loglevel=error
npm run dev
```

访问 <http://localhost:3334/Baiyi-Promo>，点击播放。侧栏 `Scenes` 可以单独检查九个镜头；`Baiyi-Poster` 是封面。

```powershell
npm run check
npm run render
npm run poster
```

若本机提供 RTK，可在以上命令前使用 RTK。导出脚本覆盖本次交付目录中的同名成片。

### 修改位置

| 需求                       | 文件                                               |
| -------------------------- | -------------------------------------------------- |
| 配色、字体、缓动           | `src/style.ts`                                     |
| 镜头文案与布局             | `src/scenes/*.tsx`                                 |
| 镜头顺序、时长、转场、音量 | `src/Promo.tsx`                                    |
| 总帧数与画面尺寸           | `src/Root.tsx`                                     |
| 风景素材                   | `public/assets/summit.png`、`lake.png`、`city.png` |
| 音乐                       | `public/audio/score.wav`                           |
| 重新生成音乐               | `uv run --with numpy scripts/make-score.py`        |

动画全部按帧计算。总时长：`1824 个镜头帧 − 8 × 18 个转场重叠帧 = 1680 帧`。修改镜头时长后需同步总帧数，重新对齐音乐的转场音效。

中文标题、英文衬线与像素字体保存在 `public/fonts`，附带上游许可证。界面正文由 Windows 的 Microsoft YaHei 提供；移至其他系统后，需提供相同字体或更换中文无衬线字体并检查版面。

## 制作方法调研

Remotion 将 React 画面转成视频，适合将文字、图片、界面示意与音轨放进同一时间轴。按帧计算的动画可以重复导出并逐帧检查。[官方动画文档](https://www.remotion.dev/docs/animating-properties)

| 研究内容   | 本片应用                            | 官方资料                                                                   |
| ---------- | ----------------------------------- | -------------------------------------------------------------------------- |
| 帧驱动动画 | 标题入场、卡片移动、照片推进        | [Animating properties](https://www.remotion.dev/docs/animating-properties) |
| 镜头转场   | 擦除、淡化、滑动；每段重叠 18 帧    | [Transitions](https://www.remotion.dev/docs/transitions)                   |
| 音轨与音量 | 连续配乐及转场音效，音轨音量 0.86   | [Using audio](https://www.remotion.dev/docs/using-audio)                   |
| 字体等待   | 导出前加载本地字体                  | [loadFont](https://www.remotion.dev/docs/fonts-api/load-font)              |
| 编码导出   | 1080p MP4，H.264，CRF 18，YUV 4:2:0 | [Render CLI](https://www.remotion.dev/docs/cli/render)                     |

制作使用 Remotion 的 create、markup、studio、render 技能和内置 imagegen。检查结果记录在交付目录中。
