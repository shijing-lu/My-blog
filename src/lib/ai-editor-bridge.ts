import type { EditorView } from "@codemirror/view";
export interface FrozenAiSelection {
  text: string;
  project: (replacement: string) => string;
  source: string;
  root: EditorView;
}
export interface AiEditorTarget {
  session: string;
  domain: "article" | "doc";
  targetId: string;
  ownsRoot(root: EditorView): boolean;
  source(): string;
  flush(): Promise<boolean>;
  lock(locked: boolean): void;
  apply(source: string, contentHash?: string): void;
}
let active: AiEditorTarget | null = null;
let pending: AiEditorTarget | null = null;
const changed = () => window.dispatchEvent(new Event("ai:editor-change"));
export function registerAiEditor(target: AiEditorTarget): () => void {
  pending = target;
  active = null;
  changed();
  void fetch("/api/admin-auth/me", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then(
      (identity: { identity?: string; account?: { role?: string } } | null) => {
        if (pending !== target) return;
        if (
          identity?.identity === "top" ||
          (identity?.identity === "github" && identity.account?.role === "top")
        ) {
          active = target;
          changed();
        }
      },
    )
    .catch(() => {});
  return () => {
    if (pending === target) pending = null;
    if (active === target) {
      active = null;
      changed();
    }
  };
}
export function activeAiEditor() {
  return active;
}
export function requestAiEdit(selection?: FrozenAiSelection) {
  if (!active) return false;
  if (selection && !active.ownsRoot(selection.root)) return false;
  window.dispatchEvent(
    new CustomEvent("ai:edit-open", { detail: { target: active, selection } }),
  );
  return true;
}
