import type { ColorTheme } from '../types/ColorTheme';

export const initialZoom = 30;
export const canvasWidth = 1600;
export const canvasHeight = 900;
export const zoomThreshold = 5;
export const STUCK_DELAY = 5000;
export const winnerAreaHeight = 168;

export enum Skills {
  None,
  Impact,
}

export const DefaultEntityColor = {
  box: 'cyan',
  circle: 'yellow',
  polyline: 'white',
} as const;

export const DefaultBloomColor = {
  box: 'cyan',
  circle: 'yellow',
  polyline: 'cyan',
};

export const Themes: Record<string, ColorTheme> = {
  light: {
    background: '#eee',
    marbleLightness: 50,
    marbleWinningBorder: 'black',
    skillColor: '#69c',
    coolTimeIndicator: '#999',
    entity: {
      box: {
        fill: '#226f92',
        outline: 'black',
        bloom: 'cyan',
        bloomRadius: 0,
      },
      circle: {
        fill: 'yellow',
        outline: '#ed7e11',
        bloom: 'yellow',
        bloomRadius: 0,
      },
      polyline: {
        fill: 'white',
        outline: 'black',
        bloom: 'cyan',
        bloomRadius: 0,
      },
    },
    rankStroke: 'black',
    minimapBackground: '#fefefe',
    minimapViewport: '#6699cc',

    winnerBackground: 'rgba(255, 255, 255, 0.5)',
    winnerOutline: 'black',
    winnerText: '#cccccc',
  },
  // ?theme=pastel 로 열었을 때 (Circle AI 안에 띄울 때). 크림 바탕에 채도를 낮춘 파스텔, 번짐 효과는 없다
  pastel: {
    background: '#FBF7F1',
    marbleLightness: 72,
    marbleSaturation: 70,
    marbleWinningBorder: '#2B2633',
    skillColor: '#A48CFF',
    coolTimeIndicator: '#9A93A3',
    entity: {
      box: {
        fill: '#CFC3FA',
        outline: '#8C75F0',
        bloom: '#CFC3FA',
        bloomRadius: 0,
      },
      circle: {
        fill: '#FFE39A',
        outline: '#E0A43A',
        bloom: '#FFE39A',
        bloomRadius: 0,
      },
      polyline: {
        fill: '#FFFFFF',
        outline: '#B9AFA3',
        bloom: '#FFFFFF',
        bloomRadius: 0,
      },
    },
    rankStroke: '#2B2633',
    minimapBackground: '#FFFDF9',
    minimapViewport: '#B04B27',
    winnerBackground: 'rgba(255, 253, 249, 0.75)',
    winnerOutline: '#2B2633',
    winnerText: '#5A5363',
  },
  dark: {
    background: 'black',
    marbleLightness: 75,
    marbleWinningBorder: 'white',
    skillColor: 'white',
    coolTimeIndicator: 'red',
    entity: {
      box: {
        fill: 'cyan',
        outline: 'cyan',
        bloom: 'cyan',
        bloomRadius: 15,
      },
      circle: {
        fill: 'yellow',
        outline: 'yellow',
        bloom: 'yellow',
        bloomRadius: 15,
      },
      polyline: {
        fill: 'white',
        outline: 'white',
        bloom: 'cyan',
        bloomRadius: 15,
      },
    },
    rankStroke: '',
    minimapBackground: '#333333',
    minimapViewport: 'white',
    winnerBackground: 'rgba(0, 0, 0, 0.5)',
    winnerOutline: 'black',
    winnerText: 'white',
  },
};
