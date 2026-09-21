import { type TranslatedLanguages, type TranslationKeys, Translations } from './data/languages';

// 교실용 포크라 한국어가 기본이다. 번역이 없는 언어의 브라우저도 한국어로 연다
const defaultLocale: TranslatedLanguages = 'ko';
let locale: TranslatedLanguages = defaultLocale;

function getBrowserLocale() {
  return navigator.language.split('-')[0];
}

/**
 * 캔버스처럼 DOM 이 아닌 곳에 쓰는 문구를 번역한다.
 * 번역이 없으면 키를 그대로 돌려주므로 사용자가 지은 이름을 넘겨도 안전하다.
 */
export function translate(key: string): string {
  const table = Translations[locale] as Record<string, string>;
  return key in table ? table[key] : key;
}

function translateElement(element: Element) {
  if (!(element instanceof HTMLElement)) return;

  const prop = element.getAttribute('data-trans');

  if (prop) {
    const key = (element.getAttribute(prop) || '').trim();
    if (key && key in Translations[locale]) {
      element.setAttribute(prop, Translations[locale][key as TranslationKeys]);
    }
  } else {
    const key = element.innerText.trim();
    if (key && key in Translations[locale]) {
      element.innerText = Translations[locale][key as TranslationKeys];
    }
  }
}

function translatePage() {
  document.querySelectorAll('[data-trans]').forEach(translateElement);
}

function setLocale(newLocale: string) {
  const newLocaleLower = newLocale.toLocaleLowerCase();
  locale = newLocaleLower in Translations ? (newLocaleLower as TranslatedLanguages) : defaultLocale;
  document.documentElement.lang = locale;
  translatePage();
}

document.addEventListener('DOMContentLoaded', () => {
  setLocale(getBrowserLocale());
});

(window as any).translateElement = translateElement;
