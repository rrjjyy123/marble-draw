import { initialZoom } from '../data/constants';
import type { VectorLike } from '../types/VectorLike';

/**
 * 화면 좌표와 월드 좌표를 오간다.
 *
 * Camera.renderScene 의 변환을 풀면
 *   screen = initialZoom * zoom * (world - camera) + size / 2
 * 가 된다. 미니맵 드래그나 맵 편집처럼 포인터 위치를 월드로 되돌려야 하는 곳에서 쓴다.
 */
export type Viewport = {
  /** 카메라가 보고 있는 월드 좌표 (화면 한가운데) */
  camera: VectorLike;
  /** Camera.zoom (initialZoom 이 곱해지기 전의 배율) */
  zoom: number;
  /** 장면 캔버스 크기 */
  size: VectorLike;
};

/** 월드 1칸이 화면에서 차지하는 픽셀 수 */
export function pixelsPerUnit(vp: Viewport): number {
  return initialZoom * vp.zoom;
}

export function worldToScreen(world: VectorLike, vp: Viewport): VectorLike {
  const scale = pixelsPerUnit(vp);
  return {
    x: (world.x - vp.camera.x) * scale + vp.size.x / 2,
    y: (world.y - vp.camera.y) * scale + vp.size.y / 2,
  };
}

export function screenToWorld(screen: VectorLike, vp: Viewport): VectorLike {
  const scale = pixelsPerUnit(vp);
  return {
    x: (screen.x - vp.size.x / 2) / scale + vp.camera.x,
    y: (screen.y - vp.size.y / 2) / scale + vp.camera.y,
  };
}
