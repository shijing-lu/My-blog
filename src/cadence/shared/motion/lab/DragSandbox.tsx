/**
 * 动效实验室 · 拖拽沙盒
 * ---------------------------------------------------------------------------
 * 这一节要证明的是**一个具体的技术主张**：
 *
 *   拖拽全程零渲染；松手提交后，也只有**被拖的那个节点**重渲染。
 *
 * 验证方式：面板显示「本次提交引发的节点渲染数」。
 *   节点组件用 React.memo 且 props 引用稳定 → 预期值是 1。
 *   如果把坐标放进 state（红牌 R3 禁止的写法），200 个节点每帧重渲染，
 *   这个数字会是几千。
 *
 * ⚠️ 测量语义（第一版在这里犯过错）：
 *   不能显示"累计渲染次数"——它把挂载、切标签、重置都算进去，
 *   数字会随操作历史变化，无法作为断言依据。
 *   正确做法是测**单次提交的增量**：提交时记下累计值，
 *   下一帧（React 渲染完成后）再读一次，两者之差才是本次提交的代价。
 *
 * ⚠️ 本沙盒刻意**不做** FLIP 让位（"其余便利贴平滑让位"）。
 *    让位与拖拽位移会互相干扰（拖动中的元素不该再被 FLIP 移动一次），
 *    需要区分拖动中/非拖动中元素，属于 M6 的 todo-axis-board 的职责。
 */

import { memo, useCallback, useRef, useState, type RefObject } from "react";

import {
  AnimatedNumber,
  DraggableSurface,
  StickyNote,
} from "@/cadence/shared/motion";
import { useFpsMeter } from "../hooks";

interface SandboxNode {
  id: string;
  x: number;
  y: number;
}

const PRESETS = [10, 60, 200] as const;

/**
 * 模块级渲染计数器
 *
 * 为什么是模块级而不是通过 props 传 ref 下来：
 *   props 传 ref 会让 SandboxNode 多一个依赖，而且 memo 的 props 比较要把它排除。
 *   计数器是纯粹的测量工具，放模块级最干净 —— 但也因此**只在单实例页面**下有效，
 *   实验室恰好就是单实例。
 */
const renderCounter = { value: 0 };

/**
 * 网格铺开：保证**互不重叠**。
 *
 * 为什么不用更有"手工感"的随机/螺旋分布：
 *   1. 螺旋分布在节点多时会大量重叠，最底层的节点被完全盖住 ——
 *      E2E 想拖动某个节点时，指针实际命中的是别的节点，测试会静默失败。
 *   2. 网格保证每个节点完整可见、可命中，且同一档位布局完全一致，
 *      帧率数据才可比较（性能测试要的是可复现，不是好看）。
 */
function seedNodes(count: number): SandboxNode[] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));

  return Array.from({ length: count }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      id: `n-${i}`,
      x: cols === 1 ? 50 : 8 + (col / (cols - 1)) * 84,
      // y 轴向上为正：row 0 在最上面，所以从高往低排
      y: rows === 1 ? 50 : 92 - (row / (rows - 1)) * 84,
    };
  });
}

export function DragSandbox() {
  const [count, setCount] = useState<number>(60);
  const [nodes, setNodes] = useState<SandboxNode[]>(() => seedNodes(60));
  const [commits, setCommits] = useState(0);
  /** 最近一次提交引发的节点渲染数（memo 生效应为 1） */
  const [renderDelta, setRenderDelta] = useState<number | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);
  /** 上次读取累计值时的快照，用于算增量 */
  const snapshotRef = useRef(0);

  const stats = useFpsMeter(true);

  const reset = useCallback((next: number) => {
    setCount(next);
    setNodes(seedNodes(next));
    setCommits(0);
    setRenderDelta(null);
    renderCounter.value = 0;
    snapshotRef.current = 0;
  }, []);

  const handleCommit = useCallback(
    (id: string, point: { x: number; y: number }) => {
      const before = renderCounter.value;
      setNodes((prev) =>
        prev.map((node) => (node.id === id ? { ...node, ...point } : node)),
      );
      setCommits((c) => c + 1);

      // 增量必须在 React 渲染**之后**才能读到，
      // 所以推迟到下一帧 —— 这也是为什么不能在 setState 后立刻同步取值
      requestAnimationFrame(() => {
        const delta = renderCounter.value - before;
        snapshotRef.current = renderCounter.value;
        setRenderDelta(delta);
      });
    },
    [],
  );

  const totalNodes = nodes.length;

  return (
    <div className="space-y-5">
      <section className="surface-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[15px]">拖拽沙盒</h3>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => reset(n)}
                aria-pressed={n === count}
                className={[
                  "craft-transition-fast numeric rounded-[var(--radius-hand-pill)] px-3.5 py-1.5 text-[12.5px]",
                  n === count
                    ? "text-paper-base bg-amber-deep"
                    : "hand-frame text-ink-3 hover:text-ink-1",
                ].join(" ")}
              >
                {n} 条
              </button>
            ))}
          </div>
        </div>

        <p className="text-ink-3 mt-1.5 text-[12px] leading-relaxed">
          拖动任意便利贴。<b>本次提交渲染节点数</b>应为{" "}
          <b className="numeric">1</b>
          （节点组件已 memo，只有坐标变化的那一个会重渲染）。
          如果这个数字接近节点总数，说明坐标进了 React state 或 props 引用不稳定
          —— 那正是红牌 R3 要禁止的写法。
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="surface-inset p-3" data-testid="metric-nodes">
            <dt className="text-ink-3 text-[11px]">节点数</dt>
            <dd className="numeric text-ink-1 font-serif text-[19px] leading-tight">
              {totalNodes}
            </dd>
          </div>
          <div className="surface-inset p-3" data-testid="metric-commits">
            <dt className="text-ink-3 text-[11px]">提交次数</dt>
            <dd className="text-ink-1 font-serif text-[19px] leading-tight">
              <AnimatedNumber value={commits} />
            </dd>
            <p className="text-ink-4 mt-0.5 text-[10.5px]">松手次数</p>
          </div>
          <div className="surface-inset p-3" data-testid="metric-renders">
            <dt className="text-ink-3 text-[11px]">本次提交渲染节点数</dt>
            <dd
              className={[
                "font-serif text-[19px] leading-tight",
                renderDelta === null
                  ? "text-ink-1"
                  : renderDelta <= 1
                    ? "text-forest-deep"
                    : "text-clay-deep",
              ].join(" ")}
            >
              {renderDelta === null ? (
                "—"
              ) : (
                <AnimatedNumber value={renderDelta} />
              )}
            </dd>
            <p className="text-ink-4 mt-0.5 text-[10.5px]">memo 生效应为 1</p>
          </div>
          <div className="surface-inset p-3" data-testid="metric-fps">
            <dt className="text-ink-3 text-[11px]">拖拽时帧率</dt>
            <dd
              className={[
                "font-serif text-[19px] leading-tight",
                stats.fps >= 55
                  ? "text-forest-deep"
                  : stats.fps > 0
                    ? "text-clay-deep"
                    : "text-ink-1",
              ].join(" ")}
            >
              <AnimatedNumber value={stats.fps} suffix="fps" />
            </dd>
            <p className="text-ink-4 mt-0.5 text-[10.5px]">
              长任务 {stats.longTasks}
            </p>
          </div>
        </dl>
      </section>

      <section className="surface-card p-5">
        <div
          ref={boardRef}
          data-testid="drag-board"
          className="relative h-[520px] overflow-hidden rounded-[var(--radius-hand-md)] shadow-[inset_0_0_0_1.5px_var(--color-paper-line)]"
        >
          {/* 象限底：同一颜料系的四档明度，而非四个不同色相 */}
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
            <div className="bg-amber-soft" />
            <div className="bg-clay-soft" />
            <div className="bg-craft-soft" />
            <div className="bg-forest-soft" />
          </div>
          <span
            aria-hidden="true"
            className="bg-paper-line absolute inset-y-0 left-1/2 z-[2] w-[1.5px]"
          />
          <span
            aria-hidden="true"
            className="bg-paper-line absolute top-1/2 right-0 left-0 z-[2] h-[1.5px]"
          />

          {nodes.map((node) => (
            <SandboxNode
              key={node.id}
              node={node}
              boardRef={boardRef}
              onCommit={handleCommit}
            />
          ))}
        </div>

        <p className="text-ink-4 mt-3 text-[11px] leading-relaxed">
          节点用网格分布（无重叠、确定性），保证每个节点可完整命中、
          同一档位的布局每次一致 —— 性能数据才可比较。
        </p>
      </section>
    </div>
  );
}

/**
 * memo 是这里的关键：
 * props 中 node 只有被拖的那一个会变（其余引用不变），
 * onCommit / boardRef 都是稳定引用 —— 因此一次提交只重渲染 1 个节点。
 * 没有 memo 的话，一次提交 = 全部节点重渲染（200 个），性能预算直接爆掉。
 */
const SandboxNode = memo(function SandboxNode({
  node,
  boardRef,
  onCommit,
}: {
  node: SandboxNode;
  boardRef: RefObject<HTMLDivElement | null>;
  onCommit: (id: string, point: { x: number; y: number }) => void;
}) {
  // 渲染计数：在渲染期间累加。读模块级变量，测量本身零成本、不触发渲染。
  renderCounter.value += 1;

  return (
    <div
      className="absolute z-10"
      style={{
        left: `${node.x}%`,
        // 业务坐标 y 轴向上为正，屏幕坐标向下为正
        top: `${100 - node.y}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      <DraggableSurface
        id={node.id}
        value={node}
        containerRef={boardRef}
        onCommit={(point) => onCommit(node.id, point)}
        className="w-[78px]"
      >
        <StickyNote
          id={node.id}
          size="compact"
          tone="paper"
          maxTilt={1}
          className="pointer-events-none w-full text-center"
        >
          {node.id.replace("n-", "#")}
        </StickyNote>
      </DraggableSurface>
    </div>
  );
});
