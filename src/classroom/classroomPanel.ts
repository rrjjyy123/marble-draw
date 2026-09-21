import type { Roulette } from '../roulette';
import { parseName } from '../utils/utils';
import {
  addDrawn,
  addHistory,
  clearDrawn,
  clearHistory,
  type DrawRecord,
  deleteRoster,
  getDrawn,
  getRoster,
  historyToCsv,
  listHistory,
  listRosters,
  saveRoster,
} from './rosterStore';

const SEQUENTIAL_KEY = 'mbr_sequential';
const LAST_ROSTER_KEY = 'mbr_last_roster';

function el<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`요소를 찾을 수 없습니다: ${selector}`);
  return found;
}

function readString(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function readFlag(key: string): boolean {
  return readString(key) === '1';
}

function writeFlag(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장이 막혀 있어도 이번 수업 동안은 동작해야 한다
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 수업 중 쓰는 명단 관리.
 *
 * 이름 입력창 자체는 index.html 이 계속 들고 있다. 여기서는 그 원문을 명단으로
 * 저장·전환하고, 이미 뽑힌 사람을 빼고, 결과를 기록한다.
 */
export class ClassroomPanel {
  private namesInput = el<HTMLTextAreaElement>('#in_names');
  private rosterSelect = el<HTMLSelectElement>('#sltRoster');
  private sequentialCheck = el<HTMLInputElement>('#chkSequential');
  private drawnStatus = el<HTMLSpanElement>('#drawnStatus');
  private historyDialog = el<HTMLDialogElement>('#historyDialog');
  private historyBody = el<HTMLDivElement>('#historyBody');

  constructor(private roulette: Roulette) {
    this.sequentialCheck.checked = readFlag(SEQUENTIAL_KEY);
    this.refreshRosters(readString(LAST_ROSTER_KEY));
    this.bind();
    this.updateStatus();
  }

  private get rosterId(): string {
    return this.rosterSelect.value;
  }

  private get sequential(): boolean {
    return this.sequentialCheck.checked;
  }

  /**
   * index.html 의 getNames() 가 거쳐 간다.
   * 순차 추첨이 켜져 있으면 이미 뽑힌 사람을 빼고 돌려준다.
   */
  filterNames(names: string[]): string[] {
    if (!this.sequential) return names;
    const drawn = new Set(getDrawn(this.rosterId));
    if (drawn.size === 0) return names;
    return names.filter((raw) => {
      const parsed = parseName(raw);
      return !parsed || !drawn.has(parsed.name);
    });
  }

  /** 한 판이 끝날 때 Roulette 의 goal 이벤트에서 불린다 */
  recordResult(winners: string[]) {
    if (winners.length === 0) return;

    const roster = getRoster(this.rosterId);
    const record: DrawRecord = {
      at: new Date().toISOString(),
      map: this.roulette.getCurrentMap()?.title ?? '',
      roster: roster?.name ?? '',
      winners,
    };
    addHistory(record);

    if (this.sequential) {
      addDrawn(this.rosterId, winners);
    }
    this.updateStatus();
  }

  // ---------------------------------------------------------------- 명단 목록

  private refreshRosters(selectId?: string) {
    const current = selectId ?? this.rosterSelect.value;
    this.rosterSelect.innerHTML = '';

    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(저장 안 함)';
    this.rosterSelect.append(none);

    for (const roster of listRosters()) {
      const option = document.createElement('option');
      option.value = roster.id;
      option.textContent = roster.name;
      this.rosterSelect.append(option);
    }
    this.rosterSelect.value = getRoster(current) ? current : '';
    writeFlag(LAST_ROSTER_KEY, this.rosterSelect.value);
    el<HTMLButtonElement>('#btnDeleteRoster').disabled = !this.rosterSelect.value;
  }

  private bind() {
    this.rosterSelect.addEventListener('change', () => {
      const roster = getRoster(this.rosterId);
      if (roster) {
        this.namesInput.value = roster.names;
        (window as unknown as { getReady?: () => void }).getReady?.();
      }
      writeFlag(LAST_ROSTER_KEY, this.rosterId);
      el<HTMLButtonElement>('#btnDeleteRoster').disabled = !this.rosterId;
      this.updateStatus();
    });

    el('#btnSaveRoster').addEventListener('click', () => {
      const currentName = getRoster(this.rosterId)?.name ?? '';
      const name = prompt('명단 이름 (예: 3학년 2반)', currentName);
      if (name === null) return;
      const saved = saveRoster(name, this.namesInput.value, this.rosterId || undefined);
      this.refreshRosters(saved.id);
      this.toast(`"${saved.name}" 명단을 저장했습니다`);
    });

    el('#btnDeleteRoster').addEventListener('click', () => {
      const roster = getRoster(this.rosterId);
      if (!roster || !confirm(`"${roster.name}" 명단을 삭제할까요?`)) return;
      deleteRoster(roster.id);
      this.refreshRosters('');
      this.updateStatus();
    });

    this.sequentialCheck.addEventListener('change', () => {
      writeFlag(SEQUENTIAL_KEY, this.sequential ? '1' : '0');
      this.updateStatus();
      (window as unknown as { getReady?: () => void }).getReady?.();
    });

    el('#btnResetDrawn').addEventListener('click', () => {
      clearDrawn(this.rosterId);
      this.updateStatus();
      (window as unknown as { getReady?: () => void }).getReady?.();
      this.toast('뽑힌 사람을 초기화했습니다');
    });

    el('#btnHistory').addEventListener('click', () => this.openHistory());
    el('#btnHistoryClose').addEventListener('click', () => this.historyDialog.close());
    el('#btnHistoryClear').addEventListener('click', () => {
      if (!confirm('추첨 기록을 모두 지울까요?')) return;
      clearHistory();
      this.renderHistory();
    });
    el('#btnHistoryCsv').addEventListener('click', () => this.downloadCsv());
  }

  private updateStatus() {
    if (!this.sequential) {
      this.drawnStatus.textContent = '';
      return;
    }
    const drawn = getDrawn(this.rosterId);
    const total = new Set(
      this.namesInput.value
        .split(/[,\r\n]/g)
        .map((raw) => parseName(raw.trim())?.name)
        .filter((n): n is string => !!n)
    );
    // 명단에서 지운 사람이 뽑힌 목록에 남아 있을 수 있다. 지금 명단 기준으로 센다
    const drawnHere = drawn.filter((n) => total.has(n)).length;
    this.drawnStatus.textContent = `${drawnHere}명 뽑힘 · ${total.size - drawnHere}명 남음`;
  }

  // ---------------------------------------------------------------- 기록

  private openHistory() {
    this.renderHistory();
    this.historyDialog.showModal();
  }

  private renderHistory() {
    const records = listHistory();
    this.historyBody.innerHTML = '';

    if (records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '아직 기록이 없습니다.';
      this.historyBody.append(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'history-table';
    table.innerHTML = '<thead><tr><th>일시</th><th>명단 / 맵</th><th>당첨자</th></tr></thead>';

    const tbody = document.createElement('tbody');
    for (const record of records) {
      const tr = document.createElement('tr');
      const when = document.createElement('td');
      when.textContent = formatTime(record.at);
      const where = document.createElement('td');
      where.textContent = [record.roster, record.map].filter(Boolean).join(' / ');
      const who = document.createElement('td');
      who.textContent = record.winners.join(', ');
      tr.append(when, where, who);
      tbody.append(tr);
    }
    table.append(tbody);
    this.historyBody.append(table);
  }

  private downloadCsv() {
    const records = listHistory();
    if (records.length === 0) {
      this.toast('내보낼 기록이 없습니다');
      return;
    }
    const url = URL.createObjectURL(new Blob([historyToCsv(records)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `추첨기록-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private toast(msg: string) {
    this.roulette.dispatchEvent(new CustomEvent('message', { detail: msg }));
  }

  /** 이름 입력이 바뀔 때마다 index.html 이 불러준다 */
  onNamesChanged() {
    this.updateStatus();
  }
}
