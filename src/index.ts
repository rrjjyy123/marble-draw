import './localization';
import { ClassroomPanel } from './classroom/classroomPanel';
import { EditorPanel } from './editor/editorPanel';
import options from './options';
import { Roulette } from './roulette';

const roulette = new Roulette();

(window as any).roulette = roulette;
(window as any).options = options;

// index.html 의 초기화가 끝난 뒤(= roulette.isReady) 불린다.
// 맵 목록을 만들려면 물리가 올라와 있어야 한다
(window as any).initEditorPanel = () => new EditorPanel(roulette);
(window as any).initClassroom = () => {
  (window as any).classroom = new ClassroomPanel(roulette);
};

// 오프라인에서도 쓸 수 있게 빌드 산출물을 캐시한다(scripts/build-sw.js).
// 개발 서버에서는 캐시가 수정 사항을 가려버리므로 등록하지 않는다
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // 워커는 빌드가 끝난 뒤 따로 생성된다. 문자열 리터럴로 넘기면 Parcel 이 번들하려 들어
    // 빌드가 실패하므로 페이지 기준 URL 을 계산해서 넘긴다
    const workerUrl = new URL('service-worker.js', document.baseURI).href;
    navigator.serviceWorker.register(workerUrl).catch((e) => {
      console.warn('[offline] 서비스 워커 등록 실패. 온라인에서는 그대로 쓸 수 있습니다', e);
    });
  });
}
