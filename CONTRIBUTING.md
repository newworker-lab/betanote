# 기여 안내

βnote에 관심을 가져 주셔서 감사합니다.

## 지금 받는 기여

- **이슈(버그 신고, 기능 제안, 사용 후기)는 환영합니다.** 재현 순서, 운영체제, 앱 버전(설정의 정보 또는 `BUILD-INFO.json`)을 적어 주세요.
- **코드 기여(Pull Request)는 당분간 받지 않습니다.** 코드의 권리 관계를 단순하게 유지하기 위해서입니다. 보내 주신 PR은 검토 없이 닫힐 수 있습니다.

## 라이선스와 기여자 동의(CLA)

- βnote는 [AGPL-3.0-only](LICENSE)로 공개합니다.
- 나중에 코드 기여를 받게 되면 [기여자 동의(CLA)](CLA.md)에 동의하신 기여만 받습니다. 저작권은 기여하신 분에게 그대로 있고, 저작권자가 그 코드를 βnote의 다른 배포(상업 라이선스, 앱 장터에 올리는 판 등)에도 쓸 수 있게 하는 동의입니다. 지금은 초안이며 아직 적용하지 않습니다.

## 올리지 말아 주세요

- 저작권이 있는 논문 PDF나 그 페이지를 찍은 이미지. 재현에는 직접 만든 PDF나 공개 라이선스 자료를 쓰세요.
- 다른 제품·서비스의 화면, 코드, 내부 동작을 분석한 자료.
- API 키, 토큰, 개인 정보가 담긴 로그나 설정 파일.

## 보안 문제

보안 취약점은 공개 이슈로 올리지 말고, GitHub의 **Security → Report a vulnerability**(비공개 신고)로 알려 주세요.

## 개발 환경

필요한 것: Node.js 24 이상.

```bash
npm ci
```

```bash
npm run dev
```

`npm run dev`는 빌드 없이 앱을 실행하고, 화면 파일을 저장하면 다시 불러옵니다. Windows PowerShell에서 `npm`이 막히면 `npm.cmd`를 쓰세요.

## 테스트

단위 테스트:

```bash
npm test
```

Electron 앱을 띄우는 스모크 테스트는 소스에서 실행할 때 `APP_TEST_SOURCE=1`이 필요합니다. 예:

```bash
APP_TEST_SOURCE=1 npm run test:ink
```

Windows PowerShell:

```powershell
$env:APP_TEST_SOURCE='1'; npm.cmd run test:ink
```

다른 스모크 테스트: `test:desktop`, `test:library`, `test:notebook`, `test:ai`, `test:local`, `test:api`, `test:shortcuts`, `test:review`, `test:sync`, `test:pdf-layout`, `test:layout-quality`.

## 코드 구성 원칙

[AGENTS.md](AGENTS.md)에 정리돼 있습니다. 요약하면 다음과 같습니다.

- 기능, 저장소 형식, 기존 사용자 데이터를 보존합니다.
- 번역 프롬프트와 캐시 버전은 `core/translation-policy.cjs`에서 함께 관리합니다.
- PDF 수식·첨자 복원은 `core/pdf-text.js`, 구조·좌표·배치는 `core/pdf-layout.js`에서 관리합니다.
- `dist/`는 빌드 결과물이므로 직접 고치지 않습니다.

## 의존성을 바꿀 때

운영 의존성을 추가·변경하면 서드파티 고지를 다시 만듭니다. 배포 워크플로가 고지가 최신인지 확인합니다.

```bash
npm run notices
```

GPL·AGPL처럼 βnote 전체에 조건을 거는 라이선스의 패키지는 제품 코드에 넣지 않습니다.
