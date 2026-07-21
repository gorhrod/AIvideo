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
app/layout.tsx, app/page.tsx, app/globals.css   Next.js 엔트리 (html/body는 h-full + overflow-hidden 고정)
components/AppRoot.tsx    전체 UI. 하나의 파일에 모든 화면/모달 컴포넌트가 들어있음 (2,700줄+)
store/useStore.ts         zustand 전역 상태 — 씬, 채팅, 수정이력, 저장/미디어/블로그 폴더 연결,
                          LM Studio·FFmpeg 설정, 저장 로직
lib/fsAccess.ts           File System Access API 래퍼 (폴더/파일 읽기·쓰기, 권한 확인, 미디어 스캔)
lib/utils.ts              cn() 클래스 병합, 이미지 자리표시자, 날짜 포맷
lib/blogData.ts           블로그(sampledata) 데이터 폴더(posts.json/media-meta.json/uploads) 리더
lib/llm.ts                LM Studio(OpenAI 호환) 클라이언트 — 스트리밍 채팅, 스토리보드 JSON 생성,
                          씬 나레이션 재생성. 서버 프록시(app/api/llm/*)를 거쳐 호출합니다.
lib/subtitles.ts          씬 duration 누적 → SRT/TXT 자막 생성 (클라이언트에서 만들어 서버로 전달)
lib/server/ffmpeg.ts      서버 전용: child_process로 실제 ffmpeg 바이너리 실행 (클라이언트 import 금지)
app/api/llm/chat/         LM Studio /chat/completions 프록시 (스트리밍 릴레이, CORS 회피)
app/api/llm/health/       LM Studio 서버/모델 상태 확인 프록시
app/api/ffmpeg/check/     FFmpeg 설치 여부/버전 확인
app/api/export/video/     씬별 세그먼트 인코딩 → concat → 자막 굽기(burn-in) 실제 렌더링 + 다운로드
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

## 5. 채팅 → 스토리보드 흐름 (핵심 UX)

**채팅은 자동으로 편집기로 이동하지 않습니다.** 사용자가 대화를 계속 이어가다가 화면 하단의
**"🎬 스토리보드로 만들기"** 버튼을 직접 눌러야만 스토리보드가 생성되고 편집기(`view: 'editor'`)로
전환됩니다 (`ChatInterface`의 `handleBuildStoryboard`). 이 버튼은 사용자 메시지가 하나 이상 있을 때만
활성화됩니다. 채팅 자체는 `lib/llm.ts`의 `streamChat()`으로 LM Studio와 실시간 스트리밍 대화를 합니다.
이 흐름을 다시 "메시지 보내면 자동으로 이동"하는 방식으로 되돌리지 마세요 — 사용자가 명시적으로
요청한 UX입니다.

## 6. 블로그 데이터 연동 (sampledata 프로젝트와의 연결)

이 앱은 "경우정민 블로그" 프로젝트(별도 저장소, `sampledata`)가 만드는 데이터 폴더를 **그 블로그
서버를 실행하지 않고도** 직접 읽습니다. 블로그 쪽 `aiagent.md`에 정의된 계약을 그대로 따릅니다:

- `posts.json`, `media-meta.json`(사진/영상별 캡션·장소·날짜), `uploads/YYYY/MM/파일명`
- `lib/blogData.ts`의 `readBlogData()`가 File System Access API로 이 폴더를 읽고,
  `resolveUploadFileHandle()`이 `media-meta.json`의 `url`(`/api/uploads/...`)을 실제 파일로 변환합니다.
- **절대 규칙**: LLM이 스토리보드를 생성할 때 사용할 사진/영상은 반드시 `media-meta.json`에 실제로
  존재하는 `id` 값이어야 합니다 (`lib/llm.ts`의 `STORYBOARD_JSON_INSTRUCTION` + `mediaId` 검증 로직).
  LLM이 지어낸 파일명/캡션을 그대로 믿고 사용하지 마세요. 이 검증을 제거하지 마세요.
- `BlogImportModal`(`components/AppRoot.tsx`)에서 날짜 범위로 글을 찾아 선택하면, 그 글/미디어가
  채팅의 컨텍스트로 들어갑니다 (`blogSelectedPostIds` in store).

## 7. LM Studio(LLM) 연동

- 이 프로젝트는 **오직 LM Studio(로컬, OpenAI 호환 서버) + 사용자가 설정한 모델 하나**만 사용합니다.
  다른 클라우드 AI API를 호출하는 코드를 추가하지 마세요.
- 기본 서버 주소는 `http://localhost:1234/v1`, 기본 모델명은 `qwen3.5-9b`이며 헤더의 "설정"(⚙️)에서
  바꿀 수 있습니다 (`store.llmBaseUrl`, `store.llmModel`, `SettingsModal`).
- 브라우저에서 LM Studio로 직접 fetch하면 CORS로 막힐 수 있어, 항상 `app/api/llm/chat`,
  `app/api/llm/health`를 프록시로 거칩니다 (서버-투-서버 호출이라 CORS 제약이 없습니다). 이 프록시
  구조를 브라우저 직접 호출로 바꾸지 마세요.
- `lib/llm.ts`가 제공하는 세 가지 용도: ① `streamChat` — 일반 채팅(스트리밍), ② `generateStoryboardFromChat`
  — 채팅+블로그 컨텍스트로 씬 JSON 배열 생성, ③ `regenerateSceneNarration` — 편집기의 "AI 재생성" 버튼.

## 8. MP4 내보내기 (실제 FFmpeg 렌더링)

**서버 사이드에서 실제 ffmpeg 바이너리를 spawn합니다** (ffmpeg.wasm 같은 브라우저 내장 방식이
아닙니다). 사용자 컴퓨터에 ffmpeg이 설치되어 PATH에 있어야 하며, 없다면 설정 화면에서 실행 파일
경로를 직접 지정할 수 있습니다 (`store.ffmpegPathOverride`).

렌더링 파이프라인 (`app/api/export/video/route.ts`):
1. 씬마다 원본 이미지/영상을 받아 요청한 재생시간만큼 개별 세그먼트(mp4)로 인코딩합니다.
   이미지는 `-loop 1`, 영상은 `-stream_loop -1`로 짧으면 반복해서 채우고 길면 `-t`로 자릅니다.
2. 모든 세그먼트를 동일 해상도/코덱으로 만들었으므로 `concat` demuxer로 이어붙입니다.
3. 클라이언트가 만든 SRT 자막(`lib/subtitles.ts`)을 libass 기반 `subtitles` 필터로 영상에 굽습니다.
4. 결과 mp4 + 같은 내용의 srt + txt 세 파일을 임시 폴더에 저장하고, jobId 기반 다운로드 라우트
   (`app/api/export/video/[jobId]/[filename]`)로 클라이언트가 세 파일을 모두 내려받습니다.

**Windows 경로 주의**: 드라이브 문자(`C:\...`)의 콜론 때문에 ffmpeg 필터 문자열 이스케이프가
꼬이는 문제를 피하려고, ffmpeg 실행 시 항상 `cwd`를 작업 폴더로 지정하고 파일명은 상대경로만
사용합니다(`lib/server/ffmpeg.ts`의 `runFfmpeg`). 이 패턴을 유지하세요 — 절대경로를 필터 문자열에
직접 넣지 마세요.

이 저장소를 만든 샌드박스에는 ffmpeg(+libass)이 설치되어 있어 더미 이미지/영상으로 전체 파이프라인
(세그먼트 인코딩 → concat → 자막 굽기)을 실제로 실행해 성공을 확인했습니다. 다만 실제 브라우저에서
Next.js 서버까지 연결한 end-to-end 테스트(`yarn dev` 구동)는 네트워크가 막힌 샌드박스라 `yarn install`을
하지 못해 확인하지 못했습니다 — 섹션 10 참고.

## 9. 레이아웃 (헤더 포함 100% 높이, 페이지 스크롤 없음)

`app/layout.tsx`의 `html`/`body`와 `AppRoot.tsx` 최상위 래퍼가 `h-dvh` + `overflow-hidden`으로
고정되어 있습니다. 헤더/StorageBar는 `shrink-0`, `<main>`은 `flex-1 min-h-0 overflow-hidden`이고,
그 안의 채팅 패널·에디터 패널이 각자 `overflow-y-auto`로 내부 스크롤을 갖습니다. **새 화면/패널을
추가할 때도 이 구조를 유지하세요**: 바깥 컨테이너에 `min-h-0`을 빼먹으면 flex 자식이 부모 높이를
넘어서 버려서 다시 페이지 전체 스크롤이 생깁니다.

## 10. 알려진 제약

- **AI 사진 분석은 캡션/메타데이터 기반입니다**: 연결한 LLM(예: Qwen 3.5 9B)은 텍스트 전용이라 사진을
  직접 "보고" 분석하지 않습니다. `media-meta.json`의 캡션·장소·날짜만 근거로 나레이션을 씁니다.
  실제 이미지 인식을 원하면 LM Studio에 비전 지원 모델(Qwen-VL 계열 등)을 올리고 `lib/llm.ts`에
  이미지 base64를 함께 보내는 멀티모달 경로를 추가해야 합니다 (아직 미구현).
- **PDF 내보내기**: 여전히 브라우저 인쇄창(`window.print()`) 방식입니다 (변경 없음).
- **MP4 내보내기의 오디오**: 현재 배경음악/원본 영상 오디오를 포함하지 않습니다 (자막만 입힙니다).
  영상 클립의 원음을 살리려면 `app/api/export/video/route.ts`의 세그먼트 인코딩 단계에서 `-an`을
  제거하고 오디오 트랙 믹싱 로직을 추가해야 합니다.
- **`yarn install`/`yarn build` 미검증**: 섹션 11 참고.

## 11. 코딩 컨벤션

- 모든 사용자 대면 텍스트는 한국어입니다. 새 UI 문구도 한국어로 작성하세요.
- 다크모드는 Tailwind `dark:` variant + `darkMode` prop을 함께 씁니다 (컴포넌트마다 `cn(darkMode ? '...' : '...')`
  패턴이 반복됩니다). 새 컴포넌트도 이 패턴을 따르세요.
- `Scene`, `Project`, `ChatMessage`, `EditLogEntry` 타입은 모두 `store/useStore.ts`에 정의되어 있습니다.
- File System Access API 관련 타입은 브라우저 표준 lib에 아직 없는 경우가 많아 `any`를 의도적으로
  사용합니다 (`lib/fsAccess.ts` 상단 주석 참고). 이건 실수가 아니라 의도된 선택입니다.
- 새로 만드는 저장 관련 함수는 `lib/fsAccess.ts`(순수 파일시스템 유틸)와 `store/useStore.ts`
  (앱 상태 + 언제 저장할지 판단)의 역할 분리를 유지하세요.

## 12. 개발 환경 제약 (이 세션 기준)

이 프로젝트가 마지막으로 수정된 샌드박스 환경은 **npm 레지스트리에 네트워크 접근이 차단**되어
있었습니다. 그래서:

- `node_modules` 없이 코드를 작성했고, 실제 `yarn install && yarn build`로 최종 검증하지 못했습니다.
  대신 `esbuild`(전역 설치된 `tsx` 패키지에 번들된 것)로 모든 `.ts`/`.tsx` 파일의 **구문 오류**만
  점검했습니다 (타입 오류까지는 잡지 못합니다 — `@types/react` 등이 없어 완전한 타입체크가
  불가능했습니다). FFmpeg 파이프라인만은 예외적으로 이 샌드박스에 ffmpeg이 실제로 설치되어 있어
  더미 이미지/영상으로 전체 명령어 시퀀스(세그먼트 인코딩→concat→자막 굽기)를 진짜로 실행해 검증했습니다.
- **다음에 이 프로젝트를 여는 AI(또는 사람)는 가장 먼저 `yarn install && yarn build`를 실행해서
  실제로 빌드가 되는지 확인하세요.** 문제가 있다면 대부분 import 경로나 타입 사소한 불일치일
  가능성이 높습니다. 그다음 `yarn dev`로 LM Studio 연동(설정에서 "연결 확인")과 FFmpeg 내보내기
  ("설정"에서 "FFmpeg 확인" 후 실제 내보내기 1회)를 반드시 실기기에서 확인하세요.

## 13. 변경 이력

새로운 세션에서 의미 있는 변경을 했다면 아래에 날짜와 요약을 한 줄씩 추가하세요 (오래된 항목은
지우지 말고 쌓아두세요 — 프로젝트의 변경 히스토리 자체가 다음 작업자에게 중요한 컨텍스트입니다).

- **2026-07-20**: 로컬 폴더 기반 저장 시스템 전체 구축. `lib/fsAccess.ts` 확장(텍스트/JSON 읽기·쓰기,
  미디어 스캔, 권한 재확인), `store/useStore.ts`에 저장 폴더/미디어 폴더 연결·자동저장·채팅기록·
  수정이력 상태 추가, 헤더 아래 `StorageBar` 신설, `MediaLibraryModal` 신설, `NewProjectModal`/
  `LoadModal`을 전역 저장 폴더 기반으로 재구성, `ExportModal`의 가짜 내보내기를 실제 다운로드
  (JSON/TXT) + 인쇄 기반 PDF로 교체, `AppRoot.tsx`의 "AI 재생성" 죽은 버튼에 준비중 안내 추가.
  이 agent.md 파일을 신설.
- **2026-07-22**: 다음 기능을 실제로 구현 (더 이상 시뮬레이션이 아님):
  1) 레이아웃을 `h-dvh`+`overflow-hidden` 기반으로 바꿔 헤더 포함 화면 100% 안에서만 스크롤되도록 수정
     (`app/layout.tsx`, `app/globals.css`, `AppRoot.tsx` 최상위 wrapper).
  2) 채팅을 실제 LM Studio 스트리밍 연동으로 교체하고, 자동 이동 대신 사용자가 누르는
     "🎬 스토리보드로 만들기" 버튼으로만 편집기 이동하도록 변경 (`ChatInterface`, `lib/llm.ts`).
  3) 블로그(`sampledata`) 데이터 폴더(posts.json/media-meta.json/uploads) 연동 추가
     (`lib/blogData.ts`, `BlogImportModal`, `store.connectBlogDataFolder`) — LLM이 고르는 미디어는
     항상 실제 media-meta id로 검증됨.
  4) 헤더에 실시간 LM Studio 연결 상태 배지 + "설정" 모달(`SettingsModal`) 신설
     (서버 주소/모델/FFmpeg 경로/자막 폰트, `app/api/llm/health`, `app/api/ffmpeg/check`).
  5) SceneEditor의 "AI 재생성"을 실제 LM Studio 호출로 구현 (`regenerateSceneNarration`).
  6) MP4 내보내기를 실제 FFmpeg 렌더링으로 구현 — 씬별 세그먼트 인코딩(이미지 loop / 영상
     stream_loop) → concat → libass 자막 굽기, SRT+TXT 동시 생성/다운로드
     (`lib/subtitles.ts`, `lib/server/ffmpeg.ts`, `app/api/export/video/*`, `ExportModal`).
  네트워크가 막힌 샌드박스라 `yarn install`은 못 했지만, esbuild로 전체 `.ts`/`.tsx` 구문 검사를
  통과했고, ffmpeg 파이프라인은 실제 설치된 ffmpeg으로 더미 자산을 렌더링해 검증함(섹션 8, 12 참고).
