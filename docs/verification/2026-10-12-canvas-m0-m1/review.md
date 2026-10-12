# Independent M0/M1 review

Reviewed working changes against `6289fa0b`, authoritative source only (generated public copies excluded), on 2026-10-12. Scope: T00–T04, design D08/D10 and shared overlay §4.1. No source changes, release changes, commits, or branch operations performed.

## Findings requiring correction before UAT

### P1 — unrelated view preference events overwrite a document background

`new-legacy/src/77-multi-question-workspace.js:5735–5744`, especially assignment at 5740.

The new listener writes the complete global appearance preference object into the active workspace on every preference event. Loading a document only applies its background to the surface; it does not make settings/minimap reads document-aware. Therefore global preferences may belong to another document. Confirmed using real disposable server `127.0.0.1:5189`: create A yellow/grid; create B blue/solid; load A (correctly yellow/grid); call the existing minimap action `KGCanvasAppearanceController.setMinimapExpanded(false)`. A changes from `{backgroundColor:'#fff8dc',pattern:'grid'}` to `{backgroundColor:'#eef6ff',pattern:'solid'}` and is written to the store. This violates document background isolation and makes an unrelated minimap action persistently change user content. Settings open/cancel also uses `appearance.read()` as the original value and can overwrite the document on cancel. Fix settings reads/writes against the active document and prevent non-background events from replacing background fields; cover two-document switch, minimap toggle, cancel, and pattern-only changes. Parent assigned this fix to workspace_m1.

### P2 — temporary related canvas remains outside the fullscreen host

`new-legacy/src/10-graph-editor.js:817` still appends `.related-canvas-backdrop` to `document.body`, without registering the new shared overlay host or lifecycle cleanup. Design §4.1 explicitly includes this existing overlay in T01 migration. Confirmed in real Chrome against the disposable server: enter home `#stage` fullscreen, set the related center and open the temporary related canvas. Open returns true, but `document.fullscreenElement.contains(overlay)` is false and the center hit test returns the stage, so the requested canvas is invisible/inaccessible. This is a pre-existing defect left unfixed within the explicitly promised T01 scope. Mount through the shared helper, dispose on close, and verify open/close/fullscreen exit restoration and no duplicate listeners.

## Verified independently

- `node --test frontend/scripts/canvas-m1-regressions.test.mjs`: passed (wrapper plus its eight underlying files).
- Scoped `git diff --check -- new-legacy backend frontend/scripts`: passed.
- Real Chrome shared ink editor fullscreen exit preserved active textarea, selection and continued keyboard input: selected `BC` in `ABCD`, exited fullscreen, typed `X`, obtained `AXD`. No focus-loss finding.
- Inspected shared input ownership/IME, modal movement lifecycle, extracted color CSS and HTML/bundle registrations, exact matching precedence/custom roots/edit/conversion/reset behavior, strict `.01–4` schema range, and minimal idle `will-change` removal. No further important defect confirmed in these areas.

## Limits

Disposable browser fixtures were used; no production data or deployment operations. Existing implementation reports and browser tests were read, but their full matrix was not rerun. Safari, OS/browser zoom 125%, and complete UAT business acceptance are not established by this review. Generated release parity and release promotion remain the parent task’s responsibility. This review is developer self-check, not user UAT acceptance.
