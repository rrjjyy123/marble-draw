import {
  createEmptyMap,
  deleteMap,
  duplicateMap,
  exportMaps,
  getMap,
  importMaps,
  isBuiltin,
  listMaps,
  saveMap,
  spawnOf,
} from '../data/mapStore';
import type { StageDef } from '../data/maps';
import type { Roulette } from '../roulette';
import type { MapEntity } from '../types/MapEntity.type';
import type { EditorTool, MapEditor } from './mapEditor';

const TOOL_LABELS: { tool: EditorTool; label: string; hint: string }[] = [
  { tool: 'select', label: '선택', hint: '끌어서 옮기고, 네모 손잡이로 크기를, 동그란 손잡이로 각도를 바꿉니다.' },
  { tool: 'pan', label: '화면 이동', hint: '끌어서 보이는 곳을 옮깁니다. 마우스라면 오른쪽 버튼 드래그로도 됩니다.' },
  { tool: 'wall', label: '벽', hint: '클릭해서 점을 찍고, 더블클릭이나 Enter 로 끝냅니다. Esc 는 취소.' },
  { tool: 'box', label: '상자', hint: '드래그한 만큼의 네모난 발판을 놓습니다.' },
  { tool: 'circle', label: '기둥', hint: '가운데에서 바깥으로 끌어 둥근 기둥을 놓습니다.' },
  { tool: 'spinner', label: '회전판', hint: '끌어서 막대를 놓습니다. 저절로 돌아갑니다.' },
  { tool: 'peg', label: '사라지는 못', hint: '클릭해서 놓습니다. 구슬이 닿으면 사라집니다.' },
  { tool: 'erase', label: '지우개', hint: '클릭한 물체를 지웁니다.' },
];

const COMMON_HINT = '오른쪽 버튼 드래그로 화면 이동, 휠로 확대·축소. Ctrl+Z 되돌리기, Delete 삭제, Ctrl+D 복제.';

function el<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`요소를 찾을 수 없습니다: ${selector}`);
  return found;
}

function shapeLabel(entity: MapEntity): string {
  switch (entity.shape.type) {
    case 'box':
      return entity.type === 'kinematic' ? '회전판' : '상자';
    case 'circle':
      return entity.props.life !== undefined ? '사라지는 못' : '기둥';
    case 'polyline':
      return '벽';
  }
}

/** 소수점 쓰레기값 없이 보여준다 */
function round(v: number, digits = 2): number {
  return Number(v.toFixed(digits));
}

type FieldSpec = {
  label: string;
  get: () => number | string | boolean;
  set: (raw: string | boolean) => void;
  type?: 'number' | 'text' | 'color' | 'checkbox';
  step?: number;
  min?: number;
};

export class EditorPanel {
  private editor: MapEditor | null = null;
  /** 테스트 실행 중이면 돌아갈 초안 */
  private testing: StageDef | null = null;

  private root = el<HTMLDivElement>('#editor');
  private testBar = el<HTMLDivElement>('#editorTestBar');
  private toolbar = el<HTMLDivElement>('#editorTools');
  private props = el<HTMLDivElement>('#editorProps');
  private hint = el<HTMLDivElement>('#editorHint');
  private mapSelect = el<HTMLSelectElement>('#sltMap');
  private fileInput = el<HTMLInputElement>('#mapFileInput');

  constructor(private roulette: Roulette) {
    this.buildToolbar();
    this.bindActions();
    this.refreshMapList();
  }

  // ---------------------------------------------------------------- 맵 목록

  refreshMapList(selectId?: string) {
    const current = selectId ?? this.mapSelect.value;
    this.mapSelect.innerHTML = '';
    for (const map of listMaps()) {
      const option = document.createElement('option');
      option.value = map.id;
      option.textContent = map.title;
      if (isBuiltin(map.id)) {
        // 기본 맵 이름만 번역 대상이다. 사용자가 지은 이름은 건드리지 않는다
        option.setAttribute('data-trans', '');
        (window as unknown as { translateElement?: (e: Element) => void }).translateElement?.(option);
      }
      this.mapSelect.append(option);
    }
    if (current && getMap(current)) {
      this.mapSelect.value = current;
    }
    this.updateMapButtons();
  }

  private updateMapButtons() {
    const builtin = isBuiltin(this.mapSelect.value);
    el<HTMLButtonElement>('#btnDeleteMap').disabled = builtin;
  }

  get selectedMapId(): string {
    return this.mapSelect.value;
  }

  // ---------------------------------------------------------------- 편집 열기/닫기

  /** 기본 맵은 직접 고칠 수 없으므로 먼저 복제한다 */
  open(mapId: string) {
    let target = getMap(mapId);
    if (!target) return;

    if (isBuiltin(target.id)) {
      if (!confirm(`"${target.title}" 은 기본 맵이라 바로 고칠 수 없습니다. 복제해서 편집할까요?`)) return;
      target = duplicateMap(target.id, `${target.title} (내 맵)`);
      this.refreshMapList(target.id);
    }

    this.editor = this.roulette.enterEditMode(structuredClone(target));
    this.editor.onChange = () => this.renderProps();
    this.root.classList.remove('hidden');
    el<HTMLDivElement>('#settings').classList.add('hide');
    this.renderProps();
  }

  openNew() {
    const map = saveMap(createEmptyMap());
    this.refreshMapList(map.id);
    this.open(map.id);
  }

  close() {
    if (!this.editor) return;
    if (this.editor.isDirty && !confirm('저장하지 않은 변경이 있습니다. 그래도 닫을까요?')) return;

    const id = this.editor.draft.id;
    this.editor = null;
    this.testing = null;
    this.roulette.isTestingDraft = false;
    this.roulette.exitEditMode();
    this.root.classList.add('hidden');
    this.testBar.classList.add('hidden');
    el<HTMLDivElement>('#settings').classList.remove('hide');

    // 편집한 맵(또는 저장된 원본)으로 화면을 돌려놓는다
    this.refreshMapList(getMap(id) ? id : undefined);
    this.roulette.setMap(this.mapSelect.value);
    (window as unknown as { getReady?: () => void }).getReady?.();
  }

  private save() {
    if (!this.editor) return;
    try {
      const saved = saveMap(this.editor.draft);
      this.editor.markSaved();
      this.refreshMapList(saved.id);
      this.toast('저장했습니다');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  /** 편집 중인 그대로 굴려본다. 저장하지 않아도 된다 */
  private test() {
    if (!this.editor) return;
    const draft = this.editor.draft;
    this.editor = null;
    this.roulette.exitEditMode(); // _stage 는 draft 그대로라 초안이 물리로 올라간다

    this.root.classList.add('hidden');
    this.testBar.classList.remove('hidden');
    this.testing = draft;
    this.roulette.isTestingDraft = true;

    (window as unknown as { getReady?: () => void }).getReady?.();
    if (this.roulette.getCount() === 0) {
      this.toast('이름이 없어 테스트할 구슬이 없습니다');
      return;
    }
    this.roulette.start();
  }

  private backToEdit() {
    const draft = this.testing;
    if (!draft) return;
    this.testing = null;
    this.roulette.isTestingDraft = false;
    this.testBar.classList.add('hidden');
    this.root.classList.remove('hidden');
    this.editor = this.roulette.enterEditMode(draft);
    this.editor.onChange = () => this.renderProps();
    this.renderProps();
  }

  private toast(msg: string) {
    this.roulette.dispatchEvent(new CustomEvent('message', { detail: msg }));
  }

  // ---------------------------------------------------------------- 도구 모음

  private buildToolbar() {
    this.toolbar.innerHTML = '';
    for (const { tool, label } of TOOL_LABELS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tool = tool;
      button.textContent = label;
      button.addEventListener('click', () => {
        this.editor?.setTool(tool);
        this.renderProps();
      });
      this.toolbar.append(button);
    }
  }

  private bindActions() {
    this.mapSelect.addEventListener('change', () => {
      this.updateMapButtons();
      this.roulette.setMap(this.mapSelect.value);
      // setMap 은 살아남은 구슬에서 이름을 뽑으므로, 원본인 입력창에서 다시 채운다
      (window as unknown as { getReady?: () => void }).getReady?.();
    });

    el('#btnEditMap').addEventListener('click', () => this.open(this.mapSelect.value));
    el('#btnNewMap').addEventListener('click', () => this.openNew());
    el('#btnDuplicateMap').addEventListener('click', () => {
      const copy = duplicateMap(this.mapSelect.value);
      this.refreshMapList(copy.id);
      this.toast(`"${copy.title}" 을(를) 만들었습니다`);
    });
    el('#btnDeleteMap').addEventListener('click', () => {
      const map = getMap(this.mapSelect.value);
      if (!map || !confirm(`"${map.title}" 을(를) 삭제할까요?`)) return;
      deleteMap(map.id);
      this.refreshMapList();
      this.roulette.setMap(this.mapSelect.value);
    });
    el('#btnExportMaps').addEventListener('click', () => this.exportToFile());
    el('#btnImportMaps').addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => this.importFromFile());

    el('#btnEditorSave').addEventListener('click', () => this.save());
    el('#btnEditorTest').addEventListener('click', () => this.test());
    el('#btnEditorClose').addEventListener('click', () => this.close());
    el('#btnEditorUndo').addEventListener('click', () => this.editor?.undo());
    el('#btnEditorRedo').addEventListener('click', () => this.editor?.redo());
    el('#btnEditorFit').addEventListener('click', () => this.editor?.fitToMap());
    el('#btnBackToEdit').addEventListener('click', () => this.backToEdit());
    el<HTMLInputElement>('#chkSnap').addEventListener('change', (e) => {
      this.editor?.setSnap((e.target as HTMLInputElement).checked);
    });
  }

  // ---------------------------------------------------------------- 파일

  private exportToFile() {
    const json = exportMaps();
    if (JSON.parse(json).maps.length === 0) {
      this.toast('내보낼 내 맵이 없습니다');
      return;
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `구슬뽑기-맵-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async importFromFile() {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = ''; // 같은 파일을 다시 골라도 change 가 뜨도록
    if (!file) return;

    const result = importMaps(await file.text());
    this.refreshMapList(result.added[result.added.length - 1]?.id);

    if (result.added.length > 0) {
      this.toast(`맵 ${result.added.length}개를 가져왔습니다`);
    }
    if (result.errors.length > 0) {
      alert(`가져오지 못한 맵이 있습니다:\n${result.errors.join('\n')}`);
    }
  }

  // ---------------------------------------------------------------- 속성 패널

  private renderProps() {
    const editor = this.editor;
    if (!editor) return;

    for (const button of Array.from(this.toolbar.querySelectorAll('button'))) {
      button.classList.toggle('active', button.dataset.tool === editor.tool);
    }
    el<HTMLInputElement>('#chkSnap').checked = editor.snapEnabled;
    el<HTMLButtonElement>('#btnEditorUndo').disabled = !editor.canUndo;
    el<HTMLButtonElement>('#btnEditorRedo').disabled = !editor.canRedo;
    el<HTMLButtonElement>('#btnEditorSave').textContent = editor.isDirty ? '저장 *' : '저장';

    const tool = TOOL_LABELS.find((t) => t.tool === editor.tool);
    this.hint.textContent = `${tool ? tool.hint : ''} ${COMMON_HINT}`;

    this.props.innerHTML = '';
    this.props.append(this.mapSection(editor));

    const selected = editor.selectedEntities();
    if (selected.length === 1) {
      this.props.append(this.entitySection(editor, selected[0]));
    } else if (selected.length > 1) {
      this.props.append(this.multiSection(editor, selected.length));
    }
  }

  private section(title: string): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'editor-section';
    const h = document.createElement('h4');
    h.textContent = title;
    box.append(h);
    return box;
  }

  private field(spec: FieldSpec): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'editor-field';
    const span = document.createElement('span');
    span.textContent = spec.label;

    const input = document.createElement('input');
    input.type = spec.type ?? 'number';
    if (input.type === 'number') {
      input.step = String(spec.step ?? 0.25);
      if (spec.min !== undefined) input.min = String(spec.min);
    }

    const value = spec.get();
    if (input.type === 'checkbox') {
      input.checked = Boolean(value);
    } else {
      input.value = String(value);
    }

    input.addEventListener('change', () => {
      spec.set(input.type === 'checkbox' ? input.checked : input.value);
      this.renderProps();
    });

    label.append(span, input);
    return label;
  }

  private mapSection(editor: MapEditor): HTMLDivElement {
    const box = this.section('맵');
    const draft = editor.draft;

    box.append(
      this.field({
        label: '이름',
        type: 'text',
        get: () => draft.title,
        set: (v) => editor.patchMap({ title: String(v).trim() || '이름 없는 맵' }),
      }),
      this.field({
        label: '골인선 (아래로 내려가면 골인)',
        get: () => round(draft.goalY),
        set: (v) => editor.patchMap({ goalY: Number(v) }),
      }),
      this.field({
        label: '줌 시작선',
        get: () => round(draft.zoomY),
        set: (v) => editor.patchMap({ zoomY: Number(v) }),
      }),
      this.field({
        label: '출발점 X',
        get: () => round(spawnOf(draft).x),
        set: (v) => editor.patchMap({ spawn: { ...spawnOf(draft), x: Number(v) } }),
      }),
      this.field({
        label: '출발점 Y',
        get: () => round(spawnOf(draft).y),
        set: (v) => editor.patchMap({ spawn: { ...spawnOf(draft), y: Number(v) } }),
      })
    );

    const count = document.createElement('p');
    count.className = 'editor-note';
    count.textContent = `물체 ${editor.entities.length}개`;
    box.append(count);
    return box;
  }

  private entitySection(editor: MapEditor, entity: MapEntity): HTMLDivElement {
    const box = this.section(`선택: ${shapeLabel(entity)}`);
    const shape = entity.shape;

    box.append(
      this.field({
        label: '위치 X',
        get: () => round(entity.position.x),
        set: (v) => editor.patchSelected((e) => (e.position = { ...e.position, x: Number(v) })),
      }),
      this.field({
        label: '위치 Y',
        get: () => round(entity.position.y),
        set: (v) => editor.patchSelected((e) => (e.position = { ...e.position, y: Number(v) })),
      })
    );

    if (shape.type === 'box') {
      // 내부 값은 반지름(half-extent)이다. 사람이 읽는 값은 전체 길이라 2배로 주고받는다
      box.append(
        this.field({
          label: '가로',
          min: 0.1,
          get: () => round(shape.width * 2),
          set: (v) =>
            editor.patchSelected((e) => {
              if (e.shape.type === 'box') e.shape.width = Math.max(0.05, Number(v) / 2);
            }),
        }),
        this.field({
          label: '세로',
          min: 0.1,
          get: () => round(shape.height * 2),
          set: (v) =>
            editor.patchSelected((e) => {
              if (e.shape.type === 'box') e.shape.height = Math.max(0.05, Number(v) / 2);
            }),
        }),
        this.field({
          label: '기울기 (도)',
          step: 5,
          get: () => round((shape.rotation * 180) / Math.PI, 1),
          set: (v) =>
            editor.patchSelected((e) => {
              if (e.shape.type === 'box') e.shape.rotation = (Number(v) * Math.PI) / 180;
            }),
        })
      );
    }

    if (shape.type === 'circle') {
      box.append(
        this.field({
          label: '반지름',
          min: 0.05,
          step: 0.05,
          get: () => round(shape.radius),
          set: (v) =>
            editor.patchSelected((e) => {
              if (e.shape.type === 'circle') e.shape.radius = Math.max(0.05, Number(v));
            }),
        })
      );
    }

    if (shape.type === 'polyline') {
      const note = document.createElement('p');
      note.className = 'editor-note';
      note.textContent = `점 ${shape.points.length}개 — 캔버스의 동그란 손잡이를 끌어 모양을 고칩니다`;
      box.append(note);
    }

    box.append(
      this.field({
        label: '스스로 회전 (초당 라디안)',
        step: 0.5,
        get: () => round(entity.props.angularVelocity),
        set: (v) =>
          editor.patchSelected((e) => {
            e.props.angularVelocity = Number(v);
            // 도는 물체는 kinematic 이어야 한다. static 은 아무리 속도를 줘도 멈춰 있다
            e.type = Number(v) === 0 ? 'static' : 'kinematic';
          }),
      }),
      this.field({
        label: '탄성 (튕기는 정도)',
        step: 0.1,
        min: 0,
        get: () => round(entity.props.restitution),
        set: (v) => editor.patchSelected((e) => (e.props.restitution = Math.max(0, Number(v)))),
      }),
      this.field({
        label: '구슬이 닿으면 사라짐',
        type: 'checkbox',
        get: () => entity.props.life !== undefined,
        set: (v) =>
          editor.patchSelected((e) => {
            if (v) e.props.life = 1;
            else delete e.props.life;
          }),
      }),
      this.field({
        label: '색',
        type: 'color',
        get: () => shape.color ?? '#66ccff',
        set: (v) => editor.patchSelected((e) => (e.shape.color = String(v))),
      })
    );

    const resetColor = document.createElement('button');
    resetColor.type = 'button';
    resetColor.className = 'editor-inline-btn';
    resetColor.textContent = '색 기본값으로';
    resetColor.addEventListener('click', () => {
      editor.patchSelected((e) => {
        e.shape.color = undefined;
        e.shape.bloomColor = undefined;
      });
    });
    box.append(resetColor, this.entityActions(editor));
    return box;
  }

  private multiSection(editor: MapEditor, count: number): HTMLDivElement {
    const box = this.section(`${count}개 선택됨`);
    const note = document.createElement('p');
    note.className = 'editor-note';
    note.textContent = '끌어서 함께 옮길 수 있습니다. 세부 값은 하나만 선택했을 때 보입니다.';
    box.append(note, this.entityActions(editor));
    return box;
  }

  private entityActions(editor: MapEditor): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'editor-actions-row';

    const dup = document.createElement('button');
    dup.type = 'button';
    dup.textContent = '복제';
    dup.addEventListener('click', () => editor.duplicateSelected());

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = '삭제';
    del.addEventListener('click', () => editor.deleteSelected());

    row.append(dup, del);
    return row;
  }
}
