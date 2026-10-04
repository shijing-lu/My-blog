/**
 * 全局错误边界
 *
 * 纯本地应用最怕的是"白屏 + 数据还在但看不见"。
 * 因此兜底 UI 必须做到两件事：说清楚出了什么问题、告诉用户数据没丢。
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

import { HandRule } from "@/cadence/shared/motion";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 本阶段无上报服务，先落到控制台，便于本地排查
    console.error("[Cadence] 渲染异常:", error, info.componentStack);
  }

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  private readonly handleReset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="surface-card max-w-lg p-8">
          <h1 className="text-xl">这里出了点问题</h1>
          <HandRule shape="wave" tone="mark" className="my-3" />
          <p className="text-ink-2 text-sm">
            界面渲染时发生了异常。
            <strong>你的数据都存在本地，没有丢失。</strong>
            可以先尝试返回，或者刷新页面。
          </p>

          <pre className="surface-inset mt-4 max-h-40 overflow-auto rounded-[var(--radius-hand-sm)] p-3 text-xs whitespace-pre-wrap">
            {error.message}
          </pre>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={this.handleReset}
              className="craft-transition-fast rounded-[var(--radius-hand-pill)] bg-amber-deep px-5 py-2.5 text-sm text-paper-base hover:bg-amber-base"
            >
              重试
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="hand-frame craft-transition-fast px-5 py-2.5 text-sm text-ink-2 hover:text-ink-1"
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
