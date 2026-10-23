# 정적 분석 경고 검토

2026-10-23 최초 CodeQL `security-extended` 실행에서 6개 경고가 보고되어 데이터 흐름과 사용 위치를 검토했습니다. 경고를 일괄 억제하지 않으며 아래 근거와 회귀 검증을 남깁니다.

| CodeQL 규칙 | 판단과 조치 |
|---|---|
| `js/remote-property-injection` | 저장 입력의 쿨다운 그룹명이 일반 객체의 키로 쓰였습니다. `Map`으로 변경해 프로토타입 속성과 분리하고 `__proto__`, `constructor`, `toString` 입력을 회귀 검사합니다. |
| `js/incomplete-multi-character-sanitization` (2건) | 툴팁의 태그 제거는 숫자·텍스트 추출용이며 HTML 안전화 함수가 아닙니다. 결과는 JSON·CLI 텍스트·`textContent`에만 쓰이고 HTML 실행 위치에 삽입하지 않습니다. 현재 경로에서 HTML injection으로 판단하지 않으며, 향후 HTML 출력에 재사용하면 안 됩니다. 화면 테스트도 입력·경고를 `innerHTML`로 출력하지 않는지 확인합니다. |
| `js/missing-origin-check` | 대상은 `window`의 메시지 리스너가 아니라 앱이 직접 생성한 dedicated Web Worker입니다. Worker 객체를 소유한 생성자만 메시지를 전달하며 일반 cross-window `postMessage` 수신 경로가 없습니다. Worker에는 창 메시지의 origin 검사를 그대로 적용하지 않습니다. |
| `js/file-access-to-http` | 로컬 `.env`의 키를 고정된 공식 Open API의 Authorization 헤더로 보내는 의도된 인증 경로입니다. 목적지 호스트는 입력으로 바꿀 수 없고 리다이렉트를 거부합니다. 응답이나 로그에 키를 출력하지 않습니다. |
| `js/http-to-file-access` | 사용자가 요청한 공개 API JSON을 고정 endpoint 파일명으로 저장하는 CLI입니다. 캐릭터명에 경로 문자를 허용하지 않으며 응답 본문은 경로·코드로 사용하지 않습니다. `data/raw/`는 Git과 개발 서버 제공에서 제외합니다. |

이 판단은 현재 소스의 경로에 한정합니다. 외부 iframe 메시지 수신, HTML 렌더링, 임의 URL 조회, 응답 기반 파일명이 추가되면 해당 경고를 다시 평가해야 합니다.
