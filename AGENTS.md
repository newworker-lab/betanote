# βnote 작업 지침

- 기능·저장소 형식·기존 사용자 데이터를 보존한다. 변경 전 현재 브랜치와 사용자 변경을 확인한다.
- 구조·실행·시험·저장 형식과 번역 유지보수 기준은 `docs/DEVELOPMENT.md` 한 문서로 관리한다. 변경 이력은 문서에 쌓지 않고 커밋에 남긴다.
- 번역 프롬프트와 캐시 버전은 `core/translation-policy.cjs`에서 함께 관리한다.
- PDF 수식·첨자 복원은 `core/pdf-text.js`, 구조·좌표·배치는 `core/pdf-layout.js`에서 관리한다. 화면/인쇄에 별도 규칙을 복제하지 않는다.
- `core/`(번역·PDF 처리 핵심)는 Node·Electron·`desktop/`에 기대지 않는다(`tests/core-boundary.test.cjs`). 파일·네트워크·저장은 `desktop/`에 둔다.
- 화면 기반은 `desktop/index.html`·`desktop/app.js`·`desktop/app.css`이고, `scripts/build.mjs`가 이를 데스크톱 스크립트와 합쳐 `dist/`를 만든다. `dist/`는 생성물이므로 직접 수정하지 않는다. 시안 전용 파일은 제품 저장소에 두지 않는다.
- 화면에 보이는 한국어는 `tr()`로 감싸고 같은 커밋에서 `core/i18n-en.js`에 영어를 적는다(복수형·문맥 포함). 저장 값은 한국어로 저장·비교하고 보일 때만 이름을 붙인다. `// i18n:keep`은 옮기지 않는 한국어(저장·비교하는 값, 모델에게 보내는 글, 한국어를 읽는 정규식, 언어 자기 이름, 예시 자료, memo-labels 원문)에만 줄 끝에 단다. 자세한 규칙은 `docs/DEVELOPMENT.md`의 "언어 설정".
- 한국어 AI 지시문은 바이트까지 그대로 두고(`tests/ai-language.test.cjs`), 번역 지시문·`PROMPT_VERSION`·번역 캐시 열쇠는 언어 설정에 기대지 않게 한다.
- 변경에 맞는 기존 회귀를 실행하고 실제 실행 결과와 환경 제약을 구분한다. 모의 모델 통과를 실제 논문 번역 품질로 보고하지 않는다.
- 커밋 작성자는 `abc-engineer <126231346+abc-engineer@users.noreply.github.com>`로 통일한다. 새 환경에서는 커밋 전에 저장소 설정(`git config user.name`, `git config user.email`)을 이 값으로 맞춘다. 커밋 메시지에 공동 작성자(`Co-Authored-By`) 줄과 세션 링크(`Claude-Session`) 줄을 넣지 않는다.
