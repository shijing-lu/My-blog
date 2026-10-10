import type { EditorView } from "@codemirror/view";
import { captureEditorProjection } from "./cm-columns-state";
import {
  activeAiEditor,
  requestAiEdit,
  type FrozenAiSelection,
} from "../../lib/ai-editor-bridge";
export function freezeAiSelection(
  view: EditorView,
  from: number,
  to: number,
): FrozenAiSelection | null {
  if (from >= to || !activeAiEditor()) return null;
  const projection = captureEditorProjection(view);
  if (!projection) return null;
  if (!activeAiEditor()?.ownsRoot(projection.root)) return null;
  const body = view.state.doc.toString();
  return {
    root: projection.root,
    source: projection.root.state.doc.toString(),
    text: body.slice(from, to),
    project: (replacement) =>
      projection.project(body.slice(0, from) + replacement + body.slice(to)),
  };
}
export const openAiSelection = (selection: FrozenAiSelection) =>
  requestAiEdit(selection);
