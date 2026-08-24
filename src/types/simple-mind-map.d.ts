/**
 * simple-mind-map 最小类型声明
 *
 * 官方包未提供 types（types 字段指向不存在的文件），这里声明本项目用到的
 * 核心 API（构造、读写数据、事件、导出），其余通过索引签名兼容。
 * 完整 API 见 https://wanglin2.github.io/mind-map-docs/zh/
 */
declare module 'simple-mind-map' {
  /** 思维导图节点 */
  export interface MindMapNodeData {
    data: {
      /** 节点文本 */
      text: string;
      /** 是否展开 */
      expand?: boolean;
      /** 扩展字段：段落锚点 / 原文片段 / 学习状态等，由本系统写入 */
      anchorId?: string;
      snippet?: string;
      status?: 'mastered' | 'learning' | 'doubt';
      [key: string]: unknown;
    };
    children?: MindMapNodeData[];
    [key: string]: unknown;
  }

  /** 全量数据（getData(true) / setData 格式） */
  export interface MindMapData {
    layout?: string;
    root?: MindMapNodeData;
    theme?: {
      template?: string;
      config?: Record<string, unknown>;
    };
    view?: {
      transform?: number[];
    };
  }

  export interface MindMapOptions {
    /** 容器元素（必传） */
    el: HTMLElement;
    /** 回显数据 */
    data?: MindMapData;
    /** 是否只读 */
    readonly?: boolean;
    /** 布局（logicalStructure 逻辑结构图等） */
    layout?: string;
    /** 主题 */
    theme?: string;
    /** 主题配置 */
    themeConfig?: Record<string, unknown>;
    /** 最小缩放（百分数） */
    minZoomRatio?: number;
    /** 最大缩放（百分数，-1 不限） */
    maxZoomRatio?: number;
    [key: string]: unknown;
  }

  /** 导出格式 */
  export type ExportType = 'png' | 'svg' | 'json' | 'pdf' | 'md' | 'markdown' | 'smm';

  export default class MindMap {
    constructor(options: MindMapOptions);
    /** 绑定事件（node_click / node_dblclick / data_change / view_data_change 等） */
    on(event: string, fn: (...args: unknown[]) => void): void;
    off(event: string, fn?: (...args: unknown[]) => void): void;
    /** 获取数据；withConfig=true 返回含 layout/root/theme/view 的全量 */
    getData(withConfig?: boolean): MindMapData;
    /** 设置数据（接受 getData(true) 的全量格式） */
    setData(data: MindMapData): void;
    render(): void;
    resize(): void;
    destroy(): void;
    setTheme(theme: string): void;
    getTheme(): string;
    setLayout(layout: string): void;
    getLayout(): string;
    /** 导出（png/svg/json/pdf/md 等，异步） */
    export(type: ExportType, ...args: unknown[]): Promise<unknown>;
    view: {
      getTransformData(): unknown;
      setTransformData(data: unknown): void;
      reset(): void;
      enlarge(): void;
      narrow(): void;
    };
    [key: string]: unknown;
  }
}
