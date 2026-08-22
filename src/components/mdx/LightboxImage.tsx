/**
 * LightboxImage 组件 —— 图片灯箱包装
 *
 * MDX 中 `img` 元素映射到本组件：
 * - 渲染 `<figure data-lightbox>`，alt 作为说明文字（figcaption）；
 * - 点击图片进入灯箱预览（交互见 `src/scripts/lightbox.ts`）；
 * - 宽幅 object-cover 由布局（PhotoLayout）按需应用。
 */
import type { ComponentProps, ReactNode } from 'react';

/** 渲染一个可点击预览的图片 */
export default function LightboxImage({ alt = '', ...props }: ComponentProps<'img'>): ReactNode {
  return (
    <figure className="lightbox-figure" data-lightbox data-caption={alt}>
      <img alt={alt} loading="lazy" {...props} />
      {alt ? <figcaption>{alt}</figcaption> : null}
    </figure>
  );
}
