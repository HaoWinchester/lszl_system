# User Management Grid Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the user-management action-button icon baseline and align the wide-PC content columns exactly with the four summary cards.

**Architecture:** Keep the existing HTML and JavaScript untouched. Add geometry assertions to the existing Playwright visual regression, then make the minimum scoped changes in the user-management Focus / Vega adapter: flex-center the three header action buttons and reuse one four-column grid definition for the summary and wide-PC workspace.

**Tech Stack:** Native HTML/CSS/JavaScript, Playwright Python regression, local Lucide SVG sprite.

## Global Constraints

- Modify style and test behavior only; do not change business logic, DOM order, API calls, authentication, subscriptions, or payment UI.
- Apply the four-column shared grid only at `min-width: 1181px`; preserve the existing `901px—1180px` compact PC layout.
- Source changes belong in `new-legacy/`; do not hand-edit the active release or `frontend/public/new-legacy/`.
- Verify at `1440 × 900`, `1366 × 768`, and `1024 × 768`.

---

### Task 1: Lock and correct user-management alignment

**Files:**
- Modify: `new-legacy/tests/admin-focus-vega-pc-browser.py`
- Modify: `new-legacy/styles/admin-focus-vega-users.css`

**Interfaces:**
- Consumes: `.um-summary`, `.um-layout`, `.um-left-card`, `.um-editor-card`, `.um-right-card`, `.um-top-actions`, and the existing `data-admin-icon` markup.
- Produces: browser assertions for exact wide-PC column boundaries and vertically centered top action-button icon/text pairs.

- [ ] **Step 1: Write the failing geometry regression**

Add four synthetic `.um-stat` elements when mounting `user-management.html`, then assert at widths of at least `1181px`:

```python
assert_close(left['x'], stats[0]['x'])
assert_close(left['right'], stats[0]['right'])
assert_close(editor['x'], stats[1]['x'])
assert_close(editor['right'], stats[2]['right'])
assert_close(right['x'], stats[3]['x'])
assert_close(right['right'], stats[3]['right'])
```

For `#umAddUserBtn`, `#umExportBtn`, and `#umImportBtn`, require `display: inline-flex`, `align-items: center`, a positive icon-to-label gap, and at most `1px` difference between icon and label vertical centers.

- [ ] **Step 2: Run the focused browser test and verify RED**

Run:

```bash
python3 new-legacy/tests/admin-focus-vega-pc-browser.py
```

Expected: FAIL on `user-management.html` because the current workspace uses independent `300px / 1fr / 330px` tracks and the action buttons render as block boxes with baseline-aligned inline children.

- [ ] **Step 3: Apply the minimum scoped CSS correction**

Use a shared gap variable, flex-center the header buttons, and replace only the wide-PC grid rule:

```css
body[data-admin-skin="focus-vega"] .um-app{--um-grid-gap:10px}
body[data-admin-skin="focus-vega"] .um-top-actions button{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:7px;
}
@media (min-width:901px) and (min-width:1181px){
  body[data-admin-skin="focus-vega"] .um-summary,
  body[data-admin-skin="focus-vega"] .um-layout{
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:var(--um-grid-gap);
  }
  body[data-admin-skin="focus-vega"] .um-left-card{grid-column:1}
  body[data-admin-skin="focus-vega"] .um-editor-card{grid-column:2/4}
  body[data-admin-skin="focus-vega"] .um-right-card{grid-column:4}
}
```

Also normalize the icon slot to a `16px` square with zero line-height so the SVG has no baseline contribution.

- [ ] **Step 4: Run targeted and existing contracts and verify GREEN**

Run:

```bash
node --test new-legacy/tests/admin-focus-vega-skin-contract.test.js
python3 new-legacy/tests/admin-focus-vega-pc-browser.py
```

Expected: the static contract passes and all `24/24` page/viewport browser checks pass.

- [ ] **Step 5: Rebuild the isolated local preview and inspect live geometry**

Create a new temporary release root through `manage-new-legacy.js update ... --skip-browser`, restart the local backend preview on `127.0.0.1:8011`, log in as the local administrator, and measure the live `user-management.html` card and button bounding boxes. Do not promote or publish the candidate.
