import type { MapEntity } from '../types/MapEntity.type';
import type { Rect } from '../types/rect.type';
import type { VectorLike } from '../types/VectorLike';

/**
 * box 의 width/height 는 반지름이다(half-extent).
 * Box2D 의 SetAsBox 와 렌더러의 `shape.width * 2` 가 그 근거다.
 * 편집 UI 는 전체 크기를 보여주므로 경계에서 두 번 변환하지 않도록 주의할 것.
 */

export type HandleId = 'nw' | 'ne' | 'sw' | 'se' | 'rot' | 'radius' | `p${number}`;

export type Handle = {
  id: HandleId;
  /** 월드 좌표 */
  pos: VectorLike;
  kind: 'resize' | 'rotate' | 'point';
};

function rotate(v: VectorLike, angle: number): VectorLike {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** 물체 중심 기준, 회전을 되돌린 좌표 */
export function toLocal(entity: MapEntity, world: VectorLike): VectorLike {
  const d = { x: world.x - entity.position.x, y: world.y - entity.position.y };
  const angle = entity.shape.type === 'box' ? entity.shape.rotation : 0;
  return rotate(d, -angle);
}

function toWorld(entity: MapEntity, local: VectorLike): VectorLike {
  const angle = entity.shape.type === 'box' ? entity.shape.rotation : 0;
  const r = rotate(local, angle);
  return { x: entity.position.x + r.x, y: entity.position.y + r.y };
}

function distToSegment(p: VectorLike, a: VectorLike, b: VectorLike): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** tolerance 는 월드 단위. 얇은 선도 집을 수 있도록 화면 픽셀에서 환산해 넘긴다 */
export function hitTest(entity: MapEntity, world: VectorLike, tolerance: number): boolean {
  const shape = entity.shape;
  switch (shape.type) {
    case 'box': {
      const local = toLocal(entity, world);
      return Math.abs(local.x) <= shape.width + tolerance && Math.abs(local.y) <= shape.height + tolerance;
    }
    case 'circle': {
      const d = Math.hypot(world.x - entity.position.x, world.y - entity.position.y);
      return d <= shape.radius + tolerance;
    }
    case 'polyline': {
      for (let i = 0; i < shape.points.length - 1; i++) {
        const a = { x: entity.position.x + shape.points[i][0], y: entity.position.y + shape.points[i][1] };
        const b = { x: entity.position.x + shape.points[i + 1][0], y: entity.position.y + shape.points[i + 1][1] };
        if (distToSegment(world, a, b) <= tolerance) return true;
      }
      return false;
    }
  }
}

/** 회전을 포함한 월드 AABB. 선택 표시와 러버밴드 선택에 쓴다 */
export function entityBounds(entity: MapEntity): Rect {
  const shape = entity.shape;
  const pts: VectorLike[] = [];

  switch (shape.type) {
    case 'box':
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        pts.push(toWorld(entity, { x: sx * shape.width, y: sy * shape.height }));
      }
      break;
    case 'circle':
      pts.push(
        { x: entity.position.x - shape.radius, y: entity.position.y - shape.radius },
        { x: entity.position.x + shape.radius, y: entity.position.y + shape.radius }
      );
      break;
    case 'polyline':
      for (const [px, py] of shape.points) {
        pts.push({ x: entity.position.x + px, y: entity.position.y + py });
      }
      break;
  }

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/** 회전 손잡이를 도형에서 얼마나 띄울지 (월드 단위) */
const ROTATE_OFFSET = 1.2;

export function entityHandles(entity: MapEntity): Handle[] {
  const shape = entity.shape;
  switch (shape.type) {
    case 'box':
      return [
        { id: 'nw', pos: toWorld(entity, { x: -shape.width, y: -shape.height }), kind: 'resize' },
        { id: 'ne', pos: toWorld(entity, { x: shape.width, y: -shape.height }), kind: 'resize' },
        { id: 'sw', pos: toWorld(entity, { x: -shape.width, y: shape.height }), kind: 'resize' },
        { id: 'se', pos: toWorld(entity, { x: shape.width, y: shape.height }), kind: 'resize' },
        { id: 'rot', pos: toWorld(entity, { x: 0, y: -shape.height - ROTATE_OFFSET }), kind: 'rotate' },
      ];
    case 'circle':
      return [{ id: 'radius', pos: { x: entity.position.x + shape.radius, y: entity.position.y }, kind: 'resize' }];
    case 'polyline':
      return shape.points.map((p, i) => ({
        id: `p${i}` as HandleId,
        pos: { x: entity.position.x + p[0], y: entity.position.y + p[1] },
        kind: 'point' as const,
      }));
  }
}

const MIN_SIZE = 0.05;

/**
 * 손잡이를 끈 결과를 물체에 반영한다.
 * 상자는 중심을 고정한 채 대칭으로 커진다. 중심이 곧 물리 바디의 위치라
 * 한쪽 모서리를 고정하면 편집 중에 바디가 미끄러져 보인다.
 */
export function applyHandleDrag(entity: MapEntity, handle: HandleId, world: VectorLike, snap: (v: number) => number) {
  const shape = entity.shape;

  if (handle === 'rot' && shape.type === 'box') {
    const dx = world.x - entity.position.x;
    const dy = world.y - entity.position.y;
    shape.rotation = Math.atan2(dy, dx) + Math.PI / 2;
    return;
  }

  if (handle === 'radius' && shape.type === 'circle') {
    const d = Math.hypot(world.x - entity.position.x, world.y - entity.position.y);
    shape.radius = Math.max(MIN_SIZE, snap(d));
    return;
  }

  if (shape.type === 'box') {
    const local = toLocal(entity, world);
    shape.width = Math.max(MIN_SIZE, snap(Math.abs(local.x)));
    shape.height = Math.max(MIN_SIZE, snap(Math.abs(local.y)));
    return;
  }

  if (shape.type === 'polyline' && handle.startsWith('p')) {
    const i = Number(handle.slice(1));
    if (Number.isInteger(i) && shape.points[i]) {
      shape.points[i] = [snap(world.x - entity.position.x), snap(world.y - entity.position.y)];
    }
  }
}

export function moveEntity(entity: MapEntity, delta: VectorLike) {
  entity.position = { x: entity.position.x + delta.x, y: entity.position.y + delta.y };
}
