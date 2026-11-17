import { analyze, todayISO } from './engine';
import { makeBoard, makeFrame, makeLink, makeNote, makeShape, makeTask, makeText } from './factory';
import { boundsOf, computeLayout } from './geometry';
import type { Board, LinkType, TaskItem } from './types';

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return todayISO(d);
};

/** A small example project that demonstrates every concept of the model. */
export function createSampleBoard(): Board {
  const b = makeBoard('Example: launch a product');
  let order = 0;
  const task = (title: string, p: Partial<TaskItem> = {}) => {
    const t = makeTask({ title, h: 84, order: ++order, ...p });
    b.items[t.id] = t;
    return t;
  };
  const link = (type: LinkType, s: { id: string }, t: { id: string }, label = '') => {
    const l = makeLink(type, s.id, t.id, { label });
    b.links[l.id] = l;
    return l;
  };
  const sub = (parent: TaskItem, ...kids: TaskItem[]) => kids.forEach((k) => link('subtask', parent, k));

  // --- Research
  const research = task('Research', { color: 'teal', description: 'Understand who this is for before designing anything.' });
  const interviews = task('Interview 5 users', { status: 'done', estimate: 6, tags: ['research'], color: 'teal' });
  const competitors = task('Competitor review', { status: 'done', estimate: 3, tags: ['research'], color: 'teal' });
  const summary = task('Summarize findings', { status: 'doing', estimate: 2, tags: ['research'], color: 'teal', priority: 3 });
  sub(research, interviews, competitors, summary);
  link('depends', interviews, summary);

  // --- Design
  const design = task('Design', { color: 'purple' });
  const wire = task('Wireframes', { estimate: 4, tags: ['design'], color: 'purple' });
  const visual = task('Visual design', { estimate: 6, tags: ['design'], color: 'purple' });
  const usability = task('Usability check', { estimate: 2, tags: ['design', 'research'], color: 'purple' });
  sub(design, wire, visual, usability);
  link('depends', wire, visual);
  link('soft', wire, usability);
  link('depends', research, design);

  // --- Build
  const build = task('Build v1', { color: 'blue', priority: 3 });
  const repo = task('Set up repository & CI', { status: 'done', estimate: 2, tags: ['dev'], color: 'blue' });
  const api = task('Implement API', {
    estimate: 10,
    tags: ['dev'],
    color: 'blue',
    checklist: [
      { id: 'c1', text: 'Auth endpoints', done: true },
      { id: 'c2', text: 'Data model', done: false },
      { id: 'c3', text: 'Rate limiting', done: false },
    ],
  });
  const frontend = task('Build frontend', { estimate: 12, tags: ['dev'], color: 'blue' });
  const tests = task('End-to-end tests', { estimate: 4, tags: ['dev', 'qa'], color: 'blue' });
  sub(build, repo, api, frontend, tests);
  link('depends', repo, api);
  link('depends', visual, frontend, 'needs final designs');
  link('depends', api, frontend);
  link('soft', api, tests);

  // --- Launch
  const beta = task('Beta ready', { milestone: true, w: 200, color: 'orange' });
  link('depends', build, beta);
  link('depends', usability, beta);
  const post = task('Write launch post', { estimate: 3, tags: ['marketing'], color: 'pink', due: addDays(12) });
  link('soft', design, post);
  const launch = task('Launch 🚀', { priority: 4, due: addDays(14), color: 'orange', description: 'Go live and announce.' });
  link('depends', beta, launch);
  link('depends', post, launch);

  // tidy positions with the tree layout, then wrap in an area
  const a = analyze(b);
  const pos = computeLayout(b, a, 'tree', null);
  for (const [id, p] of Object.entries(pos)) {
    b.items[id].x = p.x + 40;
    b.items[id].y = p.y + 80;
  }
  const tasks = Object.values(b.items);
  const bb = boundsOf(tasks)!;
  const frame = makeFrame({
    title: 'Product launch',
    color: 'blue',
    x: bb.x - 40,
    y: bb.y - 72,
    w: bb.w + 80,
    h: bb.h + 112,
  });
  b.items[frame.id] = frame;
  for (const t of tasks) t.frameId = frame.id;

  // notes
  const apiNote = makeNote({
    text: '**Reuse** the existing auth service.\nSee the architecture doc before starting.',
    x: api.x + api.w + 24,
    y: api.y - 30,
    w: 190,
    h: 110,
    frameId: frame.id,
  });
  b.items[apiNote.id] = apiNote;
  link('annotates', apiNote, api);

  // a plain diagram shape connected with a non-semantic line
  const users = makeShape('ellipse', { text: 'Early users', color: 'teal', x: interviews.x - 20, y: frame.y - 150, w: 150, h: 80 });
  b.items[users.id] = users;
  link('line', users, interviews, 'recruit from waitlist');

  // getting-started notes to the left
  const gx = frame.x - 330;
  const title = makeText({ text: 'Getting started', x: gx, y: frame.y, w: 280, fontSize: 22 });
  b.items[title.id] = title;
  const tips = [
    '**Double-click** the canvas to add a task.\n**Drag** from a card’s edge dot to connect — drop on empty space to create a connected task.',
    'Pick the **link type** in the toolbar:\n→ *Blocks*: must finish first\n⇢ *Better before*: advisory\n◆ *Subtask*: is a part of\n··· *Related*',
    'With a task selected:\n**Tab** add subtask · **Ctrl+Enter** add next step · **Space** toggle done · **Enter** rename.\nPress **?** for all shortcuts.',
    'The **List** and **Split** views show the same tasks as an outline, next actions and a step-by-step plan. Edit in either — they stay in sync.',
  ];
  tips.forEach((text, i) => {
    const n = makeNote({ text, x: gx, y: frame.y + 50 + i * 168, w: 280, h: 150, color: i % 2 ? 'blue' : 'yellow' });
    b.items[n.id] = n;
  });

  return b;
}
