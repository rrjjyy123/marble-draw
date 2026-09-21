import './localization';
import { EditorPanel } from './editor/editorPanel';
import options from './options';
import { Roulette } from './roulette';

const roulette = new Roulette();

(window as any).roulette = roulette;
(window as any).options = options;

// index.html 의 초기화가 끝난 뒤(= roulette.isReady) 불린다.
// 맵 목록을 만들려면 물리가 올라와 있어야 한다
(window as any).initEditorPanel = () => new EditorPanel(roulette);
