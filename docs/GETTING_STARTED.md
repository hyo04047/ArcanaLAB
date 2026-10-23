# 시작 안내

## 요구 환경

- Node.js 24 LTS, npm, Git
- Windows·Linux에서 실행 가능한 TypeScript 프로젝트입니다. 검증 결과는 [검증 기록](VALIDATION.md)을 확인합니다.
- 별도 데이터베이스나 유료 서비스는 필요하지 않습니다.

```sh
git clone https://github.com/hyo04047/ArcanaLAB.git
cd ArcanaLAB
npm ci
npm run dev
```

터미널에 표시된 `http://127.0.0.1:...` 주소를 엽니다. 프리셋을 선택하고 짧은 시간·적은 반복 수로 먼저 실행합니다. 화면은 기본적으로 180초·500회를 사용하며, 30초 안에 계산이 끝나지 않으면 Worker를 종료합니다.

## 캐릭터 검색

1. [공식 Open API](https://developer-lostark.game.onstove.com/)에서 본인 키를 발급합니다.
2. `.env.example`을 `.env`로 복사하고 `LOSTARK_API_KEY`를 채웁니다.
3. 개발 서버를 다시 시작한 뒤 캐릭터를 검색합니다.

키는 로컬 개발 서버에서만 사용합니다. `VITE_` 접두사를 붙이거나 브라우저 코드에 넣지 않습니다. 이 서버를 인터넷·공유 네트워크에 노출하지 않습니다. 캐릭터 조회는 정해진 Open API의 읽기 경로만 허용합니다.

`npm run build`의 정적 산출물에는 API 프록시가 없습니다. 정적 화면의 프리셋·파일 비교는 사용할 수 있지만 캐릭터 검색에는 별도로 설계한 백엔드가 필요합니다. GitHub 공개는 웹 서비스 운영을 의미하지 않습니다.

## 두 세팅 비교

1. 기준 입력을 불러오고 **입력 JSON 저장**으로 보관합니다.
2. 시간·반복 수·seed·난수 방식을 정하고 실행한 뒤 **결과 JSON 저장**을 선택합니다.
3. 변경한 전체 입력도 같은 조건과 **판정별 난수 (세팅 비교)**로 실행합니다.
4. **저장한 두 입력·결과 비교**에서 결과 파일 두 개를 읽습니다.

같은 계열·모델·조건일 때 회차별 수치 비교가 가능합니다. 원시 특성값을 직접 고쳤다고 관련 효과가 자동 재계산되는 것은 아니며, 실제 장착 가능 여부는 따로 확인해야 합니다.

## CLI

화면에서 저장한 파일을 CLI에서도 그대로 사용할 수 있습니다. 출력은 입력과 다른 파일에 저장합니다.

```sh
npx --no-install vite-node scripts/compare_builds.ts before.json after.json
npx --no-install vite-node scripts/simulate_build.ts before.json 180 500 42 partitioned-v1 > before-result.json
npx --no-install vite-node scripts/simulate_build.ts after.json 180 500 42 partitioned-v1 > after-result.json
npx --no-install vite-node scripts/compare_results.ts before-result.json after-result.json
npx --no-install vite-node scripts/replay_result.ts before-result.json > replayed.json
```

입력 파일 없이 엔진을 시험하려면 `npx --no-install vite-node scripts/run_sim.ts 30 10 1`을 사용합니다. 이 프리셋에도 미확인 수치가 있습니다.

재실행은 현재 엔진의 결과와 저장 결과를 비교합니다. 안내 문구만 바뀐 경우와 계산값이 달라진 경우를 구분해 기록하며, 전체 불일치는 종료 코드 1입니다.
