/**
 * 分段控件（无业务基础组件）
 *
 * 手作化的细节：选中项不是"高亮块"，而是一张**垫在下面的小纸片** ——
 * 用纸色差与 inset 描边表达，而不是用饱和度。
 * 这样在深浅两套主题下都成立，也不会抢走颜料语义色的表达权。
 */

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 无障碍标签 */
  label: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      data-m3-role="segmented-control"
      role="radiogroup"
      aria-label={label}
      className={[
        "surface-inset inline-flex gap-1 p-1",
        "shadow-[inset_0_0_0_1px_var(--color-paper-line)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ borderRadius: "var(--radius-hand-pill)" }}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            data-m3-role="segment"
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(event) => {
              const key = event.key;
              if (
                ![
                  "ArrowLeft",
                  "ArrowRight",
                  "ArrowUp",
                  "ArrowDown",
                  "Home",
                  "End",
                ].includes(key)
              )
                return;
              event.preventDefault();
              const next =
                key === "Home"
                  ? 0
                  : key === "End"
                    ? options.length - 1
                    : (index +
                        (key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1) +
                        options.length) %
                      options.length;
              const selected = options[next];
              if (selected) onChange(selected.value);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                [next]?.focus();
            }}
            onClick={() => onChange(option.value)}
            title={option.hint}
            className={[
              "craft-transition-fast rounded-[var(--radius-hand-pill)] px-3.5 py-1.5 text-[12.5px]",
              active
                ? "bg-paper-1 text-ink-1 shadow-[inset_0_0_0_1px_var(--color-paper-line),0_1px_2px_-1px_var(--paper-shadow)]"
                : "text-ink-3 hover:text-ink-1",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
