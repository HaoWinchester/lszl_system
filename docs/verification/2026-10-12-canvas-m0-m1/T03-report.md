# T03 — exact keyword resolution and personal roots

Implemented D08 in the assigned source files, plus the small scoped editor CSS authorized in parent review. No sync, commit, branch switch, deployment, or main change performed.

## Root cause

`buildRootMap` called fuzzy association resolution and fell back to the first concept or clue ID. A substring such as “进度” therefore selected “进度基准”; missing/ambiguous mappings became system cards. Manual child input also used fuzzy resolution to write a system binding.

## Changes

- `src/95-recall-association-library.js`: added unique normalized title/English title/alias `resolveExact`; NFKC, trim, lowercase only. Existing fuzzy `resolve` remains for search.
- `src/recall/deep-recall-flow-model.js`: shared pure root priority rule: valid explicit association ID, unique legal concept association, unique exact title/alias. Invalid explicit IDs and ambiguous concepts never fall through to a different binding.
- `src/86-knowledge-recall.js`: automatic roots and typed child binding use exact resolution. Unmatched roots have `custom:true`, `personal:` ID, empty content and a writing prompt. Saved roots are reused by source root key before considering current matching. New nodes record matching source and source keyword. Personal root/child title and content editors save through existing customNodes/progress. Existing system cards expose explicit conversion and one-step session undo; loading never migrates them. IME Enter no longer submits the custom-child form. Editing-target shortcut checks pass full events exclusively to the parent's shared DOM guard. Conversion undo is cleared on session application, progress load and confirmed reset.
- `styles/knowledge-recall.css`: scoped themed grid editor with matching input/textarea/button appearance, focus ring and explicit accessible labels.
- `tests/recall-keyword-resolution.test.js`: real library/model tests for substrings, duplicate names/aliases, NFKC, explicit precedence, invalid IDs, valid concept preservation and ambiguity.
- `tests/recall-unmatched-custom-browser.py`: real Chromium UI plus real FastAPI/PostgreSQL session/progress on a disposable fixture, with source JS/CSS overrides. All success paths use real APIs; one intentional 503 response injection verifies save-failure draft retention.

## RED / GREEN evidence

1. Before resolver implementation: all three new Node tests failed due to absent exact/priority interfaces. After implementation: 3/3 passed.
2. Before controller integration: browser failed `unmatched keyword must create custom root` on the saved real API graph.
3. Before migrating typed-child automatic binding: browser failed `manual unmatched input must also stay custom` for “进度” against a “进度基准” library entry.
4. Final browser run passed root creation, title/content accessibility labels, empty-title rejection, edit, injected save failure preserving editable draft and successful retry, repeated keyword reuse, reload content recovery, IME non-submit, custom child edit/persistence, historic system root retention on load/click, explicit conversion/undo preserving child/edge relations, session switch clearing conversion undo, and reset/new-root clearing conversion undo.

Final command `node --test tests/recall-keyword-resolution.test.js tests/v90-p4512-deep-recall-flow-continuity.test.js tests/deep-recall-association-server-sync.test.js` in new-legacy: 5/5 passed. Syntax checks for all three changed JS files and scoped `git diff --check` passed. Browser command `python3 new-legacy/tests/recall-unmatched-custom-browser.py`: passed. Screenshot: `artifacts/canvas-m0-m1/T03-custom-root.png`.

## Remaining verification

The broader old direct-source tests `v862-p2224-deep-recall-card-delete-reset`, `v90-p4519-deep-recall-node-search`, and one case of `v90-p4529-deep-recall-flow` fail ENOENT for historical knowledge-recall-p*.css files already removed/consolidated by the project; those failures are not caused by T03. Parent owns adapter persistence-contract extension, full synced/release checks, integration and UAT deployment. User UAT remains required. Browser default port 5191 must be the disposable canvas_ink_server fixture, never production; start it with backend/.venv/bin/python new-legacy/tests/helpers/canvas_ink_server.py --port 5191.
