/**
 * twikoo 评论系统类型声明（官方包无 TS 类型）
 */
declare module 'twikoo' {
  export interface TwikooInitOptions {
    /** 评论区挂载元素（选择器或元素） */
    el: string | HTMLElement;
    /** Twikoo 后端地址（envId） */
    envId: string;
    /** 评论归属路径（区分文章/动态评论线程） */
    path?: string;
    /** 语言 */
    lang?: string;
    /** 主题：light | dark | auto */
    theme?: 'light' | 'dark' | 'auto';
    /** 初始化完成回调 */
    onCommentLoaded?: () => void;
  }

  export interface TwikooUpdateConfig {
    theme?: 'light' | 'dark' | 'auto';
    [key: string]: unknown;
  }

  /** 初始化评论 */
  export function init(options: TwikooInitOptions): Promise<void>;
  /** 更新配置（如切换主题） */
  export function updateConfig(config: TwikooUpdateConfig): Promise<void>;
  /** 重新加载 */
  export function reload(el?: string | HTMLElement): Promise<void>;
  /** 获取当前配置 */
  export function getConfig(el?: string | HTMLElement): Promise<Record<string, unknown>>;
  /** 关闭（注销） */
  export function close(): Promise<void>;

  const twikoo: {
    init: typeof init;
    updateConfig: typeof updateConfig;
    reload: typeof reload;
    getConfig: typeof getConfig;
    close: typeof close;
  };
  export default twikoo;
}
