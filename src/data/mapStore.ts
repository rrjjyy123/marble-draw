import type { EntityShape, MapEntity } from '../types/MapEntity.type';
import type { VectorLike } from '../types/VectorLike';
import { stages as builtinStages, type StageDef } from './maps';

const STORAGE_KEY = 'mbr_custom_maps';
const EXPORT_FORMAT = 'marble-draw-maps';
const EXPORT_VERSION = 1;

export const BUILTIN_PREFIX = 'builtin:';
export const DEFAULT_SPAWN: VectorLike = { x: 10.25, y: 0 };

/**
 * 맵 하나가 가질 수 있는 최대치. 물리 엔진은 입력을 검증하지 않으므로,
 * 남이 보낸 파일 하나가 브라우저를 멈추게 하는 것을 여기서 막는다.
 */
const MAX_ENTITIES = 3000;
const MAX_POINTS = 1000;

export function isBuiltin(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX);
}

export function newMapId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function spawnOf(stage: StageDef): VectorLike {
  return stage.spawn ?? DEFAULT_SPAWN;
}

// ---------------------------------------------------------------- 저장소

function readStorage(): StageDef[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return []; // 사생활 보호 모드 등에서 접근이 막힐 수 있다
  }
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 저장해둔 것도 검증한다. 손상된 항목 하나가 앱 전체를 막으면 안 된다
    return parsed.map((entry) => validateMap(entry).map).filter((map): map is StageDef => !!map);
  } catch {
    return [];
  }
}

function writeStorage(maps: StageDef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
  } catch (e) {
    console.error('[maps] 저장에 실패했습니다', e);
    throw new Error('맵을 저장하지 못했습니다. 브라우저 저장 공간이 가득 찼을 수 있습니다.');
  }
}

export function listCustomMaps(): StageDef[] {
  return readStorage();
}

export function listMaps(): StageDef[] {
  return [...builtinStages, ...readStorage()];
}

export function getMap(id: string): StageDef | null {
  return listMaps().find((stage) => stage.id === id) ?? null;
}

export function saveMap(map: StageDef): StageDef {
  const { map: validated, errors } = validateMap(map);
  if (!validated) {
    throw new Error(`맵을 저장할 수 없습니다: ${errors.join(', ')}`);
  }
  if (isBuiltin(validated.id)) {
    throw new Error('기본 맵은 덮어쓸 수 없습니다. 복제한 뒤 편집하세요.');
  }

  const maps = readStorage();
  const index = maps.findIndex((m) => m.id === validated.id);
  if (index >= 0) {
    maps[index] = validated;
  } else {
    maps.push(validated);
  }
  writeStorage(maps);
  return validated;
}

export function deleteMap(id: string): void {
  if (isBuiltin(id)) {
    throw new Error('기본 맵은 삭제할 수 없습니다.');
  }
  writeStorage(readStorage().filter((m) => m.id !== id));
}

/** 기본 맵이든 커스텀 맵이든 복제해서 편집 가능한 새 맵으로 만든다 */
export function duplicateMap(id: string, title?: string): StageDef {
  const source = getMap(id);
  if (!source) throw new Error(`맵을 찾을 수 없습니다: ${id}`);

  const copy = structuredClone(source);
  copy.id = newMapId();
  copy.title = title ?? uniqueTitle(`${source.title} 사본`);
  return saveMap(copy);
}

export function createEmptyMap(title = '새 맵'): StageDef {
  return {
    id: newMapId(),
    title: uniqueTitle(title),
    goalY: 30,
    zoomY: 26,
    spawn: { ...DEFAULT_SPAWN },
    entities: [],
  };
}

function uniqueTitle(base: string): string {
  const taken = new Set(listMaps().map((m) => m.title));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

// ---------------------------------------------------------------- 파일 입출력

export function exportMaps(ids?: string[]): string {
  const all = listMaps();
  const picked = ids ? all.filter((m) => ids.includes(m.id)) : listCustomMaps();
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      maps: picked,
    },
    null,
    2
  );
}

export type ImportResult = {
  added: StageDef[];
  errors: string[];
};

/**
 * 가져온 맵은 언제나 새 id 를 받는다. 남의 파일이 내가 편집 중이던 맵을
 * 같은 id 로 덮어쓰는 사고를 막는다.
 */
export function importMaps(text: string): ImportResult {
  const result: ImportResult = { added: [], errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    result.errors.push('JSON 형식이 아닙니다.');
    return result;
  }

  // 맵 하나만 담긴 파일, 배열, 내보내기 묶음을 모두 받는다
  let rawMaps: unknown[];
  if (Array.isArray(parsed)) {
    rawMaps = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { maps?: unknown }).maps)) {
    rawMaps = (parsed as { maps: unknown[] }).maps;
  } else if (parsed && typeof parsed === 'object') {
    rawMaps = [parsed];
  } else {
    result.errors.push('맵 데이터를 찾을 수 없습니다.');
    return result;
  }

  if (rawMaps.length === 0) {
    result.errors.push('파일에 맵이 들어 있지 않습니다.');
    return result;
  }

  rawMaps.forEach((raw, i) => {
    const { map, errors } = validateMap(raw);
    if (!map) {
      result.errors.push(`${i + 1}번째 맵: ${errors.join(', ')}`);
      return;
    }
    // map 이 있어도 errors 가 비어있지 않을 수 있다. 물체 몇 개만 버리고 살린 경우다
    if (errors.length > 0) {
      result.errors.push(`${i + 1}번째 맵 "${map.title}": 일부를 버리고 가져왔습니다 — ${errors.join(', ')}`);
    }
    map.id = newMapId();
    map.title = uniqueTitle(map.title);
    try {
      result.added.push(saveMap(map));
    } catch (e) {
      result.errors.push(`${i + 1}번째 맵: ${(e as Error).message}`);
    }
  });

  return result;
}

// ---------------------------------------------------------------- 검증

export type ValidateResult = { map?: StageDef; errors: string[] };

function num(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function color(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : undefined;
}

function validateShape(raw: unknown, errors: string[]): EntityShape | null {
  if (!raw || typeof raw !== 'object') {
    errors.push('도형이 없습니다');
    return null;
  }
  const s = raw as Record<string, unknown>;
  const common = { color: color(s.color), bloomColor: color(s.bloomColor) };

  switch (s.type) {
    case 'box':
      if (!num(s.width) || !num(s.height) || s.width <= 0 || s.height <= 0) {
        errors.push('상자 크기가 올바르지 않습니다');
        return null;
      }
      return {
        type: 'box',
        width: s.width,
        height: s.height,
        rotation: num(s.rotation) ? s.rotation : 0,
        ...common,
      };

    case 'circle':
      if (!num(s.radius) || s.radius <= 0) {
        errors.push('원 반지름이 올바르지 않습니다');
        return null;
      }
      return { type: 'circle', radius: s.radius, ...common };

    case 'polyline': {
      if (!Array.isArray(s.points) || s.points.length < 2) {
        errors.push('선은 점이 2개 이상이어야 합니다');
        return null;
      }
      if (s.points.length > MAX_POINTS) {
        errors.push(`선의 점이 너무 많습니다 (최대 ${MAX_POINTS})`);
        return null;
      }
      const points: [number, number][] = [];
      for (const p of s.points) {
        if (!Array.isArray(p) || !num(p[0]) || !num(p[1])) {
          errors.push('선의 좌표가 올바르지 않습니다');
          return null;
        }
        points.push([p[0], p[1]]);
      }
      return { type: 'polyline', points, rotation: num(s.rotation) ? s.rotation : 0, ...common };
    }

    default:
      errors.push(`알 수 없는 도형입니다: ${String(s.type)}`);
      return null;
  }
}

function validateEntity(raw: unknown, errors: string[]): MapEntity | null {
  if (!raw || typeof raw !== 'object') {
    errors.push('물체 형식이 올바르지 않습니다');
    return null;
  }
  const e = raw as Record<string, unknown>;
  const pos = e.position as Record<string, unknown> | undefined;
  if (!pos || !num(pos.x) || !num(pos.y)) {
    errors.push('물체 위치가 올바르지 않습니다');
    return null;
  }

  const shape = validateShape(e.shape, errors);
  if (!shape) return null;

  const props = (e.props ?? {}) as Record<string, unknown>;
  const life = num(props.life) ? props.life : undefined;

  return {
    position: { x: pos.x, y: pos.y },
    type: e.type === 'kinematic' ? 'kinematic' : 'static',
    shape,
    props: {
      density: num(props.density) ? props.density : 1,
      restitution: num(props.restitution) ? props.restitution : 0,
      angularVelocity: num(props.angularVelocity) ? props.angularVelocity : 0,
      ...(life !== undefined ? { life } : {}),
    },
  };
}

/**
 * 손상된 맵이 물리 엔진에 들어가지 않게 막는다.
 * 물체 하나가 잘못됐다고 맵 전체를 버리지는 않고, 그것만 빼고 나머지를 살린다.
 */
export function validateMap(raw: unknown): ValidateResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { errors: ['맵 형식이 올바르지 않습니다'] };
  }
  const m = raw as Record<string, unknown>;

  const title = typeof m.title === 'string' && m.title.trim() ? m.title.trim().slice(0, 60) : '이름 없는 맵';
  const id = typeof m.id === 'string' && m.id ? m.id : newMapId();

  if (!num(m.goalY)) {
    return { errors: ['골인선(goalY)이 없습니다'] };
  }
  const goalY = m.goalY;
  const zoomY = num(m.zoomY) ? m.zoomY : goalY - 4;

  let spawn: VectorLike | undefined;
  const rawSpawn = m.spawn as Record<string, unknown> | undefined;
  if (rawSpawn && num(rawSpawn.x) && num(rawSpawn.y)) {
    spawn = { x: rawSpawn.x, y: rawSpawn.y };
  }

  const entities: MapEntity[] = [];
  if (Array.isArray(m.entities)) {
    if (m.entities.length > MAX_ENTITIES) {
      return { errors: [`물체가 너무 많습니다 (최대 ${MAX_ENTITIES})`] };
    }
    m.entities.forEach((rawEntity, i) => {
      const entityErrors: string[] = [];
      const entity = validateEntity(rawEntity, entityErrors);
      if (entity) {
        entities.push(entity);
      } else {
        errors.push(`물체 ${i + 1}: ${entityErrors.join(', ')}`);
      }
    });
  }

  const start = spawn ?? DEFAULT_SPAWN;
  if (goalY <= start.y) {
    return { errors: ['골인선이 구슬 출발점보다 위에 있습니다'] };
  }

  return {
    map: { id, title, goalY, zoomY, ...(spawn ? { spawn } : {}), entities },
    errors,
  };
}
