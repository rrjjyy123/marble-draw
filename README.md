# 구슬 뽑기 (Marble Draw)

구슬을 굴려서 당첨자를 뽑는 교실용 추첨기입니다.

lazygyu 의 [Marble Roulette](https://github.com/lazygyu/roulette) (MIT) 을 포크해서,
수업 중에 쓰기 좋게 다듬었습니다.

## 원본과 다른 점

- **광고와 외부 통신이 전혀 없습니다.** 광고 서버, 접속 통계(Google Analytics · umami),
  외부 이미지 API 호출을 모두 제거했습니다. 첫 로딩 이후 바깥으로 나가는 요청이 없습니다.
- **맵을 직접 만들 수 있습니다.** 화면 위에서 벽·기둥·회전판을 그려 나만의 코스를 만들고,
  저장하거나 JSON 파일로 주고받을 수 있습니다.
- **인터넷 없이 동작합니다.** 한 번 열어두면 오프라인에서도 그대로 씁니다.
- **수업용 명단 관리.** 반별 명단을 여러 개 저장해두고 전환하거나, 뽑힌 사람을 빼고
  순차 추첨할 수 있습니다.
- 기본 UI 언어가 한국어입니다.

## 개발

```shell
corepack yarn
corepack yarn dev
```

## 빌드

```shell
corepack yarn build
```

`dist/` 에 정적 파일과 오프라인용 `service-worker.js` 가 생성됩니다. `main` 에 푸시하면 GitHub Actions 가 GitHub Pages 로
자동 배포합니다.

## 직접 만든 맵 검사

편집기에서 내보낸 JSON 파일을 렌더링 없이 물리만 돌려, 구슬이 실제로 골인하는지
확인할 수 있습니다.

```shell
corepack yarn simulate bench 6,16,30 내-맵.json
```

## 라이선스

소스 코드는 [MIT License](./LICENSE) 를 따릅니다.

원본 프로젝트의 상표 **"마블 룰렛"™ / "Marble Roulette"™** 는 MIT 라이선스 대상이
아닙니다(대한민국 특허청 상표 출원 중). 이 포크는 그 명칭을 사용하지 않고
**"구슬 뽑기 / Marble Draw"** 라는 다른 이름으로 배포합니다.
