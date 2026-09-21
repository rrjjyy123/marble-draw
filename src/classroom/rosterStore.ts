/**
 * 수업용 저장소. 반별 명단, 이미 뽑힌 사람, 추첨 기록을 브라우저에 담아둔다.
 * 어느 것도 바깥으로 나가지 않는다.
 */

export type Roster = {
  id: string;
  name: string;
  /** 이름 입력창의 원문 그대로. `수박*2` 같은 문법을 그대로 보존한다 */
  names: string;
};

export type DrawRecord = {
  /** ISO 문자열 */
  at: string;
  map: string;
  roster: string;
  winners: string[];
};

const ROSTER_KEY = 'mbr_rosters';
const DRAWN_KEY = 'mbr_drawn';
const HISTORY_KEY = 'mbr_history';

const HISTORY_LIMIT = 100;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    // 사생활 보호 모드이거나 값이 깨졌다. 없는 셈 친다
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`[classroom] ${key} 저장 실패`, e);
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------- 명단

export function listRosters(): Roster[] {
  const raw = read<unknown>(ROSTER_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is Roster => !!r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.names === 'string'
  );
}

export function getRoster(id: string): Roster | null {
  return listRosters().find((r) => r.id === id) ?? null;
}

/** 같은 이름이 있으면 덮어쓴다. 같은 반을 두 번 저장하는 게 흔한 일이라 그렇게 둔다 */
export function saveRoster(name: string, names: string, id?: string): Roster {
  const rosters = listRosters();
  const trimmed = name.trim() || '이름 없는 명단';

  const index = id ? rosters.findIndex((r) => r.id === id) : rosters.findIndex((r) => r.name === trimmed);
  const roster: Roster = { id: index >= 0 ? rosters[index].id : newId(), name: trimmed, names };

  if (index >= 0) rosters[index] = roster;
  else rosters.push(roster);

  write(ROSTER_KEY, rosters);
  return roster;
}

export function deleteRoster(id: string): void {
  write(
    ROSTER_KEY,
    listRosters().filter((r) => r.id !== id)
  );
  const drawn = readDrawnMap();
  delete drawn[id];
  write(DRAWN_KEY, drawn);
}

// ---------------------------------------------------------------- 뽑힌 사람

type DrawnMap = Record<string, string[]>;

function readDrawnMap(): DrawnMap {
  const raw = read<unknown>(DRAWN_KEY, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as DrawnMap) : {};
}

/** 명단을 고르지 않고 쓸 수도 있어서, 그때는 이 열쇠에 모아둔다 */
export const UNSAVED_ROSTER = '__current__';

export function getDrawn(rosterId: string): string[] {
  const list = readDrawnMap()[rosterId || UNSAVED_ROSTER];
  return Array.isArray(list) ? list.filter((n) => typeof n === 'string') : [];
}

export function addDrawn(rosterId: string, names: string[]): void {
  const key = rosterId || UNSAVED_ROSTER;
  const drawn = readDrawnMap();
  drawn[key] = Array.from(new Set([...(drawn[key] ?? []), ...names]));
  write(DRAWN_KEY, drawn);
}

export function clearDrawn(rosterId: string): void {
  const drawn = readDrawnMap();
  delete drawn[rosterId || UNSAVED_ROSTER];
  write(DRAWN_KEY, drawn);
}

// ---------------------------------------------------------------- 기록

export function listHistory(): DrawRecord[] {
  const raw = read<unknown>(HISTORY_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is DrawRecord => !!r && typeof r.at === 'string' && Array.isArray(r.winners));
}

export function addHistory(record: DrawRecord): void {
  // 최근 것이 앞에 오게 쌓고, 오래된 것은 버린다
  write(HISTORY_KEY, [record, ...listHistory()].slice(0, HISTORY_LIMIT));
}

export function clearHistory(): void {
  write(HISTORY_KEY, []);
}

export function historyToCsv(records: DrawRecord[]): string {
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [['일시', '명단', '맵', '당첨자'].map(quote).join(',')];
  for (const r of records) {
    rows.push([r.at, r.roster, r.map, r.winners.join(' / ')].map(quote).join(','));
  }
  // 엑셀이 UTF-8 로 열도록 BOM 을 붙인다. 없으면 한글이 깨진다
  return `\uFEFF${rows.join('\r\n')}`;
}
