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
components/AppRoot.tsx    전체 UI. 하나의 파일에 모든 화면/모달 컴포넌트가 들어있음 (3,600줄+)
store/useStore.ts         zustand 전역 상태 — 씬, 채팅, 수정이력, 저장/미디어/블로그 폴더 연결,
                          LM Studio·FFmpeg 설정, 저장 로직
lib/fsAccess.ts           File System Access API 래퍼 (폴더/파일 읽기·쓰기, 권한 확인, 미디어 스캔)
lib/utils.ts              cn() 클래스 병합, 이미지 자리표시자, 날짜 포맷, 내보내기 해상도 계산(getExportResolution)
lib/blogData.ts           블로그(sampledata) 데이터 폴더(posts.json/media-meta.json/uploads) 리더
lib/llm.ts                LM Studio(OpenAI 호환) 클라이언트 — 스트리밍 채팅, 채팅 기반/미디어 기반
                          스토리보드 JSON 생성, 씬 나레이션 재생성. 서버 프록시(app/api/llm/*)를 거쳐 호출합니다.
lib/subtitles.ts          씬 duration 누적 → SRT/TXT 자막 생성, 자막 가독 시간 기반 최소 duration 보정
lib/captionStyles.ts      자막 번인(burn-in) 스타일 프리셋 (서버 force_style + 클라이언트 선택 UI 공용)
lib/server/ffmpeg.ts      서버 전용: child_process로 실제 ffmpeg 바이너리 실행 + 자동 경로 탐지 +
                          동시 인코딩 풀(runWithConcurrency) (클라이언트 import 금지)
app/api/llm/chat/         LM Studio /chat/completions 프록시 (스트리밍 릴레이, CORS 회피, 연결 타임아웃)
app/api/llm/health/       LM Studio 서버/모델 상태 확인 프록시
app/api/ffmpeg/check/     FFmpeg 설치 여부/버전 확인 (자동 경로 탐지 포함)
app/api/export/video/     씬별 세그먼트 병렬 인코딩 → concat → 자막 굽기(burn-in) 실제 렌더링 + 다운로드
public/sample-blog-data/  샘플 블로그 데이터(posts.json 등 + uploads/) — 블로그 서버 없이 바로 테스트용
public/sample-media/      캡션 없는 샘플 사진/영상 폴더 — 미디어 라이브러리 바로 테스트용
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

## 5.1 미디어 우선 스토리보드 생성 (2026-07-23 추가)

채팅으로 컨셉을 먼저 정하는 방식과 반대 방향의 흐름도 지원합니다: 사용자가 사진/영상을
**먼저** 고르면, 그 선택 그대로(순서·개수 불변) AI가 한 장면씩 나레이션을 붙여 스토리보드를
즉시 만듭니다. 진입점은 두 곳입니다:

- **`MediaLibraryModal`의 "여러 개 선택해서 AI로 만들기"**: 순수 로컬 파일(캡션 없음)을
  순서대로 골라 `generateStoryboardFromMedia()`(`lib/llm.ts`)를 호출합니다.
- **`BlogImportModal`의 "AI로 바로 스토리보드 만들기"**: 선택한 블로그 글의 실제 미디어
  (캡션/장소/날짜 있음)를 그대로 넘겨 같은 함수를 호출합니다. 채팅 컨텍스트로만 넘기던
  기존 "채팅으로 가져오기" 버튼과 별개로 추가된 지름길입니다.

**핵심 불변식(반드시 유지)**: `generateStoryboardFromMedia()`가 반환하는 배열은 항상 입력
`items`와 **길이·순서가 정확히 같습니다.** LLM이 개수를 잘못 반환해도(누락/초과) 이 함수가
입력 기준으로 안전하게 채우거나 잘라내므로, 사용자가 고른 사진/영상이 누락되는 일은 없습니다.
이 보장을 깨는 방향으로(예: LLM 반환값 길이를 그대로 신뢰) 리팩터링하지 마세요.

캡션/장소/날짜 정보가 없는 항목(순수 미디어 폴더)에 대해서는 시스템 프롬프트가 "확인할 수
없는 사실을 지어내지 말라"고 명시하지만, 자연스러운 분위기의 나레이션 자체는 허용합니다 —
이는 블로그 데이터의 "사실을 지어내지 않는다" 원칙과는 성격이 다릅니다 (블로그 쪽은 실제
사실 데이터가 있는데 이를 무시하고 지어내면 안 된다는 것이고, 순수 미디어 쪽은애초에 사실
정보 자체가 없는 상태에서 창작 톤의 문구를 쓰는 것이라 원칙 위반이 아닙니다).

## 5.2 자막 가독 시간 보정 (2026-07-23 추가)

`lib/subtitles.ts`의 `ensureReadableDuration()`이 새로 생성되는 모든 씬(채팅 기반/미디어 기반
스토리보드 생성 양쪽 모두, `lib/llm.ts`에서 호출)의 duration을 나레이션+대사 글자 수 기준
최소 읽기 시간과 비교해 더 큰 값을 사용합니다. LLM이 긴 나레이션에 짧은 duration을 준 경우에도
자막이 화면에서 잘리지 않도록 보정하는 안전장치입니다. 이미 충분히 긴 duration은 건드리지
않으므로, 사용자가 편집기에서 직접 지정한 duration에는 영향이 없습니다(이 함수는 오직 AI
생성 시점에만 호출됩니다).



이 앱은 "경우정민 블로그" 프로젝트(별도 저장소, `sampledata`)가 만드는 데이터 폴더를 **그 블로그
서버를 실행하지 않고도** 직접 읽습니다. 블로그 쪽 `aiagent.md`에 정의된 계약을 그대로 따릅니다:

- `posts.json`, `media-meta.json`(사진/영상별 캡션·장소·날짜), `uploads/YYYY/MM/파일명`
- `lib/blogData.ts`의 `readBlogData()`가 File System Access API로 이 폴더를 읽고,
  `resolveUploadFileHandle()`이 `media-meta.json`의 `url`(`/api/uploads/...`)을 실제 파일로 변환합니다.
- **⚠️ 2026-07-22 실데이터 검증으로 밝혀진 핵심 사실 — 반드시 유지할 것**: 블로그의 실제 소스코드
  (`lib/mediaMeta.ts`, `lib/extractMedia.ts`)를 직접 확인한 결과, "원본"은 항상 글 `content`(HTML)
  안의 `<img>`/`<video>` 태그이고, `media-meta.json`은 그중 `data-media-id`가 붙은 태그만 골라
  캡션/장소를 저장하는 **보조 색인일 뿐**입니다. 즉:
  - `media-meta.json` 파일 자체가 아예 없는 데이터 폴더도 정상입니다 (아직 "글 저장"이 한 번도
    안 됐거나 구버전 데이터). 사용자가 실제로 준 테스트 데이터(`posts.json`)에도 media-meta.json이
    없었습니다.
  - `data-media-id`가 없는 `<img>`(붙여넣기로 들어간 사진 등)는 media-meta.json에 절대 안 잡힙니다.
  - 그래서 `lib/blogData.ts`는 **media-meta.json만 보고 판단하지 않습니다.** 항상 각 글의
    `content`를 직접 정규식으로 파싱(`parseMediaTagsFromContent`)해 미디어를 먼저 찾고,
    `media-meta.json`에 같은 `mediaId`의 항목이 있으면 그걸로 캡션/장소를 보강(`buildMediaForPost`)
    합니다. media-meta.json에 없는 사진은 `content_<postId>_<index>` 형태의 합성 id를 붙여
    캡션 없이(빈 문자열) 사용합니다 — **이 합성 id도 실제 파일(url)에 그대로 연결되므로
    사진 자체를 놓치지 않습니다.** 이 이중 처리(본문 파싱 우선 + media-meta 보강)를 하나로
    합치거나 media-meta.json 단독 의존으로 되돌리지 마세요 — 실사용 데이터 대부분이 깨집니다.
  - `settings.json`의 `authorLabels`(작성자 코드→표시 이름)도 함께 읽어(`resolveAuthorLabel`)
    LLM 프롬프트와 UI에 "gyeongwoo" 같은 내부 코드 대신 사람이 보는 이름("경우" 등)을 씁니다.
  - 이 로직은 `scripts_tmp_test/verify_blog_llm.ts`(검증 후 삭제됨)로 사용자가 준 실제
    `posts.json`을 대상으로 실행해 확인했습니다: media-meta.json 없이도 본문 속 사진을 정확히
    찾아냈고, LLM이 존재하지 않는 mediaId를 지어내면 `null`로 정확히 걸러졌습니다.
- **절대 규칙**: LLM이 스토리보드를 생성할 때 사용할 사진/영상은 반드시 `lib/blogData.ts`가
  만든 `media` 목록에 실제로 존재하는 `id` 값이어야 합니다 (`lib/llm.ts`의
  `STORYBOARD_JSON_INSTRUCTION` + `mediaId` 검증 로직). LLM이 지어낸 파일명/캡션을 그대로 믿고
  사용하지 마세요. 이 검증을 제거하지 마세요.
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
- `lib/llm.ts`가 제공하는 네 가지 용도: ① `streamChat` — 일반 채팅(스트리밍), ② `generateStoryboardFromChat`
  — 채팅+블로그 컨텍스트로 씬 JSON 배열 생성, ③ `generateStoryboardFromMedia` — 사용자가 먼저 고른
  사진/영상 순서 그대로 씬 배열 생성(섹션 5.1 참고), ④ `regenerateSceneNarration` — 편집기의
  "AI 재생성" 버튼.
- **AI 연결 안내 배너**: `AppRoot.tsx`의 `LlmOfflineBanner`가 `store.llmStatus === 'offline'`일 때
  헤더 아래 항상 눈에 띄는 배너를 띄웁니다("연결하기" 버튼으로 설정 모달을 바로 엽니다). 기존의
  작은 상태 점(`LlmStatusBadge`)만으로는 놓치기 쉬웠던 문제를 보완한 것이므로, 이 배너를 없애거나
  조용한 표시로 되돌리지 마세요.

### 7.1 속도 최적화 (2026-07-23 추가) — 반드시 유지할 것

로컬 LLM은 켜져 있는지 여부보다 "프롬프트 길이"와 "생성 토큰 제한"에 체감 속도가 훨씬 크게
좌우됩니다. 예전 구현은 ① `max_tokens`을 전혀 지정하지 않았고 ② 채팅이 길어질수록 대화 전체를
매번 그대로 다시 보내 프롬프트가 계속 커지는 문제가 있었습니다. 다음 두 가지로 개선했습니다:

- `lib/llm.ts`의 `trimHistoryForPrompt()`가 system 메시지는 전부 보존하고 user/assistant는
  최근 `MAX_HISTORY_MESSAGES`(16)개만 남겨 모델에 전달합니다. `streamChat`/`chatOnce` 양쪽 모두
  내부적으로 이 함수를 거칩니다 — 호출부에서 별도로 신경 쓸 필요는 없습니다.
- 모든 LM Studio 호출에 용도별 `max_tokens`을 지정합니다(`estimateStoryboardMaxTokens()` 등).
  새로운 LLM 호출을 추가할 때도 `max_tokens`을 반드시 지정하세요 — 지정하지 않으면 로컬 서버의
  기본값(모델/서버 설정에 따라 매우 클 수 있음)에 의존하게 되어 다시 느려집니다.
- `app/api/llm/chat/route.ts`는 연결 타임아웃을 요청 종류에 따라 다르게 둡니다: 스트리밍 요청은
  SSE 헤더가 생성 시작과 거의 동시에 도착하므로 20초, 스트리밍이 아닌 요청(스토리보드 JSON
  생성 등)은 LM Studio가 전체 생성이 끝난 뒤에야 응답을 보내므로 5분을 둡니다. **이 두 타임아웃
  값을 하나로 합치지 마세요** — 짧게 통일하면 느린 로컬 모델의 정상적인 스토리보드 생성이
  중간에 "시간 초과"로 잘못 끊깁니다.


## 8. MP4 내보내기 (실제 FFmpeg 렌더링)

**서버 사이드에서 실제 ffmpeg 바이너리를 spawn합니다** (ffmpeg.wasm 같은 브라우저 내장 방식이
아닙니다). 사용자 컴퓨터에 ffmpeg이 설치되어 있어야 하며, `lib/server/ffmpeg.ts`의
`resolveFfmpegPath()`가 설정에 지정한 경로 → 환경변수 `FFMPEG_PATH` → PATH → OS별 흔한 설치
위치(macOS Homebrew, Linux 배포판 경로, Windows `C:\ffmpeg\bin`) → (선택) `ffmpeg-static`
패키지 순서로 자동 탐색합니다. 그래도 못 찾으면 명확한 오류 메시지로 안내합니다. 이 자동 탐색
체인에 새 후보 경로를 추가하는 건 괜찮지만, "PATH만 시도하고 실패하면 바로 포기" 식으로
되돌리지 마세요 — 실제로 설치되어 있어도 셸 PATH에 안 잡히는 경우가 흔합니다.

렌더링 파이프라인 (`app/api/export/video/route.ts`):
1. 씬마다 원본 이미지/영상을 받아 요청한 재생시간만큼 개별 세그먼트(mp4)로 인코딩합니다.
   이미지는 `-loop 1`, 영상은 `-stream_loop -1`로 짧으면 반복해서 채우고 길면 `-t`로 자릅니다.
   **세그먼트끼리는 서로 독립적이므로 `runWithConcurrency()`(`lib/server/ffmpeg.ts`)로 최대 4개까지
   동시에 인코딩합니다** (CPU 코어 수에 따라 자동 조정, 2026-07-23 추가) — 순차 인코딩으로
   되돌리면 장면이 많은 프로젝트에서 내보내기 시간이 장면 수에 비례해 다시 늘어납니다.
2. 모든 세그먼트를 동일 해상도/코덱으로 만들었으므로 `concat` demuxer로 이어붙입니다.
3. 클라이언트가 만든 SRT 자막(`lib/subtitles.ts`)을 libass 기반 `subtitles` 필터로 영상에 굽습니다.
   자막 스타일은 `lib/captionStyles.ts`의 프리셋(기본/굵은 화이트/옐로우 강조/블랙 박스) 중
   `manifest.captionStyle`로 선택하며, `getCaptionStylePreset()`이 force_style 문자열을 만듭니다.
   새 프리셋을 추가할 때는 이 파일 하나만 수정하면 서버(force_style)와 클라이언트(선택 UI)
   양쪽에 자동 반영됩니다.
4. 결과 mp4 + 같은 내용의 srt + txt 세 파일을 임시 폴더에 저장하고, jobId 기반 다운로드 라우트
   (`app/api/export/video/[jobId]/[filename]`)로 클라이언트가 세 파일을 모두 내려받습니다.

**화면비율**: `ExportModal`에서 16:9(가로)/9:16(세로, 쇼츠·릴스용)를 고르면
`lib/utils.ts`의 `getExportResolution()`이 화질(720/1080)과 조합해 실제 픽셀 해상도를
계산합니다. 서버(`route.ts`)는 width/height만 받으므로 별도 처리가 필요 없습니다 — 세로
비율은 그냥 width/height가 뒤바뀐 값일 뿐입니다.

**Windows 경로 주의**: 드라이브 문자(`C:\...`)의 콜론 때문에 ffmpeg 필터 문자열 이스케이프가
꼬이는 문제를 피하려고, ffmpeg 실행 시 항상 `cwd`를 작업 폴더로 지정하고 파일명은 상대경로만
사용합니다(`lib/server/ffmpeg.ts`의 `runFfmpeg`). 이 패턴을 유지하세요 — 절대경로를 필터 문자열에
직접 넣지 마세요.

이 저장소를 만든 샌드박스에는 ffmpeg(+libass)이 설치되어 있어 더미 이미지/영상으로 전체 파이프라인
(세그먼트 병렬 인코딩 → concat → 자막 굽기)을 실제로 실행해 성공을 확인했습니다. 다만 실제 브라우저에서
Next.js 서버까지 연결한 end-to-end 테스트(`yarn dev` 구동)는 네트워크가 막힌 샌드박스라 `yarn install`을
하지 못해 확인하지 못했습니다 — 섹션 12 참고.

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
- **`yarn install`/`yarn build` 미검증**: 섹션 12 참고 (2026-07-23 세션도 동일하게 네트워크가
  막힌 샌드박스였습니다).

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
- **2026-07-22 (같은 날 추가 세션)**: 사용자가 실제 블로그 프로젝트 소스+테스트 데이터(zip)를 줘서
  블로그 연동을 실데이터로 검증. **버그 발견 및 수정**: `media-meta.json`이 없거나(테스트 데이터가
  정확히 이 경우였음) `data-media-id` 없는 사진은 이전 구현(media-meta.json 단독 의존)에서는
  전혀 찾지 못했음. `lib/blogData.ts`를 글 `content` HTML 직접 파싱 우선 + media-meta.json 보강
  방식으로 재작성(`parseMediaTagsFromContent`, `buildMediaForPost` 추가) — 섹션 6 참고. 부가로
  `settings.json`의 `authorLabels`를 읽어 LLM 프롬프트에 작성자 실명 표시 추가
  (`resolveAuthorLabel`, `store.blogAuthorLabels`). `lib/llm.ts`/`lib/blogData.ts`를 tsx로 직접
  실행해 사용자가 준 실제 posts.json으로 전체 파이프라인(미디어 추출 → LLM 응답 모킹 →
  mediaId 검증)을 end-to-end 테스트해 통과 확인.
- **2026-07-23**: 사용자가 AIvideoprojectdocs(ffmpeg 구조 참고용)와 textgeneratordocs(AI
  스토리보드/채팅 헬퍼 참고용) 두 참고 프로젝트를 추가로 제공. 이를 참고해 실사용 가능하도록
  다음을 구현/수정:
  1) **AI 응답 속도 최적화** — 대화 기록을 매번 전체 재전송하던 것을 최근 N개로 제한
     (`lib/llm.ts`의 `trimHistoryForPrompt`), 모든 LM Studio 호출에 용도별 `max_tokens` 지정,
     `app/api/llm/chat/route.ts`에 연결 타임아웃 추가(스트리밍 20초 / 비스트리밍 5분 — 다른
     이유로 통일 금지, 섹션 7.1 참고). textgeneratordocs의 토큰 예산 관리 아이디어를 참고했으나
     전체 컨텍스트 길이 자동 감지까지는 이식하지 않고 고정 상한값으로 단순화함.
  2) **미디어 우선 스토리보드 생성 신설** (섹션 5.1) — `lib/llm.ts`의
     `generateStoryboardFromMedia()` 신설. `MediaLibraryModal`에 여러 개 선택 모드 +
     "AI로 스토리보드 만들기" 버튼, `BlogImportModal`에 "AI로 바로 스토리보드 만들기" 버튼 추가.
  3) **버그 수정**: `MediaLibraryModal`이 모달을 닫을 때 그동안 만든 objectURL을 무조건 전부
     revoke해서, 방금 장면에 적용한 사진까지 깨지는 문제 발견. `appliedUrlsRef`로 실제 적용된
     URL을 추적해 그것만 revoke 대상에서 제외하도록 수정. 새로 추가한 미디어 우선 생성 흐름도
     같은 방식으로 보호함.
  4) **`resolveScenesWithBlogMedia`를 순차 처리에서 `Promise.all` 병렬 처리로 변경** (각 장면의
     블로그 미디어 파일 읽기는 서로 독립적이므로).
  5) **자막 가독 시간 보정** (섹션 5.2) — `lib/subtitles.ts`에 `estimateReadingDurationSeconds`/
     `ensureReadableDuration` 추가, AI가 생성하는 모든 씬(채팅/미디어 양쪽)에 적용.
  6) **FFmpeg 자동 경로 탐지 + 병렬 세그먼트 인코딩** — `lib/server/ffmpeg.ts`에
     `resolveFfmpegPath()`(AIvideoprojectdocs의 바이너리 자동탐지 아이디어를 특정 바이너리
     번들 없이 후보 경로 탐색으로 구현) + `runWithConcurrency()` 신설. `app/api/export/video/route.ts`,
     `app/api/ffmpeg/check/route.ts`가 이를 사용하도록 변경 (섹션 8 참고).
  7) **자막 스타일 프리셋 + 화면비율(9:16) 내보내기 추가** — `lib/captionStyles.ts` 신설(4종
     프리셋), `lib/utils.ts`의 `getExportResolution()`으로 16:9/9:16 × 720p/1080p 조합 지원,
     `ExportModal` UI에 반영.
  8) **AI 연결 안내 배너 신설** — `AppRoot.tsx`의 `LlmOfflineBanner`, `llmStatus === 'offline'`일 때
     헤더 아래 상시 표시 + "연결하기" 버튼으로 설정 모달 오픈.
  9) **샘플 데이터 완비** — `public/sample-blog-data/`(제주 가족여행 소재 블로그 글 3개, 사진 5장
     + 영상 1개, posts.json/media-meta.json/categories.json/settings.json 포함 — media-meta.json
     경로와 본문 직접 추출 경로 양쪽을 모두 실제로 검증함)와 `public/sample-media/`(캡션 없는
     순수 미디어 폴더) 신설. 각각 README.txt로 사용법 안내. 이미지는 `sharp`로, 영상은 ffmpeg으로
     직접 생성한 플레이스홀더입니다.
  네트워크가 막힌 샌드박스라 이번에도 `yarn install`은 못 했지만, TypeScript 컴파일러의
  `transpileModule`로 수정한 모든 `.ts`/`.tsx` 파일의 구문 오류를 재확인했고(0건), 샘플 데이터는
  블로그의 실제 파싱 로직(`parseMediaTagsFromContent`/`buildMediaForPost`)을 그대로 재현한
  검증 스크립트로 7개 미디어 항목이 모두 정확히 해석되는지 확인했습니다.
- **2026-07-25**: 사용자가 요청한 6가지 항목을 반영 (수정한 파일만 변경):
  1) **0부터 시작 (zero-start)** — `store/useStore.ts`의 기본 상태에서 `SAMPLE_SCENES`/`SAMPLE_PROJECT`를
     더 이상 기본값으로 쓰지 않음 (`scenes: []`, `selectedSceneId: null`, `currentProject: null`,
     기본 `view: 'chat'`). 샘플 데이터는 "불러오기" 모달의 "샘플 프로젝트" 섹션에서만 남겨둠.
     `NewProjectModal`은 저장 직전 새 `resetForNewProject()` 액션으로 스토리보드를 완전히 비우고
     저장하도록 변경 (모달에 "새 프로젝트는 항상 빈 스토리보드로 시작합니다" 안내 문구 추가).
  2) **저장 폴더 자동 생성 + 마지막 위치 기억** — `lib/fsAccess.ts`에 OPFS(브라우저 내부 저장소,
     `navigator.storage.getDirectory()`) 헬퍼와 IndexedDB 기반 폴더 핸들 기억(`rememberDirectoryHandle`
     / `getRememberedDirectoryHandle` / `queryPermissionSilently`) 추가. `store/useStore.ts`에
     `initStorage()`(앱 시작 시 1회: 기억해둔 폴더에 조용히 재연결 시도 → 실패하면 OPFS로 자동
     연결, 폴더가 전혀 없어도 바로 자동저장 시작) + `reconnectRememberedSaveFolder()`(사용자
     클릭으로 재인증) 신설. `connectSaveFolder`는 이제 고른 폴더를 IndexedDB에 기억해둠.
     `AppRoot.tsx`에서 마운트 시 `initStorage()` 호출, `StorageBar`에 OPFS/실제폴더 상태 구분
     표시 + "이전 폴더 다시 연결" 버튼 추가.
  3) **FFmpeg 경로 설정 UI 제거, 프로젝트 동봉 ffmpeg 사용** — `lib/server/ffmpeg.ts`의
     `resolveFfmpegPath()`에서 사용자 지정 경로(userOverride) 파라미터를 완전히 제거하고
     프로젝트 동봉 바이너리(`ffmpeg/bin/ffmpeg.exe`)를 최우선으로 시도하도록 재정렬.
     `app/api/ffmpeg/check/route.ts`, `app/api/export/video/route.ts`에서 `ffmpegPath` 쿼리/
     매니페스트 필드 제거. `SettingsModal`의 FFmpeg 경로 입력 필드 삭제, 대신 "동봉된 FFmpeg을
     자동으로 사용합니다" 안내 문구로 교체. `store.ffmpegPathOverride` 필드 자체를 제거.
  4) **블로그 가져오기 개선** — `BlogImportModal`에 제목/본문/장소 검색 입력창과 "검색된 글
     모두 선택" 버튼 추가. "선택한 글에 사진/영상이 없습니다" 하드 실패 제거 — `lib/llm.ts`에
     텍스트 전용 `generateStoryboardFromPosts()`(`PostTextDescriptor` 기반) 신설, 사진/영상이
     있는 글은 기존처럼 `generateStoryboardFromMedia`로, 없는 글은 본문 내용으로 장면을 만들어
     원래 글 순서대로 합침 ("글이나 사진이 있으면 모두" 스토리보드에 포함). 모달은 `ModalBackdrop`에
     `closeOnBackdropClick={false}`를 넘겨 바깥 클릭으로 닫히지 않고 X 버튼으로만 닫히도록 변경
     (`ModalBackdrop`에 해당 prop 신설, 이 모달에만 적용).
  5) **LM Studio 응답 모드 3단계** — `store/useStore.ts`에 `llmMode: 'fast'|'normal'|'expert'`
     신설, `lib/llm.ts`의 `LlmSettings.mode` + `scaleTokensForMode`/`scaleTemperatureForMode`로
     `streamChat`/`chatOnce`의 max_tokens·temperature를 모드별로 조정(빠른모드 ≈0.55배 토큰,
     전문가모드 ≈1.8배 토큰). `SettingsModal`에 빠른모드/보통모드/전문가모드 3버튼 UI 추가,
     모든 LLM 호출 지점(`ChatInterface`, `SceneEditor`, `BlogImportModal`, `MediaLibraryModal`)에
     `mode: llmMode` 전달.
  6) **아이콘 기반 "이미지 없음" UI** — `lib/utils.ts`의 `LOCAL_MEDIA_PLACEHOLDER`를 글자 위주
     회색 박스에서 사진 프레임+사선 아이콘 기반 SVG로 교체 (`getSceneImageSrc`가 이 자리표시자를
     반환하는 모든 곳에 자동 적용됨 — 에디터 메인 이미지, 씬 목록 썸네일 등). `LoadModal`의
     프로젝트 썸네일도 항상 `getSceneImageSrc`를 거치도록 통일. `MediaLibraryModal` 그리드에서
     이미지 썸네일이 아직 로드되지 않았을 때 "영상"으로 잘못 표시되던 아이콘을 종류별로 올바르게
     분리(영상 vs 이미지 로딩 중).
  네트워크가 막힌 샌드박스라 이번에도 `yarn install`/`tsc`는 실행하지 못했고, 수정한 모든
  섹션을 직접 재확인(중괄호/괄호 짝, 타입 필드 존재 여부, 남은 참조 없음)했습니다. 첫 실행
  후 `yarn install && yarn dev`로 정상 빌드되는지 한 번 더 확인해주세요.
