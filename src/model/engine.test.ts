import { describe, expect, it } from 'vitest';
import { analyze, downstreamOf, upstreamOf } from './engine';
import { makeBoard, makeLink, makeNote, makeTask } from './factory';
import { checkLink } from './rules';
import type { Board, LinkType, TaskItem } from './types';

function board(...tasks: TaskItem[]): Board {
  const b = makeBoard('t');
  for (const t of tasks) b.items[t.id] = t;
  return b;
}
function link(b: Board, type: LinkType, s: string, t: string) {
  const l = makeLink(type, s, t);
  b.links[l.id] = l;
  return l;
}
const T = (title: string, p: Partial<TaskItem> = {}) => makeTask({ id: title, title, ...p });

describe('dependencies', () => {
  it('blocks a dependent until the prerequisite is done', () => {
    const b = board(T('a'), T('b'));
    link(b, 'depends', 'a', 'b');
    let an = analyze(b);
    expect(an.tasks.get('a')!.state).toBe('ready');
    expect(an.tasks.get('b')!.state).toBe('blocked');
    expect(an.tasks.get('b')!.blockers).toEqual([{ id: 'a', via: null }]);
    (b.items.a as TaskItem).status = 'done';
    an = analyze(b);
    expect(an.tasks.get('b')!.state).toBe('ready');
  });

  it('dropped prerequisites resolve but warn', () => {
    const b = board(T('a', { status: 'dropped' }), T('b'));
    link(b, 'depends', 'a', 'b');
    const an = analyze(b);
    expect(an.tasks.get('b')!.state).toBe('ready');
    expect(an.tasks.get('b')!.warnings.some((w) => w.kind === 'dropped-prereq')).toBe(true);
  });

  it('soft dependencies never block', () => {
    const b = board(T('a'), T('b'));
    link(b, 'soft', 'a', 'b');
    const an = analyze(b);
    expect(an.tasks.get('b')!.state).toBe('ready');
    expect(an.tasks.get('b')!.softPending).toEqual(['a']);
    expect(an.plan).toEqual(['a', 'b']);
  });
});

describe('hierarchy', () => {
  it('composite status rolls up from children', () => {
    const b = board(T('p'), T('c1'), T('c2'));
    link(b, 'subtask', 'p', 'c1');
    link(b, 'subtask', 'p', 'c2');
    let an = analyze(b);
    expect(an.tasks.get('p')!.status).toBe('todo');
    expect(an.tasks.get('p')!.progress).toMatchObject({ done: 0, total: 2 });
    (b.items.c1 as TaskItem).status = 'done';
    an = analyze(b);
    expect(an.tasks.get('p')!.status).toBe('doing');
    (b.items.c2 as TaskItem).status = 'dropped';
    an = analyze(b);
    expect(an.tasks.get('p')!.status).toBe('done');
    expect(an.tasks.get('p')!.progress).toMatchObject({ done: 1, total: 1 });
  });

  it('children inherit blocking from a blocked parent', () => {
    const b = board(T('x'), T('p'), T('c'));
    link(b, 'depends', 'x', 'p');
    link(b, 'subtask', 'p', 'c');
    const an = analyze(b);
    expect(an.tasks.get('c')!.state).toBe('blocked');
    expect(an.tasks.get('c')!.blockers).toEqual([{ id: 'x', via: 'p' }]);
  });

  it('depending on a composite waits for all its parts', () => {
    const b = board(T('p'), T('c1', { status: 'done' }), T('c2'), T('after'));
    link(b, 'subtask', 'p', 'c1');
    link(b, 'subtask', 'p', 'c2');
    link(b, 'depends', 'p', 'after');
    let an = analyze(b);
    expect(an.tasks.get('after')!.state).toBe('blocked');
    (b.items.c2 as TaskItem).status = 'done';
    an = analyze(b);
    expect(an.tasks.get('after')!.state).toBe('ready');
  });

  it('dropping a parent drops the branch', () => {
    const b = board(T('p', { status: 'dropped' }), T('c'));
    link(b, 'subtask', 'p', 'c');
    expect(analyze(b).tasks.get('c')!.status).toBe('dropped');
  });
});

describe('milestones', () => {
  it('are reached automatically when prerequisites are done', () => {
    const b = board(T('a'), T('b'), T('m', { milestone: true }));
    link(b, 'depends', 'a', 'm');
    link(b, 'depends', 'b', 'm');
    let an = analyze(b);
    expect(an.tasks.get('m')!.state).toBe('blocked');
    (b.items.a as TaskItem).status = 'done';
    (b.items.b as TaskItem).status = 'done';
    an = analyze(b);
    expect(an.tasks.get('m')!.status).toBe('done');
  });
});

describe('plan & impact', () => {
  it('orders by dependencies and computes impact', () => {
    const b = board(T('a'), T('b'), T('c'), T('d'));
    link(b, 'depends', 'a', 'b');
    link(b, 'depends', 'b', 'c');
    link(b, 'depends', 'a', 'd');
    const an = analyze(b);
    expect(an.plan.indexOf('a')).toBeLessThan(an.plan.indexOf('b'));
    expect(an.plan.indexOf('b')).toBeLessThan(an.plan.indexOf('c'));
    expect(an.tasks.get('a')!.impact).toBe(3);
    expect(an.next).toEqual(['a']);
  });

  it('prerequisites inherit urgency and needed-by date', () => {
    const b = board(T('a'), T('b', { priority: 4, due: '2030-01-10' }));
    link(b, 'depends', 'a', 'b');
    const an = analyze(b);
    expect(an.tasks.get('a')!.urgency).toBe(4);
    expect(an.tasks.get('a')!.neededBy).toBe('2030-01-10');
  });

  it('detects the critical path', () => {
    const b = board(T('a', { estimate: 5 }), T('b', { estimate: 1 }), T('c', { estimate: 3 }));
    link(b, 'depends', 'a', 'c');
    link(b, 'depends', 'b', 'c');
    const an = analyze(b);
    expect(an.tasks.get('a')!.critical).toBe(true);
    expect(an.tasks.get('c')!.critical).toBe(true);
    expect(an.tasks.get('b')!.critical).toBe(false);
  });

  it('upstream / downstream traverse hierarchy', () => {
    const b = board(T('x'), T('p'), T('c'), T('y'));
    link(b, 'depends', 'x', 'p');
    link(b, 'subtask', 'p', 'c');
    link(b, 'depends', 'p', 'y');
    const an = analyze(b);
    expect([...upstreamOf(an, 'c')]).toEqual(['x']);
    expect(downstreamOf(an, 'c').has('y')).toBe(true);
  });
});

describe('warnings', () => {
  it('flags due-date conflicts and overdue tasks', () => {
    const b = board(T('a', { due: '2030-02-01' }), T('b', { due: '2030-01-01' }), T('old', { due: '2000-01-01' }));
    link(b, 'depends', 'a', 'b');
    const an = analyze(b, '2026-01-01');
    expect(an.tasks.get('b')!.warnings.some((w) => w.kind === 'due-conflict')).toBe(true);
    expect(an.tasks.get('old')!.overdue).toBe(true);
  });
});

describe('rules', () => {
  it('rejects cycles', () => {
    const b = board(T('a'), T('b'), T('c'));
    link(b, 'depends', 'a', 'b');
    link(b, 'depends', 'b', 'c');
    const r = checkLink(b, 'depends', 'c', 'a');
    expect(r.ok).toBe(false);
  });

  it('rejects dependencies inside one branch', () => {
    const b = board(T('p'), T('c'));
    link(b, 'subtask', 'p', 'c');
    expect(checkLink(b, 'depends', 'c', 'p').ok).toBe(false);
    expect(checkLink(b, 'depends', 'p', 'c').ok).toBe(false);
  });

  it('rejects subtask deadlocks', () => {
    // p waits for x, x waits for c → c can't become part of p
    const b = board(T('p'), T('x'), T('c'));
    link(b, 'depends', 'x', 'p');
    link(b, 'depends', 'c', 'x');
    expect(checkLink(b, 'subtask', 'p', 'c').ok).toBe(false);
  });

  it('reparents when a task gets a new parent', () => {
    const b = board(T('p1'), T('p2'), T('c'));
    const old = link(b, 'subtask', 'p1', 'c');
    const r = checkLink(b, 'subtask', 'p2', 'c');
    expect(r.ok && r.replaces).toEqual([old.id]);
  });

  it('replaces the opposite dependency direction', () => {
    const b = board(T('a'), T('b'));
    const old = link(b, 'depends', 'a', 'b');
    const r = checkLink(b, 'depends', 'b', 'a');
    expect(r.ok && r.replaces).toEqual([old.id]);
  });

  it('normalizes note annotations', () => {
    const b = board(T('a'));
    const n = makeNote({ id: 'n' });
    b.items.n = n;
    const r = checkLink(b, 'annotates', 'a', 'n');
    expect(r.ok && [r.source, r.target]).toEqual(['n', 'a']);
  });
});
