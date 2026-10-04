# 图片提示词与素材来源

三张图使用 Codex 内置 imagegen 生成，作为本片的宣传意象。以下为生成方向与提示词记录，方便继续创作同系列画面。生成图不标记为站主摄影作品。

## 山顶云海 · summit.png

项目路径：`public/assets/summit.png`。用于开场、片尾和封面。

```text
Cinematic photorealistic widescreen landscape for a premium personal blog brand film. A vast mountain range above an ocean of clouds at dawn. An enormous warm terracotta orange sun on the right horizon illuminates the clouds in copper and amber. Deep charcoal mountain ridges form powerful silhouettes. A tiny solitary traveler stands on a rocky summit in the lower right, conveying the scale of the world and freedom of thought. Keep the left half calm and dark enough for large white Chinese titles added later. Dramatic light, tactile rock detail, subtle film grain, rich photographic atmosphere and editorial composition. Restrained warm orange and charcoal palette. Landscape 16:9. No lettering, logos or watermark.
```

## 秋日镜湖 · lake.png

项目路径：`public/assets/lake.png`。用于摄影三联画及满屏摄影镜头。

```text
Cinematic photorealistic alpine lake in autumn at sunrise. Dramatic rocky mountains beyond still water, copper and rust orange forest around the shore, delicate dawn mist over the lake. A quiet wooden dock reaches into the foreground. Mirror-like reflections, golden light, clear water texture, premium travel editorial photography. Strong depth and calm; generous space for white Chinese promotional titles. Rich detail, natural filmic contrast, muted charcoal shadows and terracotta accents. Landscape 16:9. No lettering, logos, watermark or crowds.
```

## 雨后城市 · city.png

项目路径：`public/assets/city.png`。用于摄影三联画的中央画面。

```text
Cinematic photorealistic rainy blue-hour city scene inspired by contemporary Shanghai. A quiet street with warm red brick architecture and a glowing archway, wet pavement reflecting copper light, subtle silhouettes of modern buildings in the background. Poetic and contemplative, for a personal blog about thought, life and photography. Strong architectural depth, rich blue charcoal atmosphere balanced with warm terracotta illumination. Premium editorial photograph, realistic texture, restrained film grain. Landscape 16:9. No recognizable commercial signs, text, logos, watermark or people.
```

## 其他素材

| 素材                       | 来源                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `public/assets/brand.png`  | 博客已有 `build/icon.png`                                                                  |
| `public/fonts/WenKai.ttf`  | 博客已有 `LXGWWenKaiScreen.ttf`；[上游](https://github.com/lxgw/LxgwWenKai-Screen)，附 OFL |
| `public/fonts/Lora.woff2`  | 博客依赖 `@fontsource/lora` 的 Latin 700 字重，附 LICENSE                                  |
| `public/fonts/Pixel.woff2` | 博客已有 Fusion Pixel Font，附 OFL 与来源许可证                                            |
| Microsoft YaHei            | Windows 系统提供，未复制字体文件                                                           |
| `public/audio/score.wav`   | 本工程原创合成，56 秒，48 kHz，立体声，无第三方采样                                        |

图片通过视频中的裁切、缩放、遮罩与文字叠加使用。工程内包含图片、音频和本地字体；界面正文仍需要系统中文字体。
