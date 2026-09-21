import type { Camera } from '../camera';
import { spawnOf } from '../data/mapStore';
import type { StageDef } from '../data/maps';
import type { RenderParameters } from '../rouletteRenderer';
import type { MapEntity, MapEntityState } from '../types/MapEntity.type';
import type { Rect } from '../types/rect.type';
import type { VectorLike } from '../types/VectorLike';
import type { MouseEventArgs, UIObject } from '../UIObject';
import { bound } from '../utils/bound.decorator';
import { pixelsPerUnit, screenToWorld, type Viewport, worldToScreen } from '../utils/viewport';
import {
  applyHandleDrag,
  entityBounds,
  entityHandles,
  type Handle,
  type HandleId,
  hitTest,
  moveEntity,
} from './entityGeometry';

export type EditorTool = 'select' | 'pan' | 'wall' | 'box' | 'circle' | 'spinner' | 'peg' | 'erase';
export type GuideId = 'goal' | 'zoom' | 'spawn';

/** 손잡이·가이드를 집을 수 있는 범위(화면 픽셀). 손가락으로도 집히도록 넉넉하게 둔다 */
const GRAB_PX = 12;
const HANDLE_PX = 9;
const SNAP_STEP = 0.25;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 12;
const UNDO_LIMIT = 60;

const COLOR_SELECT = '#ffd400';
const COLOR_HANDLE = '#ffffff';
const COLOR_GOAL = '#4ade80';
const COLOR_ZOOM = '#fb923c';
const COLOR_SPAWN = '#60a5fa';
const COLOR_GRID = 'rgba(255, 255, 255, 0.10)';
const COLOR_GRID_MAJOR = 'rgba(255, 255, 255, 0.22)';

type DragState =
  | { kind: 'none' }
  | { kind: 'pan'; lastScreen: VectorLike }
  | { kind: 'move'; lastWorld: VectorLike; moved: boolean }
  | { kind: 'handle'; index: number; handle: HandleId }
  | { kind: 'marquee'; from: VectorLike; to: VectorLike }
  | { kind: 'create'; from: VectorLike; to: VectorLike }
  | { kind: 'guide'; guide: GuideId };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * 캔버스 위 맵 편집기.
 *
 * 물체 목록은 편집 중인 StageDef 를 직접 고친다. 물리 엔진은 편집 중에 돌지 않으므로
 * 화면에 그려지는 물체도 물리가 아니라 이 초안에서 나온다(`entityStates`).
 * 덕분에 드래그마다 물리 월드를 다시 만들 필요가 없고, 회전판도 멈춰 있어 다루기 쉽다.
 */
export class MapEditor implements UIObject {
  /** Roulette 이 매 프레임 갱신한다. 휠 이벤트만 스케일이 안 맞아서 필요하다 */
  sizeFactor = 1;

  onChange?: () => void;
  /** 편집 중 알려줄 말. Roulette 이 토스트로 띄운다 */
  notify?: (msg: string) => void;

  private _draft: StageDef;
  private _tool: EditorTool = 'select';
  private _snap = true;
  private _selection: number[] = [];
  private _drag: DragState = { kind: 'none' };
  /** 벽(폴리라인)을 찍는 중이면 지금까지 찍은 월드 좌표들 */
  private _wallPoints: VectorLike[] | null = null;
  private _pointer: VectorLike | null = null;
  private _hover: number | null = null;

  private _undo: string[] = [];
  private _redo: string[] = [];
  private _savedSnapshot: string;

  private _viewport: Viewport;

  /**
   * sceneSize 는 장면 캔버스 크기다. 첫 render 전에 fitToMap/focusOnStart 를 부를 수
   * 있는데, 그때 크기를 모르면 엉뚱한 배율로 열린다
   */
  constructor(
    draft: StageDef,
    private camera: Camera,
    sceneSize: VectorLike
  ) {
    this._draft = draft;
    if (!this._draft.entities) this._draft.entities = [];
    this._savedSnapshot = this.snapshot();
    this._viewport = {
      camera: { x: camera.x, y: camera.y },
      zoom: camera.zoom,
      size: { x: Math.max(1, sceneSize.x), y: Math.max(1, sceneSize.y) },
    };
  }

  // ---------------------------------------------------------------- 상태

  get draft(): StageDef {
    return this._draft;
  }

  get tool(): EditorTool {
    return this._tool;
  }

  setTool(tool: EditorTool) {
    this.cancelPending();
    this._tool = tool;
    if (tool !== 'select') this._selection = [];
    this.changed();
  }

  get snapEnabled(): boolean {
    return this._snap;
  }

  setSnap(value: boolean) {
    this._snap = value;
    this.changed();
  }

  get selection(): number[] {
    return [...this._selection];
  }

  get entities(): MapEntity[] {
    return this._draft.entities ?? [];
  }

  selectedEntities(): MapEntity[] {
    return this._selection.map((i) => this.entities[i]).filter(Boolean);
  }

  get canUndo() {
    return this._undo.length > 0;
  }

  get canRedo() {
    return this._redo.length > 0;
  }

  get isDirty() {
    return this.snapshot() !== this._savedSnapshot;
  }

  markSaved() {
    this._savedSnapshot = this.snapshot();
    this.changed();
  }

  /** 편집 중인 맵을 물리 없이 그리기 위한 상태. 회전판도 각도 0 으로 멈춰 있다 */
  entityStates(): MapEntityState[] {
    return this.entities.map((e) => ({
      x: e.position.x,
      y: e.position.y,
      angle: 0,
      shape: e.shape,
      life: e.props.life ?? -1,
    }));
  }

  // ---------------------------------------------------------------- 실행취소

  private snapshot(): string {
    return JSON.stringify({
      entities: this._draft.entities,
      goalY: this._draft.goalY,
      zoomY: this._draft.zoomY,
      spawn: this._draft.spawn,
      title: this._draft.title,
    });
  }

  /** 바꾸기 직전에 부른다. 되돌릴 지점을 하나 쌓는다 */
  private pushUndo() {
    this._undo.push(this.snapshot());
    if (this._undo.length > UNDO_LIMIT) this._undo.shift();
    this._redo = [];
  }

  private restore(json: string) {
    const parsed = JSON.parse(json);
    this._draft.entities = parsed.entities ?? [];
    this._draft.goalY = parsed.goalY;
    this._draft.zoomY = parsed.zoomY;
    this._draft.spawn = parsed.spawn;
    this._draft.title = parsed.title;
    this._selection = [];
    this.changed();
  }

  undo() {
    const prev = this._undo.pop();
    if (prev === undefined) return;
    this._redo.push(this.snapshot());
    this.restore(prev);
  }

  redo() {
    const next = this._redo.pop();
    if (next === undefined) return;
    this._undo.push(this.snapshot());
    this.restore(next);
  }

  private changed() {
    this.onChange?.();
  }

  // ---------------------------------------------------------------- 편집 명령

  deleteSelected() {
    if (this._selection.length === 0) return;
    this.pushUndo();
    const doomed = new Set(this._selection);
    this._draft.entities = this.entities.filter((_, i) => !doomed.has(i));
    this._selection = [];
    this.changed();
  }

  duplicateSelected() {
    const picked = this.selectedEntities();
    if (picked.length === 0) return;
    this.pushUndo();
    const start = this.entities.length;
    for (const entity of picked) {
      const copy = structuredClone(entity);
      // 겹쳐두면 복제된 줄 모른다. 한 칸 비껴놓는다
      copy.position = { x: copy.position.x + 1, y: copy.position.y + 1 };
      this.entities.push(copy);
    }
    this._selection = picked.map((_, i) => start + i);
    this.changed();
  }

  selectAll() {
    this._selection = this.entities.map((_, i) => i);
    this.changed();
  }

  /** 맵 자체의 속성(제목, 골인선, 출발점 등)을 바꾼다 */
  patchMap(patch: Partial<Pick<StageDef, 'title' | 'goalY' | 'zoomY' | 'spawn'>>) {
    this.pushUndo();
    Object.assign(this._draft, patch);
    this.changed();
  }

  /** 선택한 물체들에 같은 변경을 적용한다 */
  patchSelected(apply: (entity: MapEntity) => void) {
    const picked = this.selectedEntities();
    if (picked.length === 0) return;
    this.pushUndo();
    picked.forEach(apply);
    this.changed();
  }

  // ---------------------------------------------------------------- 좌표

  private snap(v: number): number {
    return this._snap ? Math.round(v / SNAP_STEP) * SNAP_STEP : v;
  }

  private snapPoint(p: VectorLike): VectorLike {
    return { x: this.snap(p.x), y: this.snap(p.y) };
  }

  /** 화면 픽셀 길이를 월드 길이로 */
  private toWorldLength(px: number): number {
    return px / pixelsPerUnit(this._viewport);
  }

  private world(e: MouseEventArgs): VectorLike {
    return screenToWorld({ x: e.x, y: e.y }, this._viewport);
  }

  // ---------------------------------------------------------------- 카메라

  private applyCamera(center: VectorLike, zoom: number) {
    this.camera.initializePosition(center, clamp(zoom, MIN_ZOOM, MAX_ZOOM));
  }

  zoomBy(factor: number, anchorScreen?: VectorLike) {
    const vp = this._viewport;
    const nextZoom = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (!anchorScreen) {
      this.applyCamera(vp.camera, nextZoom);
      return;
    }
    // 커서 밑의 월드 좌표가 그대로 커서 밑에 남도록 카메라를 민다
    const before = screenToWorld(anchorScreen, vp);
    const after = screenToWorld(anchorScreen, { ...vp, zoom: nextZoom });
    this.applyCamera({ x: vp.camera.x + (before.x - after.x), y: vp.camera.y + (before.y - after.y) }, nextZoom);
  }

  /**
   * 출발점 ~ 골인선 구간이 다 보이도록 맞춘다.
   *
   * 물체의 실제 범위를 그대로 쓰면 안 된다. 기본 맵의 바깥벽은 y = -300 까지
   * 뻗어 있어서, 그걸 포함하면 정작 구슬이 지나는 구간이 점처럼 작아진다.
   * 세로는 경기 구간으로 고정하고, 가로만 그 구간에 걸친 물체에서 구한다.
   */
  fitToMap() {
    const spawn = spawnOf(this._draft);
    const minY = Math.min(spawn.y, this._draft.goalY) - 3;
    const maxY = Math.max(spawn.y, this._draft.goalY) + 3;

    let minX = spawn.x - 6;
    let maxX = spawn.x + 6;
    for (const entity of this.entities) {
      const b = entityBounds(entity);
      if (b.y > maxY || b.y + b.h < minY) continue; // 경기 구간 밖의 물체는 구도에서 뺀다
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.w);
    }

    this.frame({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, maxX - minX, maxY - minY);
  }

  /**
   * 구슬이 떨어지는 곳부터 아래로 한 화면을 비춘다. 편집을 열 때의 기본 구도.
   * 짧은 맵이면 골인선까지 다 들어오고, 긴 맵이면 위쪽부터 보여준다
   */
  focusOnStart() {
    const spawn = spawnOf(this._draft);
    const top = spawn.y - 3;
    const bottom = Math.min(this._draft.goalY + 3, spawn.y + 34);
    this.frame({ x: spawn.x, y: (top + bottom) / 2 }, 22, bottom - top);
  }

  /** 주어진 월드 크기가 화면에 들어오도록 카메라를 맞춘다 */
  private frame(center: VectorLike, worldWidth: number, worldHeight: number) {
    const { size } = this._viewport;
    const zoom = Math.min(size.x / (Math.max(1, worldWidth) * 30), size.y / (Math.max(1, worldHeight) * 30));
    this.applyCamera(center, zoom * 0.95);
  }

  // ---------------------------------------------------------------- 마우스

  @bound
  onMouseDown(e?: MouseEventArgs) {
    if (!e) return;
    this._pointer = { x: e.x, y: e.y };

    // 가운데·오른쪽 버튼은 어느 도구에서든 화면 이동.
    // 손가락 조작에는 오른쪽 버튼이 없으므로 '이동' 도구도 따로 둔다
    if (e.button === 1 || e.button === 2 || this._tool === 'pan') {
      this._drag = { kind: 'pan', lastScreen: { x: e.x, y: e.y } };
      return;
    }
    if (e.button !== 0) return;

    const world = this.world(e);

    if (this._tool === 'wall') {
      this.addWallPoint(world);
      return;
    }
    if (this._tool === 'peg') {
      this.createPeg(world);
      return;
    }
    if (this._tool === 'erase') {
      this.eraseAt(world);
      return;
    }
    if (this._tool !== 'select') {
      this._drag = { kind: 'create', from: this.snapPoint(world), to: this.snapPoint(world) };
      return;
    }

    // --- 선택 도구 ---
    const guide = this.guideAt(world);
    if (guide) {
      this.pushUndo();
      this._drag = { kind: 'guide', guide };
      return;
    }

    const handle = this.handleAt(world);
    if (handle) {
      this.pushUndo();
      this._drag = { kind: 'handle', index: handle.index, handle: handle.id };
      return;
    }

    const index = this.entityAt(world);
    if (index === null) {
      this._selection = [];
      this._drag = { kind: 'marquee', from: world, to: world };
      this.changed();
      return;
    }

    if (!this._selection.includes(index)) {
      this._selection = [index];
      this.changed();
    }
    this.pushUndo();
    this._drag = { kind: 'move', lastWorld: world, moved: false };
  }

  @bound
  onMouseMove(e?: MouseEventArgs) {
    if (!e) {
      this._pointer = null;
      return;
    }
    this._pointer = { x: e.x, y: e.y };
    const world = this.world(e);

    switch (this._drag.kind) {
      case 'pan': {
        const scale = pixelsPerUnit(this._viewport);
        const dx = (e.x - this._drag.lastScreen.x) / scale;
        const dy = (e.y - this._drag.lastScreen.y) / scale;
        this._drag.lastScreen = { x: e.x, y: e.y };
        this.applyCamera({ x: this._viewport.camera.x - dx, y: this._viewport.camera.y - dy }, this._viewport.zoom);
        return;
      }
      case 'move': {
        const delta = { x: world.x - this._drag.lastWorld.x, y: world.y - this._drag.lastWorld.y };
        this._drag.lastWorld = world;
        this._drag.moved = true;
        for (const entity of this.selectedEntities()) {
          moveEntity(entity, delta);
          entity.position = this.snapPoint(entity.position);
        }
        this.changed();
        return;
      }
      case 'handle': {
        const entity = this.entities[this._drag.index];
        if (entity) {
          applyHandleDrag(entity, this._drag.handle, world, (v) => this.snap(v));
          this.changed();
        }
        return;
      }
      case 'marquee':
        this._drag.to = world;
        return;
      case 'create':
        this._drag.to = this.snapPoint(world);
        return;
      case 'guide':
        this.dragGuide(this._drag.guide, world);
        return;
      default:
        this._hover = this._tool === 'select' || this._tool === 'erase' ? this.entityAt(world) : null;
    }
  }

  @bound
  onMouseUp(_e?: MouseEventArgs) {
    const drag = this._drag;
    this._drag = { kind: 'none' };

    if (drag.kind === 'marquee') {
      this.selectInside(drag.from, drag.to);
    } else if (drag.kind === 'create') {
      this.finishCreate(drag.from, drag.to);
    }
    this.changed();
  }

  @bound
  onDblClick(_e?: MouseEventArgs) {
    if (this._tool === 'wall') this.finishWall();
  }

  @bound
  onWheel(e: WheelEvent) {
    e.preventDefault();
    const anchor = { x: e.offsetX * this.sizeFactor, y: e.offsetY * this.sizeFactor };
    this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, anchor);
  }

  @bound
  onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    // 속성 패널에 숫자를 치는 중이라면 단축키가 가로채면 안 된다
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.duplicateSelected();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.selectAll();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSelected();
      return;
    }
    if (e.key === 'Escape') {
      this.cancelPending();
      this._selection = [];
      this.changed();
      return;
    }
    if (e.key === 'Enter' && this._tool === 'wall') {
      this.finishWall();
    }
  }

  // ---------------------------------------------------------------- 집기

  private entityAt(world: VectorLike): number | null {
    const tol = this.toWorldLength(GRAB_PX);
    // 위에 그려진(나중에 추가된) 것부터 집는다
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (hitTest(this.entities[i], world, tol)) return i;
    }
    return null;
  }

  private handleAt(world: VectorLike): { index: number; id: HandleId } | null {
    const tol = this.toWorldLength(GRAB_PX);
    for (const index of this._selection) {
      const entity = this.entities[index];
      if (!entity) continue;
      for (const handle of entityHandles(entity)) {
        if (Math.hypot(handle.pos.x - world.x, handle.pos.y - world.y) <= tol) {
          return { index, id: handle.id };
        }
      }
    }
    return null;
  }

  private guideAt(world: VectorLike): GuideId | null {
    const tol = this.toWorldLength(GRAB_PX);
    const spawn = spawnOf(this._draft);
    if (Math.hypot(world.x - spawn.x, world.y - spawn.y) <= tol) return 'spawn';
    if (Math.abs(world.y - this._draft.goalY) <= tol) return 'goal';
    if (Math.abs(world.y - this._draft.zoomY) <= tol) return 'zoom';
    return null;
  }

  private dragGuide(guide: GuideId, world: VectorLike) {
    if (guide === 'spawn') {
      this._draft.spawn = this.snapPoint(world);
    } else if (guide === 'goal') {
      this._draft.goalY = this.snap(world.y);
    } else {
      this._draft.zoomY = this.snap(world.y);
    }
    this.changed();
  }

  private selectInside(a: VectorLike, b: VectorLike) {
    const rect: Rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
    if (rect.w < 0.1 && rect.h < 0.1) return;

    this._selection = [];
    this.entities.forEach((entity, i) => {
      const bounds = entityBounds(entity);
      const overlaps =
        bounds.x < rect.x + rect.w &&
        bounds.x + bounds.w > rect.x &&
        bounds.y < rect.y + rect.h &&
        bounds.y + bounds.h > rect.y;
      if (overlaps) this._selection.push(i);
    });
  }

  // ---------------------------------------------------------------- 만들기

  private add(entity: MapEntity, select = true) {
    this.pushUndo();
    this.entities.push(entity);
    if (select) {
      this._tool = 'select';
      this._selection = [this.entities.length - 1];
    }
    this.changed();
  }

  private createPeg(world: VectorLike) {
    const p = this.snapPoint(world);
    this.add(
      {
        position: p,
        type: 'static',
        shape: { type: 'circle', radius: 0.2, color: '#e6e1ae' },
        props: { density: 1, angularVelocity: 0, restitution: 1.5, life: 1 },
      },
      false
    );
  }

  private eraseAt(world: VectorLike) {
    const index = this.entityAt(world);
    if (index === null) return;
    this.pushUndo();
    this.entities.splice(index, 1);
    this._selection = [];
    this.changed();
  }

  private finishCreate(from: VectorLike, to: VectorLike) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    if (this._tool === 'box') {
      const halfW = Math.max(0.1, Math.abs(dx) / 2);
      const halfH = Math.max(0.05, Math.abs(dy) / 2);
      this.add({
        position: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        type: 'static',
        shape: { type: 'box', width: halfW, height: halfH, rotation: 0 },
        props: { density: 1, angularVelocity: 0, restitution: 0 },
      });
      return;
    }

    if (this._tool === 'circle') {
      const radius = Math.max(0.1, Math.hypot(dx, dy));
      this.add({
        position: from,
        type: 'static',
        shape: { type: 'circle', radius },
        props: { density: 1, angularVelocity: 0, restitution: 0 },
      });
      return;
    }

    if (this._tool === 'spinner') {
      const length = Math.max(0.5, Math.hypot(dx, dy));
      this.add({
        position: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        type: 'kinematic',
        shape: { type: 'box', width: length / 2, height: 0.05, rotation: Math.atan2(dy, dx) },
        props: { density: 1, angularVelocity: 3, restitution: 0 },
      });
    }
  }

  private addWallPoint(world: VectorLike) {
    const p = this.snapPoint(world);
    if (!this._wallPoints) this._wallPoints = [];
    this._wallPoints.push(p);
  }

  private finishWall() {
    // 더블클릭으로 끝내면 그 두 번의 클릭이 같은 자리에 점을 더 찍는다. 겹친 점은 버린다
    const points = this._wallPoints?.filter(
      (p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-6
    );
    this._wallPoints = null;
    if (!points || points.length < 2) {
      if (points) this.notify?.('점을 2개 이상 찍어야 벽이 됩니다');
      this.changed();
      return;
    }
    // 첫 점을 기준으로 삼으면 나중에 통째로 옮기기 쉽다
    const origin = points[0];
    this.add({
      position: { ...origin },
      type: 'static',
      shape: {
        type: 'polyline',
        rotation: 0,
        points: points.map((p) => [p.x - origin.x, p.y - origin.y] as [number, number]),
      },
      props: { density: 1, angularVelocity: 0, restitution: 0 },
    });
  }

  cancelPending() {
    if (this._wallPoints) {
      this._wallPoints = null;
      this.changed();
    }
    this._drag = { kind: 'none' };
  }

  // ---------------------------------------------------------------- 그리기

  update(_deltaTime: number): void {}

  getBoundingBox(): Rect | null {
    return null; // 캔버스 전체에서 포인터를 받는다
  }

  render(ctx: CanvasRenderingContext2D, params: RenderParameters, width: number, height: number): void {
    this._viewport = {
      camera: { x: params.camera.x, y: params.camera.y },
      zoom: params.camera.zoom,
      size: { x: width, y: height },
    };

    ctx.save();
    this.drawGrid(ctx);
    this.drawGuides(ctx);
    this.drawHover(ctx);
    this.drawSelection(ctx);
    this.drawPending(ctx);
    ctx.restore();
  }

  private toScreen(world: VectorLike): VectorLike {
    return worldToScreen(world, this._viewport);
  }

  private drawGrid(ctx: CanvasRenderingContext2D) {
    const vp = this._viewport;
    const scale = pixelsPerUnit(vp);
    // 칸이 너무 촘촘해지면 격자가 화면을 덮어버린다. 배율에 따라 간격을 키운다
    const step = scale < 8 ? 10 : scale < 20 ? 5 : 1;

    const topLeft = screenToWorld({ x: 0, y: 0 }, vp);
    const bottomRight = screenToWorld({ x: vp.size.x, y: vp.size.y }, vp);

    ctx.save();
    ctx.lineWidth = 1;
    for (let x = Math.floor(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
      ctx.strokeStyle = x % (step * 5) === 0 ? COLOR_GRID_MAJOR : COLOR_GRID;
      const sx = this.toScreen({ x, y: 0 }).x;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, vp.size.y);
      ctx.stroke();
    }
    for (let y = Math.floor(topLeft.y / step) * step; y <= bottomRight.y; y += step) {
      ctx.strokeStyle = y % (step * 5) === 0 ? COLOR_GRID_MAJOR : COLOR_GRID;
      const sy = this.toScreen({ x: 0, y }).y;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(vp.size.x, sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHLine(ctx: CanvasRenderingContext2D, y: number, color: string, label: string) {
    const sy = this.toScreen({ x: 0, y }).y;
    if (sy < -40 || sy > this._viewport.size.y + 40) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(this._viewport.size.x, sy);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, 8, sy - 4);
    ctx.restore();
  }

  private drawGuides(ctx: CanvasRenderingContext2D) {
    this.drawHLine(ctx, this._draft.goalY, COLOR_GOAL, `골인선 ${this._draft.goalY}`);
    this.drawHLine(ctx, this._draft.zoomY, COLOR_ZOOM, `줌 시작 ${this._draft.zoomY}`);

    const spawn = spawnOf(this._draft);
    const s = this.toScreen(spawn);
    ctx.save();
    ctx.strokeStyle = COLOR_SPAWN;
    ctx.fillStyle = 'rgba(96, 165, 250, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLOR_SPAWN;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('출발', s.x, s.y + 16);
    ctx.restore();
  }

  private strokeBounds(ctx: CanvasRenderingContext2D, entity: MapEntity, color: string, dash: number[]) {
    const b = entityBounds(entity);
    const tl = this.toScreen({ x: b.x, y: b.y });
    const br = this.toScreen({ x: b.x + b.w, y: b.y + b.h });
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(dash);
    ctx.strokeRect(tl.x - 3, tl.y - 3, br.x - tl.x + 6, br.y - tl.y + 6);
    ctx.restore();
  }

  private drawHover(ctx: CanvasRenderingContext2D) {
    if (this._hover === null || this._selection.includes(this._hover)) return;
    const entity = this.entities[this._hover];
    if (entity) this.strokeBounds(ctx, entity, 'rgba(255, 255, 255, 0.5)', [4, 4]);
  }

  private drawHandle(ctx: CanvasRenderingContext2D, handle: Handle) {
    const s = this.toScreen(handle.pos);
    ctx.save();
    ctx.fillStyle = handle.kind === 'rotate' ? COLOR_SELECT : COLOR_HANDLE;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    if (handle.kind === 'point' || handle.kind === 'rotate') {
      ctx.beginPath();
      ctx.arc(s.x, s.y, HANDLE_PX / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(s.x - HANDLE_PX / 2, s.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
      ctx.strokeRect(s.x - HANDLE_PX / 2, s.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
    }
    ctx.restore();
  }

  private drawSelection(ctx: CanvasRenderingContext2D) {
    const single = this._selection.length === 1;
    for (const index of this._selection) {
      const entity = this.entities[index];
      if (!entity) continue;
      this.strokeBounds(ctx, entity, COLOR_SELECT, []);
      // 손잡이가 여러 개 겹치면 뭘 집는지 알 수 없다. 하나만 골랐을 때만 보여준다
      if (single) {
        for (const handle of entityHandles(entity)) this.drawHandle(ctx, handle);
      }
    }
  }

  private drawPending(ctx: CanvasRenderingContext2D) {
    const drag = this._drag;

    if (drag.kind === 'marquee' || drag.kind === 'create') {
      const a = this.toScreen(drag.from);
      const b = this.toScreen(drag.to);
      ctx.save();
      ctx.strokeStyle = drag.kind === 'marquee' ? 'rgba(255, 255, 255, 0.8)' : COLOR_SELECT;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      if (this._tool === 'circle' && drag.kind === 'create') {
        ctx.beginPath();
        ctx.arc(a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y), 0, Math.PI * 2);
        ctx.stroke();
      } else if (this._tool === 'spinner' && drag.kind === 'create') {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else {
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      }
      ctx.restore();
    }

    if (this._wallPoints?.length) {
      const pts = this._wallPoints.map((p) => this.toScreen(p));
      ctx.save();
      ctx.strokeStyle = COLOR_SELECT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      if (this._pointer) ctx.lineTo(this._pointer.x, this._pointer.y);
      ctx.stroke();

      ctx.fillStyle = COLOR_HANDLE;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}
