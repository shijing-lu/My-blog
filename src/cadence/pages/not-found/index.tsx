import { Link } from "@tanstack/react-router";

import { HandRule } from "@/cadence/shared/motion";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <div className="surface-card relative max-w-md overflow-hidden p-8 text-center">
        <span className="watercolor-blot h-40 w-56 -top-12 -left-10 bg-[radial-gradient(closest-side,var(--color-amber-soft),transparent)]" />
        <div className="relative">
          <p className="numeric text-amber-deep font-serif text-[46px] leading-none">
            404
          </p>
          <h2 className="mt-2 text-xl">这张纸是空白的</h2>
          <HandRule
            shape="wave"
            tone="mark"
            className="mx-auto my-4 max-w-40"
          />
          <p className="text-ink-2 text-[13px]">
            你要找的页面不存在，或者已经被移走了。
          </p>
          <Link
            to="/"
            className="craft-transition-fast mt-6 inline-block rounded-[var(--radius-hand-pill)] bg-amber-deep px-5 py-2.5 text-sm text-paper-base hover:bg-amber-base"
          >
            回到今天
          </Link>
        </div>
      </div>
    </div>
  );
}
