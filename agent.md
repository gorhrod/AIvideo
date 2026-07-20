# agent.md — KWJMvideoAI 작업 가이드

이 문서는 이 저장소를 수정하는 **모든 AI 코딩 어시스턴트(Claude Code, Cursor, Copilot 등)**를 위한 가이드입니다.
사람이 아니라 다음에 이 프로젝트를 작업할 AI를 대상으로 씁니다.

> ⚠️ **필수 규칙**: 이 프로젝트에 의미 있는 변경을 했다면, 작업을 마치기 전에
> 이 파일(`agent.md`)의 관련 섹션과 하단 "변경 이력"을 함께 업데이트하세요.
> agent.md가 실제 코드와 어긋나면 다음 세션의 AI가 잘못된 전제로 작업하게 됩니다.
> 사용자가 "다음에도 agent.md를 계속 업데이트해줘"라고 요청했으므로, 이는 선택이 아니라 규칙입니다.

---

## 1. 프로젝트 개요

**KWJMvideoAI**는 블로그 텍스트나 아이디어를 입력하면 영상 스토리보드(장면별 나레이션·대사·이미지·재생시간)를
자동으로 구성해주는 웹 앱입니다. Next.js 14 (App Router) + TypeScript + Tailwind CSS로 작성되었고,
전역 상태는 zustand 하나로 관리합니다.

가장 중요한 설계 원칙: **로컬스토리지(localStorage)나 별도 백엔드 서버를 전혀 쓰지 않고, 사용자가
브라우저에서 직접 지정한 로컬 폴더에 실제 파일로 데이터를 저장합니다.** 이는 부가 기능이 아니라
이 앱의 핵심 아키텍처입니다. 이후 어떤 기능을 추가하더라도 이 원칙을 깨지 마세요
(즉, `localStorage`, `sessionStorage`, `document.cookie`, IndexedDB에 실제 콘텐츠 데이터를 넣지 않습니다).

## 2. 기술 스택 & 실행

```bash
yarn install   # 또는 npm install
yarn dev       # 개발 서버
yarn build     # 프로덕션 빌드
yarn start     # build && start
```

- Next.js 14 (App Router), React 18, TypeScript(strict)
- Tailwind CSS 3 (`darkMode: 'class'`)
- zustand 5 (전역 상태, `store/useStore.ts` 하나)
- framer-motion (애니메이션), lucide-react (아이콘)
- **새 의존성을 추가할 때 주의**: 이 프로젝트를 만든 개발 환경은 npm 레지스트리에 접근할 수 없는 샌드박스였습니다.
  따라서 브라우저 내장 API(File System Access API, Blob, `window.print()`)만으로 기능을 구현했습니다.
  새 라이브러리(PDF 생성기 등)를 추가하려면 실제로 `yarn install` 후 `yarn build`가 되는지 꼭 확인하세요.

## 3. 파일 구조

```
app/layout.tsx, app/page.tsx, app/globals.css   Next.js 엔트리
components/AppRoot.tsx    전체 UI. 하나의 파일에 모든 화면/모달 컴포넌트가 들어있음 (2,300줄+)
store/useStore.ts         zustand 전역 상태 — 씬, 채팅, 수정이력, 저장/미디어 폴더 연결, 저장 로직
lib/fsAccess.ts           File System Access API 래퍼 (폴더/파일 읽기·쓰기, 권한 확인, 미디어 스캔)
lib/utils.ts              cn() 클래스 병합, 이미지 자리표시자, 날짜 포맷
```

`components/AppRoot.tsx`가 매우 크므로, 새 화면/모달을 추가할 때는 같은 파일에 함수 컴포넌트를
추가하는 기존 패턴을 따르거나, 파일이 더 커지면 이 시점에 `components/` 하위로 분리하는 리팩터링을
고려하세요 (아직 분리하지 않은 이유는 기존 코드 구조를 그대로 유지해 diff를 최소화하기 위함입니다).

## 4. 저장 시스템 아키텍처 (핵심)

### 4.1 왜 이렇게 설계했는가

사용자가 "로컬스토리지나 백엔드 없이, 채팅·기록·이미지/텍스트 수정 내용이 지정한 폴더 안에 파일로
계속 남아있어야 한다"고 명시적으로 요청했습니다. 그래서:

- 브라우저의 **File System Access API** (`window.showDirectoryPicker`)로 사용자가 실제 폴더를 선택하면,
  그 폴더 핸들을 세션(탭) 동안 메모리에 들고 있다가 실제 파일 읽기/쓰기에 사용합니다.
- 폴더 핸들 자체를 IndexedDB 등 브라우저 저장소에 남겨두지 않습니다. 새로고침하면 연결이 끊기고,
  사용자가 같은 폴더를 다시 연결하면 그 폴더 안의 파일을 읽어 이전 세션 내용을 그대로 복원합니다.
  → 즉 "데이터가 계속 남아있는 것"은 실제 파일 덕분이지, 브라우저 저장소 덕분이 아닙니다.
- 이 API는 Chromium 계열(Chrome/Edge)에서만 지원됩니다. Firefox/Safari에서는 `StorageBar`에 안내
  메시지를 띄우고 저장 관련 기능을 비활성화합니다 (`lib/fsAccess.ts`의 `isFileSystemAccessSupported()`).

### 4.2 저장 폴더 구조

사용자가 "저장 폴더 연결"로 폴더를 고르면, 그 폴더 안에 다음이 생성됩니다.

```
[사용자가 선택한 폴더]/
  README.txt                # 최초 연결 시 1회 생성되는 안내문
  KWJMvideoAI_data/
    app_state.json          # 현재 씬 목록, 다크모드, 선택된 씬, currentProject 메타
    chat_history.json       # 채팅 인터페이스 전체 메시지
    edit_log.json           # 수정 이력 (최대 500개, 오래된 것부터 제거)
    projects/                # "새 프로젝트"로 이름 붙여 저장한 프로젝트 JSON들
    exports/                 # 내보내기 시 "저장 폴더에도 저장" 체크 시 생기는 JSON/TXT
```

관련 상수: `lib/fsAccess.ts`의 `DATA_DIR_NAME`, `PROJECTS_DIR_NAME`.
관련 파일명 상수: `store/useStore.ts`의 `APP_STATE_FILE`, `CHAT_HISTORY_FILE`, `EDIT_LOG_FILE`.

### 4.3 미디어(이미지/영상) 폴더는 별개

사용자의 요구사항대로 "이미지·영상은 별도 폴더 선택, 나머지 텍스트/기록은 저장 폴더에 저장"을
그대로 구현했습니다:

- 이미지/영상 원본 파일은 **저장 폴더로 복사되지 않습니다.**
- `mediaDirHandle`(별도로 연결하는 폴더)에서 파일을 찾아 `URL.createObjectURL()`로 미리보기만 만듭니다.
- 씬(Scene)에는 `localImageName` / `localVideoName`처럼 **파일명만** 저장됩니다 (텍스트라서 가볍습니다).
- 저장 시 blob: URL은 세션이 끝나면 무효가 되므로, `sanitizeSceneForSave()`가 JSON에 쓰기 전에
  blob URL을 비우고 파일명만 남깁니다. 다음 세션에 미디어 폴더를 다시 연결하면
  `resyncMediaReferences()`(store)가 파일명으로 다시 찾아서 미리보기를 복원합니다.
- 미디어 폴더를 아직 연결하지 않았거나 파일을 못 찾으면 `lib/utils.ts`의 `LOCAL_MEDIA_PLACEHOLDER`
  (회색 자리표시자 SVG)가 대신 표시됩니다. `getSceneImageSrc()`를 항상 `<img src>`에 사용하세요 —
  씬의 `photoRef`를 직접 넣지 마세요.

### 4.4 자동저장 & 수정 이력

- `store/useStore.ts`의 `scheduleAutosave()`가 1.5초 디바운스로 `saveAllToFolder({silent:true})`를 호출합니다.
  `updateScene`, `moveScene`, `deleteScene`, `addScene`, `addChatMessage` 등 의미 있는 액션마다
  이 함수를 호출하도록 되어 있습니다. **새 상태 변경 액션을 추가하면 반드시 `scheduleAutosave()` 호출을
  잊지 마세요** — 안 그러면 그 데이터는 수동 저장 버튼을 눌러야만 저장됩니다.
- 텍스트 입력(제목/나레이션/대사)은 `onChange`마다 저장하면 너무 잦으므로, **`onBlur` 시점에만**
  `pushEditLog()`로 수정 이력을 남깁니다 (`SceneEditor`의 `logIfChanged` 참고). 재생시간(range)은
  `onMouseUp`/`onTouchEnd`에서 커밋합니다. 이 패턴을 유지하세요.
- 저장은 항상 `saveDirHandle`이 연결되어 있을 때만 동작합니다. 연결 전에는 앱이 정상 동작하되
  실제 파일에는 아무것도 쓰이지 않습니다 (메모리에서만 동작하는 데모 상태).

### 4.5 새 프로젝트 / 불러오기

- "새 프로젝트"는 더 이상 자체 폴더 선택기를 갖지 않습니다. 전역 저장 폴더(`saveDirHandle`)를 사용해
  `KWJMvideoAI_data/projects/<이름>.json`에 씁니다 (`store.saveNamedProject`).
- "불러오기" 모달은 3단 구조입니다: ① 연결된 저장 폴더의 projects 목록(자동 조회,
  `store.listNamedProjects`) ② 임의의 다른 폴더에서 JSON 찾아 불러오기(레거시 호환, 폴더를
  새로 골라야 함) ③ 샘플 프로젝트(데모 데이터, 실제 파일 아님 — `savedProjects` in-memory 배열).
  이 3단 구조를 유지하거나 개선하되, "샘플"과 "실제 저장된 것"을 섞어서 헷갈리게 만들지 마세요.

## 5. 알려진 시뮬레이션 / 미구현 기능

아래 기능들은 **의도적으로 데모/시뮬레이션 상태**로 남겨두었습니다. 실제 백엔드나 로컬 LLM 연동이
없는 상태에서 거짓으로 "완료됨"이라고 표시하지 않도록, UI에 데모/준비중임을 명시했습니다.
실제로 구현하게 되면 아래 목록과 이 문단을 함께 업데이트하세요.

- **채팅 AI 응답** (`ChatInterface`): `setTimeout` 기반의 정해진 시나리오 응답입니다. 실제 LM Studio
  (OpenAI 호환 로컬 서버, 보통 `http://localhost:1234/v1`) 연동 시 이 블록을 `fetch` 호출로 교체하세요.
- **"LM Studio 연결됨" 표시** (헤더): 실제 연결 여부를 확인하지 않는 장식용 표시입니다. 실제 헬스체크로
  바꾸려면 주기적으로 로컬 서버에 ping을 보내고 상태를 store에 반영하세요.
- **"AI 재생성" 버튼** (나레이션 필드 옆): 클릭하면 "준비 중" 안내만 표시합니다. 실제 구현 시
  선택된 씬의 컨텍스트를 프롬프트로 만들어 LLM에 보내고 결과로 `updateScene`을 호출하면 됩니다.
- **MP4 내보내기**: 버튼 자체가 비활성화되어 있고 "(예정)"이라고 명시했습니다. 실제 영상 렌더링은
  서버 사이드 처리(ffmpeg 등)가 필요해 클라이언트만으로는 범위 밖입니다.
- **PDF 내보내기**: 실제 PDF 파일을 직접 생성하지 않고, 브라우저 인쇄창(`window.print()`)을 여는
  방식으로 구현했습니다 (사용자가 "PDF로 저장"을 선택하면 진짜 PDF가 됩니다). 전용 PDF 라이브러리를
  추가하면 더 정교하게 만들 수 있습니다.

## 6. 코딩 컨벤션

- 모든 사용자 대면 텍스트는 한국어입니다. 새 UI 문구도 한국어로 작성하세요.
- 다크모드는 Tailwind `dark:` variant + `darkMode` prop을 함께 씁니다 (컴포넌트마다 `cn(darkMode ? '...' : '...')`
  패턴이 반복됩니다). 새 컴포넌트도 이 패턴을 따르세요.
- `Scene`, `Project`, `ChatMessage`, `EditLogEntry` 타입은 모두 `store/useStore.ts`에 정의되어 있습니다.
- File System Access API 관련 타입은 브라우저 표준 lib에 아직 없는 경우가 많아 `any`를 의도적으로
  사용합니다 (`lib/fsAccess.ts` 상단 주석 참고). 이건 실수가 아니라 의도된 선택입니다.
- 새로 만드는 저장 관련 함수는 `lib/fsAccess.ts`(순수 파일시스템 유틸)와 `store/useStore.ts`
  (앱 상태 + 언제 저장할지 판단)의 역할 분리를 유지하세요.

## 7. 개발 환경 제약 (이 세션 기준)

이 프로젝트가 마지막으로 수정된 샌드박스 환경은 **npm 레지스트리에 네트워크 접근이 차단**되어
있었습니다. 그래서:

- `node_modules` 없이 코드를 작성했고, 실제 `yarn install && yarn build`로 최종 검증하지 못했습니다.
  대신 TypeScript 컴파일러로 문법/타입 오류를 최대한 점검했습니다.
- **다음에 이 프로젝트를 여는 AI(또는 사람)는 가장 먼저 `yarn install && yarn build`를 실행해서
  실제로 빌드가 되는지 확인하세요.** 문제가 있다면 대부분 import 경로나 타입 사소한 불일치일
  가능성이 높습니다.

## 8. 변경 이력

새로운 세션에서 의미 있는 변경을 했다면 아래에 날짜와 요약을 한 줄씩 추가하세요 (오래된 항목은
지우지 말고 쌓아두세요 — 프로젝트의 변경 히스토리 자체가 다음 작업자에게 중요한 컨텍스트입니다).

- **2026-07-20**: 로컬 폴더 기반 저장 시스템 전체 구축. `lib/fsAccess.ts` 확장(텍스트/JSON 읽기·쓰기,
  미디어 스캔, 권한 재확인), `store/useStore.ts`에 저장 폴더/미디어 폴더 연결·자동저장·채팅기록·
  수정이력 상태 추가, 헤더 아래 `StorageBar` 신설, `MediaLibraryModal` 신설, `NewProjectModal`/
  `LoadModal`을 전역 저장 폴더 기반으로 재구성, `ExportModal`의 가짜 내보내기를 실제 다운로드
  (JSON/TXT) + 인쇄 기반 PDF로 교체, `AppRoot.tsx`의 "AI 재생성" 죽은 버튼에 준비중 안내 추가.
  이 agent.md 파일을 신설.
