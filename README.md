# Todo Diagrams

A local task manager for workflows that don't fit in a flat list. It combines a
**2D diagram editor** with a **structured task list**, and both are views of
the same model.

- **Decompose** work into subtasks, to any depth. A parent's status and
  progress roll up from its parts.
- **Sequence** work with dependencies. Tasks are *blocked* until their
  prerequisites, or their parent's prerequisites, are done. Circular
  dependencies and deadlocks are refused, with an explanation.
- **See what to do next.** The app works out what's actionable now, a
  step-by-step plan, the critical path, and which tasks unblock the most.
  Prerequisites inherit the urgency and deadlines of the work that waits on them.
- **Diagram freely.** Add notes, shapes, areas, text, colors, labels, and
  several connection styles. Plain diagram elements sit alongside tasks.
- **Work in either view.** Use the canvas, the list (outline, next up, plan,
  waiting, done) or a split of both. Edits in one view show up in the other
  immediately.

See **[docs/DESIGN.md](docs/DESIGN.md)** for the task model and its rules.

## Run it

Requires Node 18+.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. The first launch opens an example project
that demonstrates every concept.

To build a production bundle, which you can serve from any static file server:

```bash
npm run build
```

```bash
npm run preview
```

To run the model's unit tests:

```bash
npm test
```

Your data lives in the browser's IndexedDB. Use **Export all** in the sidebar
for JSON backups, and **Import** to restore them or move them between machines.

## Quick tour

| Do this | How |
|---|---|
| New task | Double-click the canvas, or press `T` |
| Subtask / next step / sibling | Select a task, then `Tab` / `Ctrl+Enter` / `Shift+Enter` |
| Connect | Drag from a card's edge dot. Drop on empty space to create a connected task. The toolbar (or keys `1`–`5`) sets what the link means. |
| Mark done / in progress | `Space` / `Shift+Space`, or click the status circle |
| Collapse a branch | `C`, or the chevron under a parent card |
| Focus on one task's chain | `F` |
| Tidy up | `Shift+L` (tree) or `Shift+W` (flow) |
| Outline editing | List view: `Enter` new row, `Tab`/`Shift+Tab` indent/outdent, `Alt+↑/↓` reorder |
| Jump anywhere | `Ctrl+K` |
| All shortcuts | `?` |

## Tech

React 18 · TypeScript · Vite · [React Flow](https://reactflow.dev) (canvas) ·
zustand + immer (state, undo) · dagre (flow layout) · idb-keyval (storage) ·
Vitest.
