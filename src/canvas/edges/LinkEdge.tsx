import { EdgeLabelRenderer, useInternalNode, type Edge, type EdgeProps, type InternalNode, type Node } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import type { Item, Link } from '../../model/types';
import { useStore } from '../../store/store';
import { canTreeRoute, edgePath, markerPath, type Box } from './geometry';

export type EdgeTone = 'wait' | 'ok' | 'muted' | 'tree' | 'soft' | 'soft-ok' | 'note' | 'rel' | 'line';

export interface LinkEdgeData extends Record<string, unknown> {
  link: Link;
  tone: EdgeTone;
  viaCollapsed: boolean;
  critical: boolean;
  highlight: boolean;
  dim: boolean;
  count: number;
}

export type LinkEdgeType = Edge<LinkEdgeData, 'link'>;

function boxOf(n: InternalNode<Node>): Box {
  const it = (n.data as { item?: Item }).item;
  const w = n.measured?.width ?? n.width ?? 0;
  const h = n.measured?.height ?? n.height ?? 0;
  let shape: Box['shape'] = 'task';
  if (it?.kind === 'shape') shape = it.shape;
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h, shape };
}

function LinkEdgeImpl({ id, source, target, data, selected }: EdgeProps<LinkEdgeType>) {
  const sn = useInternalNode(source);
  const tn = useInternalNode(target);
  const editing = useStore((s) => s.ui.editingId === id);
  if (!sn || !tn || !data) return null;
  const link = data.link;
  const s = boxOf(sn);
  const t = boxOf(tn);
  if (!s.w || !t.w) return null;

  let routing: 'curved' | 'orthogonal' | 'straight' | 'tree' = link.routing;
  if (link.type === 'subtask' && link.routing === 'orthogonal' && canTreeRoute(s, t)) routing = 'tree';

  type M = 'arrow' | 'open' | 'diamond' | 'circle' | null;
  let startM: M = null;
  let endM: M = null;
  switch (link.type) {
    case 'depends':
      endM = 'arrow';
      break;
    case 'soft':
      endM = 'open';
      break;
    case 'subtask':
      startM = 'diamond';
      endM = routing === 'tree' ? null : null;
      break;
    case 'annotates':
      endM = 'circle';
      break;
    case 'relates':
      break;
    case 'line':
      if (link.arrow === 'end' || link.arrow === 'both') endM = 'arrow';
      if (link.arrow === 'both') startM = 'arrow';
      break;
  }
  const size = link.type === 'subtask' ? 11 : 10;
  const geo = edgePath(s, t, routing, startM ? size - 1 : 0, endM ? size - 1 : 0);

  const cls = [
    'link-edge',
    `type-${link.type}`,
    `tone-${data.tone}`,
    link.color && link.type === 'line' ? `c-${link.color}` : '',
    link.dashed && link.type === 'line' ? 'dashed' : '',
    data.critical ? 'critical' : '',
    data.highlight ? 'highlight' : '',
    data.dim ? 'dim' : '',
    data.viaCollapsed ? 'via-collapsed' : '',
    selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const label = link.label || (data.count > 1 ? `×${data.count}` : '');

  return (
    <>
      <g className={cls}>
        <path d={geo.d} className="edge-hit" />
        <path d={geo.d} className="edge-line" />
        {startM && <path className={`edge-marker m-${startM}`} d={markerPath(startM, geo.start, geo.startDir, size)} />}
        {endM && <path className={`edge-marker m-${endM}`} d={markerPath(endM, geo.end, geo.endDir, size)} />}
      </g>
      {(label || editing) && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label tone-${data.tone} ${selected ? 'selected' : ''} ${data.dim ? 'dim' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${geo.labelX}px, ${geo.labelY}px)` }}
          >
            {editing ? <LabelEditor link={link} /> : label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function LabelEditor({ link }: { link: Link }) {
  const [v, setV] = useState(link.label);
  const update = useStore((s) => s.updateLink);
  const setUI = useStore((s) => s.setUI);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    if (v !== link.label) update(link.id, { label: v.trim() });
    setUI({ editingId: null });
  };
  return (
    <input
      ref={ref}
      className="edge-label-input nodrag nopan"
      value={v}
      placeholder="Label"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setUI({ editingId: null });
      }}
    />
  );
}

export const LinkEdge = memo(LinkEdgeImpl);
