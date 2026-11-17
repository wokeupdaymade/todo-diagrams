# Design: the task model

Todo Diagrams is one model shown two ways. The **canvas** is where you place and
connect things. The **list** reads the same model as an outline, a list of
what's actionable now, and a step-by-step plan. Nothing in either view is a
separate copy. Both views render from the same stored board plus the same
derived analysis, so they can't drift apart.

```
          ┌──────────── stored (source of truth) ────────────┐
Board  =  Items (task · note · shape · area · text)  +  Links
          └───────────────────────┬───────────────────────────┘
                                  │  engine.analyze()  (pure, recomputed on every change)
                                  ▼
          derived: status roll-ups · blocked/ready · blockers · progress ·
                   impact · urgency · needed-by · warnings · plan · critical path
                                  │
                    ┌─────────────┴─────────────┐
                 Canvas                       List / Inspector
```

## 1. Two kinds of structure

Task managers usually blur two different questions. This model keeps them apart:

| Question | Mechanism | Effect |
|---|---|---|
| *What is this made of?* | **Subtask** links (a tree) | decomposition, status roll-up |
| *What has to happen first?* | **Blocks** links (a DAG) | ordering, blocking |
| *Where does this live?* | **Areas** (spatial frames) | grouping only, no effect on status |

A task has **at most one parent**. Any number of tasks can depend on each other,
across branches and across areas.

## 2. Items

| Kind | Meaning |
|---|---|
| **Task** | A unit of work. Stored status: `todo · doing · done · dropped`. Has priority, start/due dates, estimate (hours), tags, description (Markdown), checklist, color. |
| **Milestone** | A task flag. A checkpoint with no work of its own. If it has prerequisites, it is **reached automatically** when they are all resolved. It can't have subtasks. |
| **Note** | Free text (Markdown). Attach it to a task with an *annotates* link, and it then travels with the task in every view. |
| **Area** (frame) | A spatial container: a project, phase or context. An item belongs to the smallest area its center lies in. Moving an area moves its contents. In the list, areas become sections. |
| **Shape / Text** | Plain diagram elements with no task meaning. Shapes and notes can be converted into tasks. |

## 3. Links

| Type | Direction | Semantics |
|---|---|---|
| **Blocks** (`depends`) | prerequisite → dependent | Finish-to-start. The dependent is *blocked* until the prerequisite is resolved. |
| **Better before** (`soft`) | earlier → later | Advisory. Shapes the plan, but never blocks. |
| **Subtask** | parent → child | Decomposition (see roll-up rules below). |
| **Related** | — | A reference only. |
| **Note** (`annotates`) | note → task | Attaches a note. |
| **Line** | — | A plain connector. Arrows, dash and color are configurable. |

When you draw a connection, the canvas resolves the type from context. Task ↔ task
uses the selected link mode. Note ↔ task becomes an annotation. Anything involving
shapes or text becomes a plain line.

## 4. Derived rules

**Status roll-up.**
- A task with subtasks (a *composite*) takes its status from its non-dropped
  children: all done gives *done*, any started gives *in progress*, otherwise
  *to do*.
- Marking a composite done completes all of its open parts.
- *Dropped* on any task drops its whole branch.
- A milestone with prerequisites is *done* exactly when none of them are open.

**Blocking.** A task is blocked by every unresolved prerequisite of itself **or
of any ancestor**. If a phase is waiting, so is every step inside it. Depending
on a composite means waiting for all of its parts. Dropped prerequisites count
as resolved, but they raise a warning on the dependent.

**Display state:** `done · dropped · in progress · blocked · ready`.
You may start or finish a blocked task (reality is messy), but a task that is
*in progress while blocked* gets a warning.

**Ordering graph.** Internally every task `t` has a start node `S(t)` and an end node `E(t)`:

```
S(t) → E(t)               a task starts before it ends
S(parent) → S(child)      a part can't start before its whole may start
E(child) → E(parent)      a whole ends only when its parts have
E(prereq) → S(dependent)  finish-to-start (hard and soft links)
```

This single DAG gives every ordering feature a consistent meaning:

- **Cycle and deadlock prevention.** A link is rejected if adding it would
  create a cycle. Each rejection comes with an explanation. A task can't depend
  on its own ancestor or descendant. A subtask can't be placed under a parent
  that (indirectly) waits for it.
- **Suggested plan.** A topological order of leaf tasks. Among the tasks
  available at each point, it prefers: in progress, then higher *urgency*, then
  earlier *needed-by*, then more *impact*, then canvas position.
- **Critical path.** The longest chain of remaining work, weighted by estimate,
  or by task count when there are no estimates.

**Propagation to prerequisites.**
- *Impact*: how many open tasks transitively wait on this one.
- *Urgency*: the highest priority among the task, its ancestors, and everything
  that waits on it.
- *Needed by*: the earliest due date among the same set.

Together these make *Next up* surface the work that unblocks what matters.

**Warnings.** A task gets a warning when it is:
- overdue
- due before one of its prerequisites
- due after something that needs it
- due after its parent
- in progress while blocked
- waiting on a prerequisite that was dropped
- part of a dependency cycle (only possible in imported data)

**Deleting a task.**
- A dependency chain `A → X → B` stays ordered: deleting `X` adds `A → B`.
- The children of a deleted parent move up to the nearest surviving ancestor.

## 5. Views

- **Canvas** (React Flow): cards show state, progress, due date, estimate, tags,
  and the blocker they wait on. Edges are colored by meaning and state: an
  orange arrow is still blocking, a green arrow is satisfied. Subtrees can be
  collapsed; links into a collapsed branch are re-routed to its visible root.
  Focus mode dims everything not connected to the selection. Auto-layout offers
  *tree* (mirrors the outline) or *flow* (left → right).
- **List**:
  - *Outline*: a keyboard-first outliner. Enter, Tab and Shift+Tab edit the
    same subtask links you see on the canvas.
  - *Next up*: actionable work, with the reason it matters.
  - *Plan*: numbered steps, with milestones as checkpoints.
  - *Waiting*: what each blocked task waits for, plus the biggest unblockers.
  - *Done*.
- **Inspector**: explains state in words ("can't start until…", "inherited from
  parent…", "needed by … for …"). It also edits every relationship with
  search-or-create pickers.

## 6. Architecture

```
src/model/     types · factory · engine (derivation) · rules (link validation) · geometry (placement, layout) · sample
src/store/     zustand store: every mutation goes through mutate() → immer → undo history → re-analysis
               persist.ts: StorageAdapter (IndexedDB today; swap for a file/server adapter later)
src/canvas/    React Flow canvas, custom nodes, floating edges with own routing/markers, toolbar, context menu
src/list/      list view (outline / next / plan / waiting / done)
src/inspector/ details panel
src/ui/        shared widgets, chrome (sidebar, top bar, palette, help, toasts)
```

- The **model layer has no UI dependencies** and is unit-tested
  (`src/model/engine.test.ts`).
- **Undo/redo** stores whole-board snapshots. Immer's structural sharing keeps
  them cheap. Typing is coalesced, and drags and resizes count as one step each.
- **Persistence** goes through a small `StorageAdapter` interface, so a
  file-based or synced backend can replace IndexedDB without touching the rest
  of the app.
