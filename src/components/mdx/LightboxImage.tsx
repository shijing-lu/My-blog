/**
 * LightboxImage 组件 —— 图片灯箱包装
 *
 * MDX 中 `img` 元素映射到本组件：
 * - 渲染 `<figure data-lightbox>`，图注取 `title`（优先）或 `alt`；
 * - 点击图片进入灯箱预览（交互见 `src/scripts/lightbox.ts`）；
 * - 灯箱分组不需要本组件参与：脚本按「最近的 `.md-grid` 祖先」判定，
 *   因此 `:::grid` 内的图片自动成为一组，容器外的正文图片行为与从前一致；
 * - 宽幅 object-cover 由布局（PhotoLayout）按需应用。
 */
import type { ComponentProps, ReactNode } from 'react';

/** 渲染一个可点击预览的图片 */
export default function LightboxImage({ alt = '', title, ...props }: ComponentProps<'img'>): ReactNode {
  // 图注优先级：title > alt（`![无障碍文本](/a.webp "图注")`）
  const caption = (typeof title === 'string' && title.trim()) || alt;

  return (
    <figure className="lightbox-figure" data-lightbox data-caption={caption}>
      <img alt={alt} title={title} loading="lazy" {...props} />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
