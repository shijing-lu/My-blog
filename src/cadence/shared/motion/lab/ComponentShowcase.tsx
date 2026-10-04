/**
 * 动效实验室 · 手作化组件展示
 * ---------------------------------------------------------------------------
 * 目的：把 M1 交付的基础组件集中放一页，便于
 *   1. 检查手作语汇是否一致（圆角、压痕、笔触、颜料语义）
 *   2. 一键切到关闭档，验证"质感关闭后信息层次是否仍然完整"
 *
 * 最后一件事容易被忽略：很多人以为关闭动效/质感只是"少点好看"，
 * 实际上如果层级是靠阴影和纹理撑起来的，关掉之后界面会变得不可读。
 */

import { useState } from "react";

import { Button } from "@/cadence/shared/ui/Button";
import { Card, CardHeader } from "@/cadence/shared/ui/Card";
import { Checkbox } from "@/cadence/shared/ui/Checkbox";
import { ConfirmDialog } from "@/cadence/shared/ui/ConfirmDialog";
import {
  DualProgressRing,
  ProgressRing,
} from "@/cadence/shared/ui/ProgressRing";
import { Tag, TagAppearing } from "@/cadence/shared/ui/Tag";
import { TextField } from "@/cadence/shared/ui/TextField";
import { PresenceDialog } from "@/cadence/shared/motion";
import { PresenceSheet } from "@/cadence/shared/motion";
import { toast } from "@/cadence/shared/store/toast-store";

export function ComponentShowcase() {
  const [checked, setChecked] = useState(true);
  const [checked2, setChecked2] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [completion, setCompletion] = useState(68);
  const [ratio, setRatio] = useState(42);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="按钮" hint="三种形态" />
        <p className="text-ink-3 mt-1.5 mb-4 text-[12px]">
          手作语汇里，按钮更像一枚<b>被按进纸面的印章</b> ——
          所以按下的是凹陷（inset 压痕），而不是通用 UI 的浮起阴影。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button>开始计时</Button>
          <Button variant="ghost">稍后</Button>
          <Button variant="danger" size="sm">
            删除计划
          </Button>
          <Button loading>处理中</Button>
          <Button disabled>不可用</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="复选框 · 手绘勾" hint="pathLength 绘制" />
        <p className="text-ink-3 mt-1.5 mb-4 text-[12px]">
          外框先"弹"一下（checkPop），勾形随后写出（checkPath）—— 两个动作错开
          60ms 才有落笔的层次感，同步播放会显得敷衍。
        </p>
        <div className="space-y-3">
          <Checkbox checked={checked} onChange={setChecked}>
            完成复盘：08:00–10:00
          </Checkbox>
          <Checkbox
            checked={checked2}
            onChange={setChecked2}
            label="整理下周计划"
          >
            整理下周计划
          </Checkbox>
          <Checkbox checked={false} onChange={() => undefined} disabled>
            已归档（不可修改）
          </Checkbox>
        </div>
      </Card>

      <Card>
        <CardHeader title="标签" hint="soft 底 + deep 字" />
        <p className="text-ink-3 mt-1.5 mb-4 text-[12px]">
          每种颜料对应一件用户正在做的事：琥珀=计划、陶土=执行、森林=完成、手工蓝=待办、织物紫=复盘。
          对比度全部 ≥ 4.5:1（05 号文档 §2.5 实测表）。
        </p>
        <div className="flex flex-wrap gap-2">
          <Tag tone="plan" dot>
            计划
          </Tag>
          <Tag tone="session" dot>
            进行中
          </Tag>
          <Tag tone="done" dot>
            已完成
          </Tag>
          <Tag tone="todo" dot>
            待办
          </Tag>
          <Tag tone="review" dot>
            复盘
          </Tag>
          <Tag tone="archive">归档</Tag>
          <TagAppearing tone="plan">新标签 · 晕开</TagAppearing>
        </div>
      </Card>

      <Card>
        <CardHeader title="输入框 · 底部手绘线" hint="聚焦时重描" />
        <p className="text-ink-3 mt-1.5 mb-4 text-[12px]">
          不用四边方框，像在纸上划一条横格线。点进输入框看波浪线被重新"描"一遍。
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="计划名称" placeholder="给它起个名字…" wave="wave" />
          <TextField
            label="预估时长"
            placeholder="分钟"
            wave="ripple"
            hint="留空表示不预估"
            inputMode="numeric"
          />
          <TextField
            label="复盘周期"
            placeholder="小时"
            wave="gentle"
            defaultValue="abc"
            error="必须是正整数小时"
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="进度环 · 毛笔描边" hint="pathLength 绘制" />
        <p className="text-ink-3 mt-1.5 mb-4 text-[12px]">
          端头用圆头（像毛笔收笔），而不是被切断的直角。 双环版本同时表达
          <b>完成率</b>与<b>实际投入 / 预估</b> ——
          只看完成率是不够的，还要看节奏是否健康。
        </p>
        <div className="flex flex-wrap items-center gap-8">
          <ProgressRing value={completion} semantic="plan" />
          <ProgressRing
            value={ratio}
            semantic="review"
            size={80}
            thickness={7}
          />
          <DualProgressRing completion={completion} timeRatio={ratio} />
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // 刻意不用 Math.random()：红线 C6 禁止在 src 下使用它。
                // 而且对演示来说，确定性序列比随机值更好 —— 数据可复现，
                // 每次点到的都是同一组，便于对比"哪一组看起来对"。
                const next = (completion + 17) % 101;
                setCompletion(next);
                setRatio((ratio + 29) % 101);
              }}
            >
              下一组数据
            </Button>
            <p className="text-ink-4 text-[11px]">
              数字用 AnimatedNumber：滚动期间直接改 textContent，不重渲染
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="模态 / 抽屉 / 提示"
          hint="Radix 管无障碍，我们管动画"
        />
        <p className="text-ink-3 mt-1.5 mb-4 text-[12px]">
          Radix 提供焦点陷阱、Esc 关闭、焦点归还、滚动锁定；动画完全自建。
          抽屉在窄屏会自动变成从底部升起的面板 —— 调用方不需要关心这件事。
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
            打开模态
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSheetOpen(true)}>
            打开抽屉
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmOpen(true)}
          >
            危险操作确认
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toast.success("计划已保存")}
          >
            成功提示
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              toast.undoable("已删除「写季度复盘」", () => toast.info("已撤销"))
            }
          >
            可撤销提示
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toast.sticky("检测到未结束的计时，请确认如何处理")}
          >
            常驻提示
          </Button>
        </div>
      </Card>

      <PresenceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="新建计划"
        description="模态的焦点会被锁定在内部，关闭后归还给触发元素。"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDialogOpen(false);
                toast.success("计划已创建");
              }}
            >
              创建
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <TextField
            label="计划名称"
            placeholder="例如：完成季度复盘"
            hideLabel={false}
          />
          <TextField
            label="目标说明"
            placeholder="为什么要做这件事"
            hint="可以留空"
          />
        </div>
      </PresenceDialog>

      <PresenceSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="筛选条件"
        description="宽屏从右侧滑入，窄屏从底部升起。缩小窗口试试。"
      >
        <div className="space-y-4">
          <TextField label="标签" placeholder="输入标签名" />
          <TextField label="关键词" placeholder="搜索标题或描述" />
          <div className="flex gap-2">
            <Tag tone="plan">进行中</Tag>
            <Tag tone="todo">未开始</Tag>
            <Tag tone="done">已完成</Tag>
          </div>
        </div>
      </PresenceSheet>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="删除这个计划？"
        description="计划会被放入回收站，30 天内可以恢复。关联的执行记录与复盘数据会保留。"
        danger
        confirmLabel="删除"
        onConfirm={() => toast.warning("已移入回收站")}
      >
        <div className="surface-inset p-3 text-[12.5px] text-ink-2">
          将影响：3 个任务、12 条执行记录、5 条复盘条目
        </div>
      </ConfirmDialog>
    </div>
  );
}
