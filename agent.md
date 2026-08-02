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
components/AppRoot.tsx    전체 UI. 하나의 파일에 모든 화면/모달 컴포넌트가 들어있음 (4,500줄+)
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
    projects/
      <프로젝트명>/
        media/               # 이 프로젝트에 등록한 사진/영상 원본 파일 (실제 복사본)
        media_analysis.json  # media/ 폴더 안 파일별 태그·설명 캐시 (재분석 없이 재사용)
      <이름>.json             # "새 프로젝트"로 이름 붙여 저장한 프로젝트 스냅샷들
```

> ⚠️ `exports/` 폴더는 **더 이상 만들어지지 않습니다.** 예전에는 내보내기 시 "저장 폴더에도
> 중복 저장" 체크박스(`alsoSaveToFolder`)가 `KWJMvideoAI_data/exports/`에 JSON/TXT를 남겼지만,
> 2026-08-01에 내보내기 흐름이 `showSaveFilePicker` 저장 대화상자 하나로 통합되면서 이 체크박스와
> `writeExportToSaveFolder`가 완전히 제거됐습니다(13절 2026-08-01 항목 참고). 코드에 없는 폴더를
> 문서에 다시 등장시키지 마세요.

관련 상수: `lib/fsAccess.ts`의 `DATA_DIR_NAME`, `PROJECTS_DIR_NAME`, `MEDIA_ANALYSIS_FILE_NAME`.
관련 파일명 상수: `store/useStore.ts`의 `APP_STATE_FILE`, `CHAT_HISTORY_FILE`, `EDIT_LOG_FILE`.

### 4.3 미디어(이미지/영상)도 저장 폴더 안에 실제 파일로 저장됩니다 (2026-07-27(2) 이후 — 이전 구조 아님, 주의)

> ⚠️ 초기 버전에는 "이미지·영상은 별도 미디어 폴더에서 참조만 하고, 저장 폴더에는 파일명만
> 남긴다"는 구조(`mediaDirHandle`를 따로 연결)가 있었습니다. **2026-07-27(2)에 이 "미디어 폴더
> 연결" 개념을 완전히 제거하고 저장 폴더 하나로 통합했습니다.** 아래가 현재 진실이고, 13절의
> 오래된 changelog 항목(2026-07-20 등)에 남아있는 `mediaDirHandle` 관련 기록은 그 변화 과정을
> 보여주는 역사 기록일 뿐이니 되살리지 마세요.

- 사용자가 스토리보드 편집기에서 "등록" 버튼으로 사진/영상 파일을 고르면, 그 파일은
  `KWJMvideoAI_data/projects/<프로젝트명>/media/`에 **실제로 복사되어 저장**됩니다
  (`uploadPhotoToScene`/`uploadVideoToScene` → `getProjectMediaDir()` → `writeBinaryFile()`).
  이름 충돌을 피하려고 `buildUniqueMediaFileName()`이 타임스탬프를 붙인 파일명을 씁니다.
  이렇게 하면 사용자가 탐색기에서도 프로젝트별 사진/영상을 바로 볼 수 있습니다.
- 씬(Scene)에는 `localImageName` / `localVideoName`처럼 **파일명만** 저장되고, 화면 표시용
  미리보기는 그 파일 핸들에서 만든 `URL.createObjectURL()` blob URL을 씁니다.
- 저장 시 blob: URL은 세션이 끝나면 무효가 되므로, `sanitizeSceneForSave()`가 JSON에 쓰기 전에
  blob URL을 비우고 파일명만 남깁니다. 다음에 같은 저장 폴더를 다시 연결하면
  `resyncMediaReferences()`(store)가 `projects/<프로젝트명>/media/` 안에서 파일명으로 다시
  찾아 미리보기를 복원합니다.
- 파일을 아직 찾지 못했거나(예: 파일이 폴더 밖에서 지워짐) 저장 폴더가 아직 연결되지 않았으면
  `lib/utils.ts`의 `LOCAL_MEDIA_PLACEHOLDER`(회색 자리표시자 SVG)가 대신 표시됩니다.
  `getSceneImageSrc()`를 항상 `<img src>`에 사용하세요 — 씬의 `photoRef`를 직접 넣지 마세요.
- `media_analysis.json`(`MEDIA_ANALYSIS_FILE_NAME`)은 `media/` 폴더와 나란히 프로젝트 폴더에
  저장되는 캐시 파일로, 파일별 태그/설명을 담아 같은 폴더를 다시 열었을 때 재분석 없이 재사용합니다.
- 참고: `MediaLibraryModal`("미디어 라이브러리")도 별도 폴더가 아니라 바로 이 현재 프로젝트의
  `projects/<프로젝트명>/media/` 폴더를 그대로 보여줍니다(`store.listProjectMediaFiles`,
  `addFilesToProjectMedia`) — 저장 폴더가 실제로 연결되어 있어야만(OPFS 자동 저장소만으로는
  부족) 동작하며, 여기서 파일을 추가하면 위와 똑같이 `media/`에 실제 복사됩니다. 반면
  `BlogImportModal`("블로그에서 가져오기")은 이것과 완전히 별개로, **사용자가 이미 갖고 있는**
  블로그 데이터 폴더(6절 참고)를 읽기 전용으로 스캔·참조합니다 — 그쪽은 저장 폴더로 파일을
  복사하지 않고 File System Access API로 원본 폴더의 파일을 직접 가리키기만 합니다.

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

### 4.5 새 프로젝트 / 폴더 연결 = 프로젝트 열기 (2026-08-02 변경 — 이전 구조 아님, 주의)

> ⚠️ 예전에는 "불러오기" 모달(`LoadModal`)이 있었고, 헤더의 "가져오기" 버튼이 그 모달로 가는
> 진입점 중 하나였습니다. **2026-08-02에 이 구조를 완전히 제거했습니다.** 이 문서의 아래
> 오래된 changelog 항목(2026-07-27 등)에는 `LoadModal`/`ImportHubModal`을 만들었다는 기록이
> 남아있지만, 그 컴포넌트들은 **더 이상 코드에 존재하지 않습니다.** 이 섹션(4.5)이 현재 진실이고,
> changelog는 그 변화 과정을 보여주는 역사 기록일 뿐이니 changelog를 보고 되살리지 마세요.

- **"저장 폴더 연결" = "이 폴더의 프로젝트 열기"**: 사용자가 헤더의 "저장 폴더 연결"로 폴더를
  고르면(`store.connectSaveFolder` → `attachSaveDir`), 그 폴더 안 `KWJMvideoAI_data/app_state.json`에
  저장된 장면이 있으면 자동으로 불러와 편집기로 전환합니다. **더 이상 "불러오기" 목록에서
  프로젝트를 고르는 단계가 없습니다** — 폴더를 연결하는 행위 자체가 곧 그 프로젝트를 여는
  행위입니다 (1폴더 = 1작업중 프로젝트 모델).
- **빈 폴더에 새로 연결하면 빈 데이터로 시작**: `attachSaveDir`가 그 폴더에서 `app_state.json`을
  찾지 못하면(완전히 새 폴더이거나 아직 한 번도 저장한 적 없는 폴더), 메모리에 남아있던
  이전 폴더/세션의 장면·채팅·수정이력을 그대로 들고 있지 않도록 **명시적으로 빈 상태로
  초기화**합니다(`scenes: []`, `chatMessages: [INITIAL_CHAT_MESSAGE]`, `editLog: []`,
  `currentProject: null`). 그 직후 `saveAllToFolder({silent:true})`를 한 번 호출해서, 사용자가
  아직 아무 편집도 하지 않았어도 `KWJMvideoAI_data/app_state.json` 등 빈 데이터 파일이 폴더
  안에 바로 생성되도록 합니다("폴더에 데이터가 없으면 빈 데이터를 다시 생성해야 한다"는
  요구사항). 이 초기화는 `source === 'external'`(진짜 사용자가 고른 폴더)일 때만 일어나고,
  브라우저 내부 자동 저장소(OPFS, 아직 실제 폴더를 안 고른 기본 상태)에는 적용되지 않습니다.
- **헤더의 "가져오기" 버튼은 이제 "블로그에서 가져오기" 전용입니다**: 예전의 3카드 허브
  (`ImportHubModal`: 불러오기/미디어 라이브러리/블로그에서 가져오기)를 완전히 제거하고,
  헤더 버튼 하나가 곧바로 `BlogImportModal`을 엽니다(`setModal('blog-import')`). "미디어
  라이브러리"는 헤더에서 사라졌지만 기능 자체는 그대로 남아있고, `SceneEditor`의 "미디어
  라이브러리에서 변경" 링크(`setModal('media')`)로 계속 열 수 있습니다.
- **"새 프로젝트"는 그대로 유지**: 여전히 전역 저장 폴더 안 `KWJMvideoAI_data/projects/<이름>.json`에
  이름을 붙여 스냅샷을 저장할 수 있습니다(`store.saveNamedProject`, `NewProjectModal`). 다만
  그렇게 저장한 이름 붙은 프로젝트를 목록에서 골라 "불러오는" UI는 없어졌습니다 — 필요하면
  `store.listNamedProjects`/`loadNamedProject`/`deleteNamedProject`가 스토어에 여전히 남아있으니
  이를 다시 노출하는 UI를 새로 만들 수 있습니다(현재는 어떤 화면도 호출하지 않는 상태).
- **새 기능을 추가할 때 이 모델을 깨지 마세요**: "여러 프로젝트 중 하나를 고르는 화면"을
  다시 만들고 싶다면, 최소한 "폴더 연결 = 그 폴더 프로젝트 자동 오픈" 동작은 그대로 둔 채
  추가하세요(사용자가 명시적으로 "여러 프로젝트를 관리하고 싶다"고 요청하기 전까지는).

### 4.6 장면당 사진/영상은 항상 최대 1개 (2026-08-02 추가 — 핵심 불변식)

**한 장면(Scene)에는 사진이든 영상이든 최종적으로 하나만 등록될 수 있습니다.** 예전에는
`applyImageToScene`/`applyLocalVideoToScene`/`uploadPhotoToScene`/`uploadVideoToScene`가 서로
다른 필드(`photoRef`+`localImageName` vs `localVideoName`+`localVideoUrl`)만 갱신하고 반대쪽
필드를 지우지 않아서, 사진을 적용한 뒤 영상을 적용하면(혹은 그 반대) 두 참조가 동시에 남아
장면 카드에 "사진 배지"와 "영상 배지"가 함께 뜨는 등 타임라인에 중복 등록된 것처럼 보이는
버그가 있었습니다. **이 네 함수는 전부 자신과 반대되는 미디어 타입의 필드를 항상 함께
지우도록 고쳐졌습니다** — 새로운 미디어 적용/업로드 함수를 추가하거나 이 함수들을 리팩터링할
때 이 불변식을 절대 깨지 마세요.

- **토글(등록 취소)**: `store.clearSceneMedia(id)`가 장면의 `photoRef`/`localImageName`/
  `localVideoName`/`localVideoUrl`/`sourcePostId`/`sourceMediaId`를 전부 비웁니다.
  `RecommendPanel`(`components/AppRoot.tsx`)의 "이 장면 전용 등록" 썸네일과 AI 추천 4칸
  양쪽 모두, 이미 적용된 항목을 다시 누르면 이 함수를 호출해 등록을 취소합니다(토글). 다른
  항목을 누르면 위 불변식 덕분에 store가 알아서 기존 것을 대체하므로 별도 처리가 필요 없습니다.
- **등록 버튼은 사진/영상 통합 1개**: `RecommendPanel`의 "등록" 버튼은 `accept="image/*,video/*"`
  하나의 파일 입력만 가지고, 고른 파일의 MIME 타입으로 사진/영상 여부를 스스로 판별합니다
  (`handleRegisterFile`). 사진용/영상용 버튼을 다시 둘로 나누지 마세요 — 요청사항이었습니다.
- **영상은 재생시간이 실제 영상 길이에 자동 고정됩니다**: `store/useStore.ts`의
  `getVideoDurationSeconds(url)`가 숨은 `<video>` 엘리먼트로 실제 재생 길이를 읽어,
  `applyLocalVideoToScene`/`uploadVideoToScene`가 `scene.duration`을 그 값으로 그대로
  덮어씁니다(0.1초 단위 반올림). 이 값은 **아래 재생시간 슬라이더의 10초 상한과 무관하게**
  적용됩니다(제한 시간보다 긴 영상도 영상 길이 그대로 씁니다). `SceneEditor`는
  `scene.localVideoUrl`이 있으면 재생시간 슬라이더를 `disabled`로 잠그고 "영상 길이에 고정"
  안내문을 보여줍니다 — 사진으로 바꾸면(위 불변식에 따라 `localVideoUrl`이 지워지므로) 다시
  직접 조절할 수 있게 됩니다.
- **재생시간 슬라이더 범위**: 2026-08-02부터 `min=0.1, max=10, step=0.1`입니다(예전에는
  `min=1, max=20`, 정수만). `lib/subtitles.ts`의 `MAX_AUTO_SCENE_SECONDS`(AI가 자동으로
  스토리보드를 만들 때 씬에 붙이는 재생시간의 상한)도 20→10으로 함께 낮춰서, AI가 만든
  값도 항상 슬라이더 범위 안에 들어오도록 맞췄습니다. 이 두 상수(슬라이더 max, `MAX_AUTO_SCENE_SECONDS`)는
  같이 바꾸세요 — 둘 중 하나만 바꾸면 AI가 만든 재생시간이 슬라이더에서 잘리거나 어긋나 보입니다.

### 4.7 장면 미리보기 화면비율 처리 — `MediaFrame` (2026-08-02 추가)

요청사항: "가로 사진/영상은 가로가 꽉 차게, 세로 사진/영상은 세로가 꽉 차게 해서 내용이 전부
보이게 하고, 빈 공간(레터박스/필러박스)은 첫 프레임을 스크린샷 찍어 흐리게 채운다."

`components/AppRoot.tsx`의 `MediaFrame` 컴포넌트(`SceneEditor`의 큰 미리보기 영역에서 사용)가
이를 구현합니다:

- 실제 컨텐츠는 `object-contain`으로 렌더링합니다. `object-contain`은 원본 가로세로 비율을
  유지한 채 부모(16:9 `aspect-video`) 안에 맞추므로, 가로로 넓은 미디어는 자동으로 가로가
  꽉 차고(위아래 여백), 세로로 긴 미디어는 세로가 꽉 차게(좌우 여백) 배치되어 **잘리는 부분
  없이 항상 전체 내용이 보입니다.** (예전에는 `object-cover`를 써서 화면비율이 다른 미디어의
  일부가 잘려 나갔습니다.)
- 그 여백(레터박스/필러박스)을 검은 배경 그대로 두지 않고, 같은 미디어의 첫 프레임을 캡처해
  확대(`scale-110`)·블러(`blur-2xl`) 처리한 것을 배경 레이어로 깔아 채웁니다.
  - 사진은 그 자체가 이미 "첫 프레임"이라 바로 블러 배경으로 씁니다.
  - 영상은 숨겨진 `<video>` 엘리먼트를 하나 더 만들어 `currentTime = 0.05`로 이동한 뒤
    `<canvas>`에 그려서 `toDataURL('image/jpeg', 0.7)`로 정지 이미지를 "스크린샷"처럼
    캡처합니다(실제로 재생되는 컨트롤 있는 영상과는 별개의 인스턴스라 서로 간섭하지 않습니다).
    캡처에 실패해도(코덱/브라우저 제약 등) 전체 기능이 깨지지 않도록 검은 배경으로 조용히
    대체됩니다.
- **적용 범위는 스토리보드 편집기 화면뿐입니다.** MP4 내보내기(`app/api/export/video/route.ts`의
  실제 ffmpeg 렌더링)는 이번 변경에 포함되지 않았습니다 — 요청사항이 "스토리보드 편집기에서"로
  명시되어 있었기 때문입니다. 최종 MP4 출력에도 같은 레터박스+블러 배경 처리가 필요하다면,
  ffmpeg 필터 그래프에 `scale`(비율 유지) + `boxblur`/`gblur` + `overlay`를 추가하는 별도
  작업이 필요합니다(현재는 여전히 화면을 꽉 채우는 단순 스케일/크롭 방식일 가능성이 높으니
  이 부분을 건드리기 전에 `route.ts`의 현재 필터 체인을 먼저 확인하세요).

### 4.8 저장 폴더 연결 해제 / 재연결 안전장치 (2026-08-02(2) 버그 수정 — 반드시 유지할 것)

**증상**: 저장 폴더 연결을 해제한 뒤 "새 폴더"로 다시 연결하려 하면 브라우저 탭/창이 강제로
닫혔고, 브라우저를 다시 열어 연결을 시도해도 같은 문제가 계속 반복됐습니다.

**원인 ①**: `disconnectSaveFolder()`가 메모리 상태(`saveDirHandle` 등)만 지우고, IndexedDB에
남아있는 "기억해둔 폴더" 참조(`rememberDirectoryHandle`/`REMEMBERED_SAVE_DIR_KEY`, `lib/fsAccess.ts`)는
그대로 두고 있었습니다. 그 결과 연결 해제 후 다시 폴더 연결 화면(`FolderConnectGate`)으로 가면
`rememberedSaveDirName`이 여전히 남아있어, 화면이 항상 "이전 폴더로 다시 연결"만 시도했고 진짜
"새 폴더 선택" 창을 열 방법이 없었습니다. 그 "기억된 폴더"가 이동/삭제/손상된 상태면, 재연결
시도 자체가 반복적으로 실패하며 문제로 이어질 수 있었습니다.

**원인 ②**: 기억된 폴더로 자동 재연결(`initStorage()`)을 시도하는 도중에 탭/브라우저가 죽어버리면,
다음에 앱을 다시 열 때도 똑같이 그 폴더로 자동 재연결을 또 시도해서 같은 문제가 매번 반복될 수
있는 구조였습니다.

**적용한 수정** (`store/useStore.ts`, `components/AppRoot.tsx`):

- `disconnectSaveFolder()`가 이제 `forgetRememberedDirectoryHandle(REMEMBERED_SAVE_DIR_KEY)`를
  함께 호출하고 `rememberedSaveDirName`도 `null`로 초기화합니다. 연결을 끊으면 다음엔 항상
  "새 폴더 선택" 창이 바로 뜹니다.
- `initStorage()`에 재연결 진행 플래그(`RECONNECT_IN_PROGRESS_KEY`, `localStorage`)를 추가했습니다.
  기억된 폴더로 자동 재연결을 **시도하기 직전**에 이 플래그를 `'1'`로 저장하고, 성공/실패가
  **확정된 뒤**에만 지웁니다. 다음 실행 때 이 플래그가 여전히 남아있으면(=지난번 시도가 끝까지
  완료되지 못했다는 신호) 이번에는 같은 폴더로 자동 재시도하지 않고 `forgetRememberedDirectoryHandle()`로
  기억해둔 폴더 참조까지 함께 지운 뒤 포기합니다 — 문제 있는 폴더에 계속 갇히지 않기 위함입니다.
  `sessionStorage`가 아니라 `localStorage`를 쓰는 이유는 탭이 죽는 경우 `sessionStorage`도 함께
  사라져 신호가 남지 않기 때문입니다.
- `FolderConnectGate`(폴더 연결 화면)와 `SaveFolderOfflineBanner`(상단 경고 배너) 양쪽에
  "다른(새) 폴더 선택하기" 버튼을 추가했습니다. 내부적으로 `disconnectSaveFolder()`로 기억해둔
  참조를 먼저 지운 뒤 `connectSaveFolder()`(폴더 선택 다이얼로그)를 엽니다 — 문제 있는 폴더에
  갇혔을 때 언제든 탈출할 수 있는 명시적인 진입점입니다.

**앞으로 이 영역을 손볼 때 지킬 것**: 저장 폴더 관련 상태를 지우는 새 코드를 추가할 때는
`saveDirHandle` 같은 메모리 상태와 `REMEMBERED_SAVE_DIR_KEY`(IndexedDB) 같은 영속 참조를
**항상 짝지어** 정리하세요. 하나만 지우면 화면 상태와 실제로 기억된 폴더가 어긋나는 이번과
같은 버그가 다시 생깁니다.

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

## 5.3 타임라인 전체 AI 생성 (2026-08-02 추가)

이미 여러 장면에 사진/영상이 등록되어 있고 제목·나레이션·대사만 AI로 다시 쓰고 싶을 때 쓰는
기능입니다. `EditorInterface`의 타임라인 패널(좌측) 헤더 바로 아래 "텍스트 AI로 생성" 버튼이
이를 실행합니다(`handleGenerateAllScenes`).

- **한 번의 요청으로 전체 장면을 함께 보냅니다.** `SceneEditor`의 장면별 "AI 재생성"
  (`regenerateSceneNarration`)은 장면 하나씩만 다시 쓰므로 앞뒤 문맥을 모릅니다. 반면
  `lib/llm.ts`의 `regenerateAllScenesForTimeline({ scenes, settings })`는 **모든 장면의 목록을
  순서대로 한 프롬프트에 실어** LLM에 보내, "하나의 영화·다큐멘터리처럼 이어지는 이야기"를
  쓰도록 지시합니다(요청사항). 장면을 하나씩 반복 요청하는 방식으로 리팩터링하지 마세요 —
  그러면 다시 앞뒤 문맥이 끊깁니다.
- **미디어 근거는 파일명뿐입니다.** 아래 섹션(현재 10번, "알려진 제약")에 설명된 대로 현재
  연결 가능한 LM Studio 모델은 텍스트 전용이라 사진/영상을 실제로 "보지" 못합니다.
  `describeSceneMedia()`가 각 장면의 `localVideoName`/`localImageName`/`photoRef` 유무로
  "사진"/"영상"/"없음"만 판별해 파일명과 함께 프롬프트에 실어줍니다 — 이 프로젝트의 다른
  스토리보드 생성 함수들과 동일한 설계 원칙입니다(추측성 실제 사실 창작 금지, 분위기 있는
  서술은 허용).
- **결과는 항상 안전합니다.** 반환 배열은 입력 `scenes`와 길이·순서가 항상 같고
  (`generateJsonWithGuaranteedFallback` 재사용), LLM 호출이 실패하면 각 장면의 기존
  제목/나레이션/대사를 그대로 돌려주는 폴백을 씁니다 — 즉 이 버튼을 눌러서 장면이 비거나
  사라지는 일은 없습니다.
- **적용은 한 번의 스토어 액션으로 처리합니다.** 장면 수만큼 `updateScene()`을 반복 호출하면
  자동저장/수정이력이 그만큼 여러 번 트리거되므로, `store.applyBulkSceneContent(updates)`를
  새로 추가해 모든 장면을 한 번의 `set()`으로 갱신하고 수정이력 한 줄 + 자동저장 한 번만
  발생하도록 했습니다. 비슷한 "여러 장면 일괄 수정" 기능을 추가할 때 이 패턴을 재사용하세요.


## 6. 블로그 데이터 연동 (경우정민 블로그 프로젝트 읽기)

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
- **`yarn install`/`yarn build` 검증 상태**: 2026-08-01, 2026-08-02 세션 모두 네트워크가 열려있어
  `npm install`(또는 `yarn install`) 후 `npx tsc --noEmit` + `next build`까지 실행해 정상 빌드를
  확인했습니다. 다만 실제 LM Studio 서버 연결, 실제 브라우저의 File System Access API 동작,
  실제 FFmpeg 렌더링은 매번 사람이 실기기에서 확인해야 합니다(자동화된 E2E 테스트 없음).
- **MP4 내보내기에는 미리보기의 레터박스+블러 배경 처리가 없습니다**: 섹션 4.7의 `MediaFrame`
  (가로/세로 화면비율에 맞춰 여백을 블러 배경으로 채우는 처리)은 스토리보드 편집기 화면에만
  적용되어 있고, 실제 MP4 렌더링(`app/api/export/video/route.ts`)에는 적용되지 않았습니다
  (요청 범위가 "스토리보드 편집기에서"로 명시되어 있었기 때문). 최종 영상에도 같은 처리가
  필요하면 ffmpeg 필터 그래프에 blur 배경 합성을 추가하는 별도 작업이 필요합니다.

## 11. 코딩 컨벤션

- 모든 사용자 대면 텍스트는 한국어입니다. 새 UI 문구도 한국어로 작성하세요.
- 다크모드는 Tailwind `dark:` variant + `darkMode` prop을 함께 씁니다 (컴포넌트마다 `cn(darkMode ? '...' : '...')`
  패턴이 반복됩니다). 새 컴포넌트도 이 패턴을 따르세요.
- `Scene`, `Project`, `ChatMessage`, `EditLogEntry` 타입은 모두 `store/useStore.ts`에 정의되어 있습니다.
- File System Access API 관련 타입은 브라우저 표준 lib에 아직 없는 경우가 많아 `any`를 의도적으로
  사용합니다 (`lib/fsAccess.ts` 상단 주석 참고). 이건 실수가 아니라 의도된 선택입니다.
- 새로 만드는 저장 관련 함수는 `lib/fsAccess.ts`(순수 파일시스템 유틸)와 `store/useStore.ts`
  (앱 상태 + 언제 저장할지 판단)의 역할 분리를 유지하세요.

## 12. 개발 환경 제약 (세션마다 다를 수 있음)

이 프로젝트를 처음 만든 샌드박스 환경은 **npm 레지스트리에 네트워크 접근이 차단**되어 있어서
`yarn install`/`yarn build`로 끝까지 검증하지 못하고 구문 검사(esbuild/`tsc` transpile)로만
확인했던 세션들이 있었습니다(2026-07-20 ~ 2026-07-23 기록 참고). **2026-08-01, 2026-08-02
세션은 네트워크가 열려 있어 `npm install`(또는 `yarn install`) 후 `npx tsc --noEmit`과
`next build`까지 실제로 실행해 성공을 확인했습니다.** 즉 네트워크 제약은 이 프로젝트의
고정 속성이 아니라 세션(샌드박스)마다 다를 수 있는 조건입니다:

- **다음에 이 프로젝트를 여는 AI(또는 사람)는 가장 먼저 `yarn install && yarn build`(또는
  `npm install && npx next build`)를 실행해서 실제로 빌드가 되는지 확인하세요.** 네트워크가
  막힌 샌드박스라면 최소한 `npx tsc --noEmit`으로 구문+타입 오류라도 잡아두세요. 문제가 있다면
  대부분 import 경로나 타입 사소한 불일치일
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
- **2026-07-27**: (참고: 직전 세션 요약에 "system 메시지 병합/빈 응답 처리/폴더 배너/사진
  업로드를 이미 구현했다"는 내용이 있었지만, 실제 코드(`lib/llm.ts`, `store/useStore.ts`)를
  확인해보니 전혀 반영되어 있지 않았습니다 — 이번 세션에서 실제로 처음부터 구현했습니다.)
  사용자가 보고한 문제를 다음과 같이 수정:
  1) **블로그 가져오기 → 스토리보드 생성 시 LM Studio 400 "Unable to generate parser..."
     오류** — 원인은 기본 시스템 프롬프트 + 블로그 컨텍스트(+ 대화가 길 때 히스토리 생략
     안내)까지 system 역할 메시지를 2~3개 함께 보내고 있었기 때문. 일부 로컬 모델
     (Qwen3.5/3.6 계열 GGUF 양자화 등)의 채팅 템플릿(Jinja)은 system 메시지가 2개 이상이면
     `raise_exception`으로 강제 실패하는 알려진 LM Studio/llama.cpp 쪽 문제가 있음.
     `lib/llm.ts`에 `mergeSystemMessages()` 신설, 실제 요청 직전
     `prepareMessagesForRequest()`(트리밍 + 병합)를 거치도록 `streamChat`/`chatOnce` 수정 —
     항상 system 메시지 1개만 전송됨. `describeLlmError()`에 이 오류가 계속될 경우를 대비한
     구체적인 한국어 안내(모델 템플릿 자체 문제일 수 있음, 모델 재로드/다른 모델 사용 권장)
     추가.
  2) **채팅에서 "(빈 응답을 받았습니다)" 오류** — 추론(reasoning) 계열 모델이 "생각" 단계에서
     `max_tokens` 예산을 전부 써버리고 최종 답변(content)을 한 글자도 못 내놓는 경우가
     원인 중 하나였음. `streamChat`/`chatOnce`가 `finish_reason: 'length'`나
     reasoning_content만 있고 content가 비어있는 응답을 감지해 구체적인 원인/해결책(전문가
     모드로 전환, 또는 추론 전용 모델 대신 일반 채팅 모델 사용)을 담은 오류로 던지도록 수정.
     스트리밍 채팅 기본 `max_tokens`를 700 → 1100으로 상향. `ChatInterface`의 catch 블록이
     이제 `err.message`를 그대로 보여주도록 수정(예전에는 원인과 무관하게 항상 같은 일반
     "연결 실패" 문구만 표시).
  3) **"블로그에서 가져오기" 모달의 "채팅으로 가져오기" 버튼이 화면 전환을 안 함** —
     `BlogImportModal`의 `handleApply`가 채팅 메시지만 추가하고 `setView('chat')`을 호출하지
     않아 사용자가 방금 보낸 메시지를 못 보는 문제. `setView('chat')` 호출 추가.
  4) **채팅에서 저장 폴더 연결 안내** — `ChatInterface`에 `saveDirSource === 'opfs'`(아직
     실제 폴더를 연결하지 않고 브라우저 내부 임시 저장소만 쓰는 중)일 때 표시되는 배너 신설.
     기억해둔 폴더가 있으면 "이전 폴더 다시 연결", 없으면 "저장 폴더 연결" 버튼을 보여줌
     (`connectSaveFolder`/`reconnectRememberedSaveFolder` 재사용).
  5) **스토리보드 편집기에서 사진/영상 직접 등록** — `SceneEditor`에 "사진 등록"/"영상 등록"
     버튼(숨은 `<input type="file">` 트리거) 신설. `store/useStore.ts`에
     `uploadPhotoToScene`/`uploadVideoToScene` 액션 신설 — 저장 폴더가 연결되어 있어야
     동작하며(없으면 "저장 폴더가 연결되지 않았습니다. 먼저 저장 폴더를 연결해주세요." 안내),
     선택한 파일을 실제로 `KWJMvideoAI_data/projects/<프로젝트명>/media/` 폴더에 복사해
     저장합니다 (`lib/fsAccess.ts`에 `getProjectMediaDir`/`writeBinaryFile`/
     `sanitizeProjectFolderName`/`buildUniqueMediaFileName` 신설). 프로젝트별로 폴더가 나뉘어
     있어 사용자가 탐색기에서 프로젝트별 사진/영상을 바로 찾아볼 수 있음. `resyncMediaReferences`를
     확장해 "미디어 폴더" 연결분뿐 아니라 이 프로젝트 media 폴더도 함께 확인하도록 수정하고,
     `attachSaveDir`에서 앱 상태 복원 직후 자동 호출하도록 해서 폴더를 다시 열었을 때 등록한
     사진/영상 미리보기가 정상적으로 복원됨. 저장 폴더 README(`README_CONTENT`)에도 이 폴더
     설명 추가.
  네트워크가 이번에는 열려 있어 실제로 `npm install` + `npx next build`를 끝까지 실행해
  검증했습니다 — 타입 검사 포함 빌드 성공(`✓ Compiled successfully`, 4개 페이지 정적 생성
  성공). 검증 후 `node_modules`/`.next`는 전달용 zip에서 제외했습니다. 다음에 여는 사람은
  `npm install && npm run dev`(또는 `yarn`)로 실행하면 됩니다.

## 2026-07-27(2) — 사용자 요청 6건 수정

1. **"생각(reasoning) 단계에서 토큰을 다 써버림" / "스토리보드를 만드는 중 문제가 발생했습니다"
   오류 — 압축 후 재시도로 항상 성공하도록 개선** (`lib/llm.ts`)
   - `generateJsonWithGuaranteedFallback()` 신설: 1차 시도가 실패하면(토큰 소진, 네트워크
     오류, JSON 파싱 실패 등 무엇이든) 입력을 압축(캡션/본문을 더 짧게 자르고, 대화 기록을
     최근 8개로 줄이고, "문자열 안에 줄바꿈 금지" 지침 추가)한 뒤 전문가 모드 수준으로 토큰
     예산을 늘려 2차 시도. 그래도 실패하면 절대 예외를 던지지 않는 로컬 폴백(장면을 채팅
     메시지/캡션에서 직접 구성)으로 마무리해 사용자에게는 항상 결과가 돌아가도록 함.
   - **정상적으로 한 번에 성공하는 대다수의 경우 추가 호출이 전혀 없으므로 속도 저하 없음**
     (재시도는 실패했을 때만 추가로 발생).
   - `generateStoryboardFromChat`/`generateStoryboardFromMedia`/`generateStoryboardFromPosts`
     모두 이 로직으로 교체.

2. **"Expected ',' or '}' after property value in JSON..." 오류 — JSON 파싱 견고화**
   (`lib/llm.ts`)
   - `extractJsonArray()`를 3단계 복구 로직으로 교체: ① 있는 그대로 파싱 시도 → ②
     문자열 값 안의 이스케이프 안 된 개행/탭을 이스케이프 + trailing comma 제거 후 재시도
     (로컬 모델이 나레이션에 실제 줄바꿈을 그대로 넣어 깨지는 경우가 원인) → ③ 그래도
     실패하면 문자열 밖에서 중괄호 깊이를 직접 추적해 "온전히 닫힌" 장면 객체만 순서대로
     건져냄(응답이 토큰 부족으로 중간에 잘려도 이미 완성된 앞쪽 장면은 살아남음).

3. **"미디어 폴더 연결" 개념 완전 제거 → 저장 폴더(자동 저장소 포함)와 통합**
   (`store/useStore.ts`, `components/AppRoot.tsx`)
   - `mediaDirHandle`/`mediaDirName`/`connectMediaFolder`/`disconnectMediaFolder`를 전부
     삭제. 사진/영상은 이제 예외 없이 현재 프로젝트의
     `KWJMvideoAI_data/projects/<프로젝트명>/media/` 폴더(저장 폴더 하위)에만 저장됨 —
     별도의 "미디어 폴더"라는 개념 자체가 사라짐. 브라우저 안에는 폴더 "경로"(핸들)만
     남고 실제 사진/영상 내용은 전부 사용자가 고른 폴더 안에 저장되므로 브라우저 저장
     용량이 커지지 않음.
   - `uploadPhotoToScene`/`uploadVideoToScene`/새로 만든 `addFilesToProjectMedia`는
     이제 OPFS 자동 저장소만으로는 부족하고, `saveDirSource === 'external'`(사용자가
     실제 폴더를 등록한 상태)일 때만 동작 — 아니면 "실제 저장 폴더를 먼저 등록해야
     사진/영상을 등록할 수 있습니다" 안내와 함께 거절해, 요청하신 "폴더 등록 안 하면
     기능을 못 쓰게" 동작을 구현.
   - `StorageBar`의 "미디어 폴더 연결" 버튼을 제거하고, 저장 폴더 연결 여부에 따라
     안내 문구만 보여주는 상태 표시로 교체.
   - `MediaLibraryModal`을 전면 재작업: 이제 `listProjectMediaFiles()`로 프로젝트 media
     폴더 내용을 그대로 보여주고, "사진/영상 등록" 버튼(파일 선택 → `addFilesToProjectMedia`)
     으로 새 파일을 그 폴더에 실제로 복사해 라이브러리에 추가. 폴더 미등록 시 안내 화면+
     "저장 폴더 연결하기" 버튼 표시.

4. **스토리보드 편집기 "비슷한 이미지 추천" — 블로그 사진에서 추천 + 사진 없을 때 아이콘
   표시** (`components/AppRoot.tsx`)
   - 기존에는 인터넷 스톡 사진(Unsplash)에서 무작위로 추천했는데, 실제로 가져온 블로그
     사진 중 이 장면과 어울리는 것을 골라 추천하도록 교체 (`getBlogRecommendationsForScene`
     — 같은 블로그 글 출처면 가산점, 장면 태그와 사진 캡션/위치/글 제목·태그가 겹치면
     가산점, 이미 이 장면에 쓰이고 있는 사진 자체는 제외).
   - 추천할 블로그 사진이 없으면(블로그 폴더 미연결, 사진 자체가 없음, 어울리는 사진
     없음) 각 칸에 "없음" 아이콘(`ImageOff`)과 안내 문구를 표시 — 무리하게 무관한 스톡
     사진을 보여주지 않음.
   - `applyImageToScene`에 `sourcePostId`/`sourceMediaId`를 선택적으로 함께 저장하도록
     확장해, 추천 이미지를 적용해도 출처 정보가 유지되어 다음 추천 때도 활용됨.
   - "사진 등록"/"영상 등록" 버튼은 이미 있던 기능(2026-07-27 1차 수정)을 그대로 유지 —
     사진이 많아져도 파일 선택 UI 자체는 그리드/스크롤 기반이라 문제없이 동작.

5. **프로젝트 불러오기 — 샘플 제거 + 삭제 버튼 + 폴더에서 불러올 때 JSON 대신 카드로 표시**
   (`components/AppRoot.tsx`, `store/useStore.ts`)
   - `LoadModal`에서 "샘플 프로젝트(데모)" 섹션을 완전히 제거.
   - 저장 폴더의 프로젝트 목록 각 항목에 삭제(휴지통) 버튼 추가 → 클릭 시 "삭제 확정/취소"
     인라인 확인 후 실제 파일 삭제(`deleteNamedProject` 신설, `projects/<파일명>.json`
     제거).
   - "다른 폴더에서 불러오기"로 고른 폴더의 `.json` 파일들을 더 이상 파일명 그대로 나열하지
     않고, 각 파일을 미리 읽어 제목/장면 수/수정일/썸네일이 있는 카드로 예쁘게 보여주도록
     교체. 프로젝트 형식이 아닌 파일은 "프로젝트 형식이 아닌 파일입니다"로 구분 표시.

6. **헤더 로고 클릭 → 채팅 화면으로 바로 이동** (`components/AppRoot.tsx`)
   - 헤더의 "KWJMvideoAI" 로고를 `<button>`으로 바꾸고 클릭 시 `setView('chat')` 호출.

이번에도 네트워크가 열려 있어 `npm install` → `./node_modules/.bin/tsc --noEmit`(오류 0건)
→ `npx next build`(`✓ Compiled successfully`, 4개 페이지 정적 생성 성공)까지 끝까지 돌려
검증했습니다. 검증 후 생성된 `node_modules`/`.next`/`package-lock.json`/
`tsconfig.tsbuildinfo`는 전달용 zip에서 제외했습니다(원본에는 `yarn.lock`만 있었음).

## 2026-07-27(3) — 폴더 연결이 "클릭은 되는데 진행이 안 됨" 버그 수정 + 헤더 정리 + 샘플 데이터 완전 제거

사용자가 "LM Studio/폴더 연결 상태가 헤더에 부정확하게 나온다", "폴더 연결 안 하면 나머지
기능이 막히는데, 정작 폴더 연결 버튼 자체가 진행이 안 된다", "불러오기/미디어
라이브러리/블로그에서 가져오기를 버튼 하나로", "샘플 데이터 없이 실제 데이터로만 테스트"를
요청. 실제 코드를 추적해 다음 근본 원인과 개선을 반영:

1. **핵심 버그: 저장 폴더 연결이 예외가 나면 영원히 "연결 중..."에서 멈추는 문제**
   (`store/useStore.ts`, `components/AppRoot.tsx`)
   - `connectSaveFolder()` / `reconnectRememberedSaveFolder()` / `connectBlogDataFolder()`가
     `pickDirectory()`/`verifyPermission()` 호출을 try/catch로 감싸지 않고 있었습니다.
     브라우저가 폴더 선택창을 사용자 제스처로 인식하지 못해 `SecurityError`를 던지는 등
     "취소" 외의 이유로 실패하면 이 함수들이 그대로 예외를 던졌는데, 이를 호출하는
     화면 5곳(`StorageBar`, `NewProjectModal`, `MediaLibraryModal`, `BlogImportModal`,
     채팅 화면의 폴더연결 배너)도 전부 try/catch 없이 `await`만 하고 있어서 버튼이
     "연결 중..." 스피너 상태에서 절대 풀리지 않고, 폴더도 연결되지 않은 채 남아있었습니다.
     **이것이 "폴더 연결부터 진행이 안 된다"는 증상의 실제 원인이었습니다.**
   - `describeFolderPickError()` 헬퍼 신설 — 어떤 예외가 나도 절대 throw하지 않고 사람이
     읽을 수 있는 한국어 오류 메시지로 변환해 `{ ok:false, message }`를 반환하도록
     위 3개 store 함수를 전부 try/catch로 재작성.
   - 방어적으로, 이 함수들을 호출하는 5곳의 컴포넌트 핸들러에도 try/finally를 추가해
     (store 쪽에서 놓치는 게 있더라도) busy 상태가 절대 안 풀리는 일이 없도록 이중 안전장치.

2. **LM Studio 연결 상태 배지 정확도 개선** (`components/AppRoot.tsx`의 `LlmStatusBadge`)
   - 재확인 주기를 20초 → 8초로 단축.
   - 창/탭이 다시 포커스를 받을 때(`focus`/`visibilitychange`) 즉시 재확인하도록 변경 —
     사용자가 LM Studio를 켜고 이 탭으로 돌아왔을 때 최대 8초를 기다리지 않고 바로 반영.
   - 오프라인 판정 시 이전에 남아있던 모델 목록도 함께 비워, "모델은 떠 있는데 연결은
     끊긴 것처럼 보이는" 혼란을 제거.
   - 첫 확인에서만 "확인 중..." 표시, 이후 백그라운드 재확인은 결과가 나올 때까지 이전
     상태를 유지해 배지가 매번 깜빡이지 않도록 함.

3. **헤더 정리 — "불러오기" + "미디어 라이브러리" + "블로그에서 가져오기"를 버튼 하나로 통합**
   (`components/AppRoot.tsx`)
   - 새 `ImportHubModal` 신설. 헤더의 세 버튼을 "가져오기" 버튼 하나로 교체하고, 클릭하면
     이 허브 모달에서 세 기능을 카드로 골라 들어가도록 변경(`modal: 'import'` 신설,
     `ModalState`에 추가). 각 카드에 지금 상태(예: "실제 저장 폴더를 먼저 연결해야
     사용할 수 있습니다")를 미리 보여줘서 들어갔다가 다시 나오는 일을 줄임.
   - 채팅/에디터 화면 안에서 문맥상 바로 여는 "미디어 라이브러리에서 변경",
     "블로그에서 가져오기" 같은 딥링크 버튼들은 그대로 유지(그 자리에서 바로 여는 게
     자연스러운 경우이므로).

4. **샘플/데모 데이터 완전 제거**
   - `store/useStore.ts`의 `SAMPLE_SCENES`/`SAMPLE_PROJECT`/`SAMPLE_PROJECTS`와, 실제로는
     어디서도 렌더링에 쓰이지 않던 죽은 상태 `savedProjects`/`setSavedProjects`를 삭제.
   - `public/sample-media/`, `public/sample-blog-data/` 폴더를 저장소에서 완전히 삭제
     (코드 어디에서도 이 경로들을 참조하지 않는 것을 grep으로 확인했습니다). 이제 이
     프로젝트에는 코드/에셋 어디에도 샘플 데이터가 남아있지 않고, 모든 프로젝트/장면/
     블로그/미디어는 사용자가 연결하는 실제 폴더의 실제 파일에서만 만들어집니다.

네트워크가 열려 있어 `npm install` → `./node_modules/.bin/tsc --noEmit`(오류 0건) →
`npx next build`(`✓ Compiled successfully`, 4개 페이지 정적 생성 성공)까지 끝까지 검증했습니다.
다만 이번에도 실제 LM Studio/실제 폴더를 켠 브라우저 기기에서의 최종 확인(설정 → LM Studio
연결 확인, 헤더에서 폴더 연결 버튼 클릭 → 실제 탐색기 폴더 선택창이 뜨는지)은 사용자가 직접
실기기에서 해주셔야 합니다.

## 2026-07-27(4) — 편집기 폴더 게이팅 + LM Studio 배지 버그 수정 + 가져오기 뒤로가기 + 비슷한 이미지 추천 개편

사용자 요청 5가지를 반영:

1. **스토리보드 편집기, 폴더 미연결이면 화면 자체를 숨김** (`components/AppRoot.tsx`)
   - `EditorInterface`가 실제 저장 폴더(`saveDirSource === 'external'`) 연결 여부를 받아,
     연결 전에는 편집기 내용 대신 새 `EditorFolderGate` 잠금 화면(폴더 연결 버튼 포함)을
     보여주도록 변경. store가 반응형이라 연결에 성공하는 순간 같은 렌더에서 바로 편집기가
     나타나고, 채팅 화면은 기존처럼 계속 사용 가능합니다(배너로 안내만 함).
   - 헤더의 "스토리보드 편집기" 버튼에도 폴더 미연결 시 자물쇠 아이콘 표시.

2. **LM Studio 연결 확인이 "꺼져 있는데도 성공"으로 나오는 버그 수정** (`app/api/llm/health/route.ts`)
   - 원인: 서버 쪽 `fetch(\`${baseUrl}/models\`)`에 캐시 옵션을 지정하지 않아, 예전에
     LM Studio가 켜져 있었을 때의 성공 응답을 Next.js가 재사용할 수 있었습니다. 이 fetch에
     `cache: 'no-store'`를 명시해 항상 새로 확인하도록 수정.
   - 응답이 200이어도 실제 OpenAI 호환 `/models` 목록(`data.data`가 배열) 형태가 아니면
     실패로 처리하도록 검증 강화(다른 서버가 그 포트에 우연히 응답하는 경우 대비).

3. **가져오기 허브 → 하위 모달(불러오기/미디어 라이브러리/블로그에서 가져오기)에 뒤로가기 버튼**
   (`components/AppRoot.tsx`)
   - `LoadModal`, `MediaLibraryModal`, `BlogImportModal`에 `onBack?` prop 추가, 헤더 좌측에
     ← 버튼 표시. `가져오기` 허브에서 들어간 경우 눌러서 카드 목록으로 바로 돌아갈 수 있음
     (닫았다가 다시 여는 것보다 편리).

4. **"비슷한 이미지 추천" 개편 — 프로젝트 미디어 분석 캐시 + 장면 전용 등록** (`store/useStore.ts`, `lib/fsAccess.ts`, `components/AppRoot.tsx`)
   - `lib/fsAccess.ts`: `getProjectDir()` 신설, `MEDIA_ANALYSIS_FILE_NAME`
     (`media_analysis.json`) 상수 추가 — 프로젝트 폴더 안 `media/`와 나란히 저장됩니다.
   - `store/useStore.ts`: `MediaAnalysisEntry` 타입, `mediaAnalysisCache` 상태,
     `ensureProjectMediaAnalysis()` 액션 신설. 저장 폴더가 연결돼 있으면 프로젝트 `media/`
     폴더의 각 파일을 크기+수정시각으로 이전 분석 결과와 비교해, 바뀌지 않은 파일은
     `media_analysis.json`에 이미 있는 데이터를 그대로 재사용하고, 새 파일만 새로 분석해
     저장 폴더에 다시 저장합니다. (현재 연결 가능한 LM Studio 모델은 텍스트 전용이라 실제
     비전 인식은 하지 못하므로, agent.md 10절과 같은 원칙으로 파일명 기반 태그/설명
     휴리스틱을 "분석 결과"로 사용 — `analyzeMediaFileName()`. 나중에 비전 모델을 붙이면
     이 함수만 교체하면 됩니다.)
   - `Scene`에 `pinnedMediaPaths?: string[]` 필드 추가 — "비슷한 이미지 추천" 패널에서 이
     장면 전용으로 등록한 미디어 파일 경로만 담아, 다른 장면의 추천 패널에는 나타나지
     않게 함(기존 프로젝트 저장 형식과 그대로 호환 — 필드가 없으면 빈 배열로 처리).
   - `components/AppRoot.tsx`의 `RecommendPanel` 전면 개편:
     - "사진 등록"/"영상 등록" 버튼을 새로고침 버튼 왼쪽으로 이동(기존에는 `SceneEditor`
       미리보기 아래에 있었음 — 그쪽 코드는 제거).
     - 등록한 파일은 프로젝트 media 폴더에 저장되는 동시에 `scene.pinnedMediaPaths`에
       기록되어, 이 장면의 추천 패널 상단에 "등록됨" 배지가 붙은 썸네일로 바로 나타나고
       클릭하면 스토리보드(현재 장면)에 적용됩니다.
     - 새로고침 버튼은 아래쪽 AI 추천 4칸만 다시 불러오고, "등록됨" 썸네일은 그대로 유지.
     - AI 추천 4칸은 `ensureProjectMediaAnalysis()` 결과(태그/캡션)와 장면의 태그·제목을
       비교해 점수가 높은 순으로 채우고, 프로젝트 미디어가 없으면 기존 블로그 기반 추천으로
       자동 대체합니다.

이번 세션은 네트워크가 열려있지 않아 `npm install`/`next build`로 끝까지 빌드 검증은 하지
못했습니다. 대신 TypeScript 컴파일러(`typescript` 패키지)의 `transpileModule`로 수정한 4개
파일(`components/AppRoot.tsx`, `store/useStore.ts`, `lib/fsAccess.ts`,
`app/api/llm/health/route.ts`) 모두 구문 오류 없음을 확인했습니다 — 다만 이는 문법 검사이지
`next build`가 하는 전체 타입 검사(다른 파일과의 타입 정합성 등)는 아니므로, 다음에 네트워크가
열린 세션에서 `npm install && npx tsc --noEmit && npx next build`로 한 번 더 검증하는 것을
권장합니다.

## 2026-07-28 — 채팅도 저장 폴더 게이팅 적용 + LM Studio "생각 중 토큰 소진" 버그/속도 개선

사용자 피드백: "스토리보드 편집기는 폴더 연결 안내가 잘 나오는데 채팅은 폴더 연결 없이도
그냥 진행된다. 채팅도 편집기처럼 저장 폴더를 먼저 연결하라고 나와야 한다(폴더가 연결돼야
채팅 내용이 폴더에 JSON으로 저장되기 때문)." + "몇 글자만 입력해도 '생각 단계에서 토큰을
모두 써버렸다'는 오류가 뜬다. 이 문제도 고치고 LLM 응답 속도도 개선해달라."

1. **채팅 화면도 저장 폴더 연결 전에는 숨김** (`components/AppRoot.tsx`)
   - 어제(2026-07-27(4)) 편집기에 추가했던 잠금 화면(`EditorFolderGate`)을 범용
     `FolderConnectGate({darkMode, title, description})`로 일반화해서 편집기/채팅 둘 다
     재사용하도록 변경.
   - `ChatInterface`도 이제 `saveDirSource === 'external' && saveDirHandle`이 아니면
     채팅 UI 전체 대신 "채팅을 시작하려면 저장 폴더를 먼저 연결하세요" 화면을 보여줍니다.
     연결되는 순간 store가 반응형이라 바로 채팅 화면이 나타납니다.
   - 기존에 채팅 화면 안에 있던 "아직 실제 폴더를 연결하지 않아 임시 저장소만 쓰고
     있어요" 주황색 배너(및 관련 `saveFolderBusy`/`saveFolderNotice`/
     `handleConnectSaveFolderFromChat`)는 이제 항상 폴더가 연결된 상태에서만 채팅 화면에
     들어오므로 절대 보일 일이 없어 완전히 제거했습니다(죽은 코드 정리).

2. **"몇 글자만 입력해도 생각 단계에서 토큰을 다 써버림" 버그 + 응답 속도 개선** (`lib/llm.ts`)
   - 근본 원인: 이 프로젝트 기본 모델(Qwen3 계열)은 답변 앞에 항상 "생각(thinking)" 블록을
     먼저 생성하는데, 이 생각 단계의 길이는 사용자 입력 길이와 무관합니다. 인사 한마디에도
     수백~수천 토큰을 생각에 쓰고 나면 `max_tokens` 예산이 바닥나 실제 답변이 한 글자도
     못 나오는 경우가 흔했습니다.
   - **속도+안정성 근본 해결책**: Qwen3가 공식 지원하는 `/no_think` 지시어를 "빠른모드"/
     "보통모드"에서는 매 요청의 마지막 사용자 메시지 끝에 자동으로 붙여 생각 단계 자체를
     건너뛰게 했습니다(`applyThinkingDirective()`, `prepareMessagesForRequest()`가 이제
     `mode`를 받습니다). "전문가모드"(더 자세한 결과 원함)에서는 기존처럼 생각을 허용합니다.
     생각을 건너뛰면 그만큼 응답도 훨씬 빨라집니다.
   - **안전망**: `/no_think`를 지시했는데도 일부 모델/설정이 계속 생각만 하다가 예산을 다
     써버려 답변이 완전히 비어 있는 경우, 예전에는 바로 사용자에게 오류를 보여줬지만
     이제는 훨씬 큰 예산(기존의 3배, 최대 8000토큰)으로 **자동으로 한 번 더 재시도**한
     뒤에도 실패해야만 오류 메시지를 보여주도록 `streamChat()`을 재구성했습니다
     (`attemptStreamChat()` 헬퍼로 한 번의 시도 로직을 분리하고, 재시도 로직을 추가).
   - `chatOnce()`(스토리보드 JSON 생성, 나레이션 재생성 등)에도 동일하게 `mode`를 넘겨
     `/no_think`가 적용되도록 했습니다 — 스토리보드 생성 쪽은 이미 실패 시 더 큰 예산의
     "전문가모드"로 한 번 더 시도하고, 그래도 안 되면 대화 내용을 그대로 장면으로 바꾸는
     3단계 안전망(`generateJsonWithGuaranteedFallback`)이 있어 그대로 두었습니다.

이번 세션도 네트워크가 열려있지 않아 TypeScript `transpileModule` 구문 검사만
(`components/AppRoot.tsx`, `store/useStore.ts`, `lib/fsAccess.ts`, `lib/llm.ts`,
`app/api/llm/health/route.ts` 전부 통과) 진행했고, `next build`로 끝까지 검증하지는
못했습니다. 다음에 네트워크가 열린 세션에서 `npm install && npx next build`로 한 번
확인해보시길 권장드립니다. 또한 실제 LM Studio에서 `/no_think` 지시어가 잘 인식되는지
(Qwen3 계열이 아닌 다른 모델을 쓰는 경우 이 지시어가 텍스트로 그대로 노출될 수 있음)는
실기기에서 확인이 필요합니다.

## 2026-08-01 — 블로그 오디오 데이터 불러오기 + 장면 제목/대사 AI 생성 + 태그 UI 제거 +
이미지 권장 크기 안내 + 채팅기록 초기화 버튼 + 저장 폴더 연결 끊김 자동복구/배너 +
내보내기 개편(스크립트 명칭/미디어 ZIP/저장 위치 선택)

사용자 피드백 요약: (1) 블로그 데이터 중 오디오가 통째로 안 불러와짐, (2) 채팅 탭에
채팅기록 초기화 버튼이 필요함, (3) 장면 나레이션 AI 재생성이 실제로는 연결되어 있는데도
"LM Studio에 연결하지 못했습니다"만 뜸 + 제목/대사도 AI 생성 가능해야 함 + 태그 UI 제거,
(4) "비슷한 이미지 추천" 쪽에 권장 이미지 px 크기 안내 필요, (5) 저장 폴더 연결이 중간에
끊겨도 표시가 잘 안 됨 — 임시저장 신뢰성을 높여야 함, (6) 채팅으로 스토리보드 만들 때
블로그 사진이 잘 들어가야 함, (7) 내보내기: "텍스트 스크립트"→"스크립트" 명칭 변경,
이미지/영상 파일도 ZIP으로 내보내기, 다운로드 위치를 물어보고(기본 바탕화면) 폴더에
중복 저장하지 않기, "참고용 경로 메모" 삭제.

1. **블로그 오디오 데이터 불러오기** (`lib/blogData.ts`, `lib/llm.ts`, `components/AppRoot.tsx`)
   - 블로그(KWJMTORY)는 `<audio>` 태그와 `media-meta.json`의 `type: 'audio'`를 실제로
     쓰는데(`src/app/lib/mediaMeta.ts`, `audioExtension.ts`), AIvideo 쪽 `parseMediaTagsFromContent`는
     `<img|video>`만 인식해 오디오 캡션/날짜가 통째로 누락되고 있었습니다. `BlogMediaMeta.type`을
     `'image' | 'video' | 'audio'`로 넓히고 태그 정규식에 `audio`를 추가해 실제로 불러오도록
     고쳤습니다.
   - 오디오는 장면의 사진/영상 자리에 쓸 수 없으므로(재생 미리보기가 아니라 `<img>`/`<video>`로
     렌더링되는 자리), 아래 지점들을 함께 방어적으로 고쳤습니다 — 그러지 않으면 오디오가
     "사진"으로 오인되어 깨진 썸네일/장면이 생길 수 있었습니다.
     - `BlogImportModal`의 글 목록 썸네일(`firstMedia`)이 오디오를 고르지 않도록 이미지/영상만
       필터링, "사진/영상 N개" 카운트에서 오디오를 분리해 별도 표기("오디오 N개").
     - `handleBuildStoryboardFromBlog`(AI로 바로 스토리보드 만들기)에서 오디오를 시각 미디어
       목록에서 제외해, 오디오만 있는 글이 올바르게 "본문 기반 장면"(textOnlyPosts) 경로로
       가도록 수정. 그 글에 오디오 캡션이 있으면 본문 요약에 덧붙여 정보 손실 없이 반영.
     - `lib/llm.ts`의 `buildBlogContextText`가 오디오를 "오디오(사진/영상 아님, mediaId로
       선택 불가)"로 명확히 표시하고, `generateStoryboardFromChat`의 `validMediaIds`도
       사진/영상만 유효하도록 제한(LLM이 지침을 어기고 오디오 id를 골라도 안전하게 무시).
     - `resolveScenesWithBlogMedia`(채팅 기반 스토리보드의 장면-미디어 매칭)에서도 오디오
       mediaId는 한 번 더 걸러 2단계(블로그 사진 추천)/3단계(스톡 이미지)로 자연스럽게
       대체되도록 방어.
   - 참고: 오디오를 실제 영상에 트랙으로 합성하는 기능(내레이션/배경음악 믹싱)은 이번
     범위 밖입니다(기존에도 없던 기능이며, "모든 관련 데이터를 정확히 불러오기" 요구사항은
     캡션/날짜 등 메타데이터가 누락되지 않는 것으로 충족했습니다).

2. **헤더 채팅 탭 "채팅기록 초기화" 버튼** (`store/useStore.ts`, `components/AppRoot.tsx`)
   - `resetChatHistory()` 스토어 액션 추가 — 채팅 기록만 처음 인사 메시지로 되돌리고
     장면/프로젝트는 그대로 둡니다.
   - 헤더 우측에 `view === 'chat'`일 때만 보이는 버튼을 추가했고, 실수 방지를 위해
     프로젝트 삭제와 같은 기존 인라인 "확정/취소" 패턴을 그대로 재사용했습니다.

3. **장면 제목/나레이션/대사 AI 생성 + 실제 오류 메시지 표시 + 태그 UI 제거**
   (`lib/llm.ts`, `components/AppRoot.tsx`)
   - 버그 원인: `SceneEditor`의 AI 재생성 catch 블록이 `err.message`를 무시하고 항상
     "LM Studio에 연결하지 못했습니다..." 고정 문구만 보여주고 있었습니다(2026-07-27에
     `ChatInterface` 쪽만 이 문제를 고쳤고 `SceneEditor`는 그대로였음). 실제 원인(모델 응답
     형식 오류 등 연결과 무관한 문제)도 전부 "연결 안 됨"으로 오인됐던 원인입니다. 이제
     `err?.message`를 그대로 보여주도록 고쳤습니다.
   - `regenerateSceneNarration(params)`에 `target?: 'title' | 'narration' | 'dialogue'`를
     추가해 세 필드를 독립적으로 AI 생성할 수 있게 했고, JSON 파싱 실패 시 토큰 예산을
     늘려 한 번 더 재시도하도록 견고화했습니다(`generateJsonWithGuaranteedFallback`과
     같은 원칙). `SceneEditor`에 제목/대사 필드에도 각각 "AI 생성" 버튼을 추가(공용
     `renderAiFieldButton` 헬퍼로 결과 팝업까지 재사용).
   - 요청대로 "태그" UI(장면 편집기의 태그 입력 필드 + 미리보기 오버레이의 `#태그` 칩)를
     제거했습니다. 단, `scene.tags` 데이터 자체는 "비슷한 이미지 추천" 점수 계산
     (`scoreBlogMediaForScene`/`scoreProjectMediaForScene`)에서 조용히 쓰이고 있어 데이터
     필드/LLM 생성 로직은 그대로 두고 화면 표시만 없앴습니다(다른 기능을 건드리지 않기 위함).

4. **"비슷한 이미지 추천" 패널에 권장 이미지 크기(px) 안내** (`components/AppRoot.tsx`)
   - 패널 헤더 아래에 "가로(16:9) 1920×1080px · 세로(9:16) 1080×1920px 이상" 안내 문구를
     상시 표시하도록 추가.

5. **저장 폴더 연결 끊김에 대한 자동 복구 + 눈에 띄는 배너** (`store/useStore.ts`,
   `components/AppRoot.tsx`)
   - 문제점: `saveAllToFolder`가 권한 재확인에 실패하거나 쓰기 오류가 나면 상태 표시줄의
     작은 텍스트만 바뀌고 끝이라 놓치기 쉬웠고, 사용자가 다시 편집하기 전까지는 재시도도
     되지 않았습니다.
   - `saveAllToFolder` 실패 시 8초 뒤 자동으로 조용히 재시도하는 `scheduleErrorRetry()`를
     추가(성공하거나 폴더 연결 해제/자동저장 꺼짐 시 스스로 멈춤). 폴더가 다시 정상
     연결되면(`attachSaveDir`) 예약된 재시도는 정리됩니다.
   - `LlmOfflineBanner`와 같은 스타일의 `SaveFolderOfflineBanner`를 추가 — 실제 저장 폴더
     연결(`saveDirSource === 'external'`)에서 저장이 계속 실패할 때만 헤더 아래에 눈에 띄게
     표시되고, "다시 연결" 버튼으로 즉시 재연결을 시도할 수 있습니다.

6. **채팅으로 스토리보드 만들 때 블로그 사진 반영 확인** (`components/AppRoot.tsx`)
   - `resolveScenesWithBlogMedia`(1. 블로그 mediaId → 2. 블로그 사진 추천 → 3. 스톡 이미지
     순서로 대체)가 이미 실제 블로그 사진을 우선하도록 되어 있는 것을 확인했고, 위 1번
     오디오 관련 방어 수정으로 인해 이 우선순위가 절대 깨지지 않도록 재확인했습니다.

7. **내보내기 개편** (`components/AppRoot.tsx`, `package.json`)
   - "텍스트 스크립트" 라벨을 "스크립트"로 변경.
   - `jszip`을 추가해 새 내보내기 형식 "이미지·영상 (ZIP)"을 만들었습니다 — 각 장면에
     등록된 사진/영상 파일을 실제로 fetch해서 zip으로 묶어 내보냅니다(placeholder만 있는
     빈 장면은 자동으로 건너뜀).
   - "다운로드는 어디 저장할지 물어보고, 보통 바탕화면에 저장한다"는 요청에 맞춰
     `saveExportFile()` 헬퍼를 추가 — `showSaveFilePicker({startIn:'desktop', ...})`를
     지원하는 브라우저(Chrome/Edge)에서는 저장 위치를 직접 고르는 대화상자를 바탕화면에서
     시작하도록 띄우고, 지원하지 않으면 기존 브라우저 다운로드로 자연스럽게 대체됩니다.
     사용자가 취소하면 `ExportCancelledError`로 조용히 되돌아가고 오류 배너를 띄우지
     않습니다.
   - 이 저장 대화상자 하나로 저장이 끝나므로, 예전의 "다운로드 + 저장 폴더
     (KWJMvideoAI_data/exports/)에도 중복 저장" 체크박스(`alsoSaveToFolder`,
     `writeExportToSaveFolder`)를 완전히 제거했습니다(내보내기는 파일당 1번만 저장).
   - MP4 내보내기도 서버가 만든 mp4/srt/txt를 fetch해 같은 방식으로 저장하도록 바꿨고,
     mp4 저장을 취소하면 전체를 취소로 처리하지만 부가 파일(srt/txt)의 저장을 취소해도
     이미 저장된 mp4는 유지되도록 구분했습니다.
   - "참고용 경로 메모" 입력 필드를 완전히 삭제했습니다.

이번 세션은 네트워크가 열려 있어 실제로 `yarn install && yarn build`까지 끝까지 실행해
빌드 성공을 확인했습니다(`npm install`로 먼저 검증했다가, 이 프로젝트는 `yarn.lock` 기준
`yarn`을 쓴다는 것을 뒤늦게 확인하고 `yarn install`/`yarn build`로 다시 검증). 새로 추가한
`jszip` 의존성도 정상적으로 설치·번들링됩니다. 다만 실제 LM Studio 서버, 실제 브라우저의
`showSaveFilePicker` 대화상자 동작, 실제 블로그 폴더의 오디오 파일 데이터로 하는 수동
테스트는 이번 세션에서 하지 못했으므로, 실사용 중 이상이 있으면 알려주세요.

## 2026-08-02 — 장면당 미디어 1개 강제(중복 등록 버그 수정) + 등록 버튼 통합 + 타임라인
전체 AI 생성 + 재생시간 슬라이더 세밀화(0.1초 단위, 10초 상한, 영상 길이 고정) +
장면 미리보기 화면비율/블러 배경 처리 + 헤더 "가져오기" 단순화(폴더 연결 = 프로젝트 자동 오픈)

사용자 요청 6건을 반영했습니다. 수정 파일: `components/AppRoot.tsx`, `store/useStore.ts`,
`lib/llm.ts`, `lib/subtitles.ts`. 아래 각 항목은 자세한 설계 근거를 섹션 4.5~4.7, 5.3에도
"현재 진실"로 기록해두었으니, 다음에 관련 기능을 손볼 때는 이 changelog보다 그 섹션들을
먼저 참고하세요(이 항목은 "무엇을 왜 언제 바꿨는지"의 역사 기록입니다).

1. **장면당 사진/영상은 항상 1개만 — 타임라인 중복 등록 버그 수정** (`store/useStore.ts`)
   — 섹션 4.6 참고.
   - 원인: `applyImageToScene`가 `localVideoName`/`localVideoUrl`을, `applyLocalVideoToScene`가
     `photoRef`/`localImageName`을 서로 지우지 않아서, 사진→영상(또는 그 반대) 순서로 적용하면
     두 참조가 동시에 남아 있었습니다. 네 개 함수(`applyImageToScene`, `applyLocalVideoToScene`,
     `uploadPhotoToScene`, `uploadVideoToScene`) 모두 반대쪽 필드를 항상 함께 지우도록 수정.
   - `clearSceneMedia(id)` 신설 — 장면의 사진/영상 등록을 전부 해제(토글용).
   - `applyBulkSceneContent(updates)` 신설 — 아래 3번(타임라인 전체 AI 생성) 적용 시 장면
     여러 개를 한 번의 `set()`으로 갱신(자동저장/수정이력 1회만 발생).
   - `getVideoDurationSeconds(url)` 신설 — 숨은 `<video>` 엘리먼트로 실제 영상 길이(초)를
     읽어 `applyLocalVideoToScene`/`uploadVideoToScene`가 `scene.duration`을 그 값으로
     고정하도록 함(10초 상한과 무관, 0.1초 단위 반올림).
2. **"비슷한 이미지 추천" 패널 — 등록 취소 토글 + 등록 버튼 통합** (`components/AppRoot.tsx`
   `RecommendPanel`)
   - `handleApplyBlog`/`handleApplyProjectMedia`에 토글 로직 추가: 이미 적용된 항목(핀 고정
     썸네일이든 AI 추천 4칸이든)을 다시 누르면 `clearSceneMedia`를 호출해 등록을 취소.
   - "사진 등록"/"영상 등록" 버튼 2개 + 파일 입력 2개를 "등록" 버튼 1개 + `accept="image/*,video/*"`
     입력 1개로 통합(`handleRegisterFile`도 `kind` 매개변수를 없애고 파일의 MIME 타입으로
     자체 판별). `registerBusy` 상태도 `'photo'|'video'|null`에서 `boolean`으로 단순화.
3. **왼쪽 타임라인 패널 상단 "텍스트 AI로 생성" 버튼** (`components/AppRoot.tsx`
   `EditorInterface`, `lib/llm.ts`) — 섹션 5.3 참고.
   - `lib/llm.ts`에 `regenerateAllScenesForTimeline({ scenes, settings })` 신설 — 등록된
     사진/영상 파일명과 전후 장면 흐름을 한 번의 요청으로 함께 보내, 모든 장면의 제목·
     나레이션·대사를 "하나의 영화/다큐멘터리처럼 이어지게" 새로 씁니다. 실패 시 기존 내용을
     그대로 돌려주는 안전한 폴백 포함(장면이 비거나 사라지지 않음).
   - `EditorInterface`에 버튼 + 로딩/결과 안내 문구 추가(`handleGenerateAllScenes`), 결과는
     `applyBulkSceneContent`로 한 번에 반영.
4. **재생시간 슬라이더 — 0.1초 단위, 10초 상한, 영상은 자동 고정** (`components/AppRoot.tsx`
   `SceneEditor`, `lib/subtitles.ts`, `lib/llm.ts`) — 섹션 4.6 참고.
   - 슬라이더 `min/max/step`을 `1~20`(정수)에서 `0.1~10`(0.1 단위)으로 변경. 라벨도
     `scene.duration.toFixed(1)`로 소수점 첫째 자리까지 표시.
   - 영상이 등록된 장면(`scene.localVideoUrl`)은 슬라이더를 `disabled`로 잠그고 "영상 길이에
     고정" 안내문을 보여줌 — 실제 값은 위 1번의 `getVideoDurationSeconds`가 채워줌.
   - `lib/subtitles.ts`의 `MAX_AUTO_SCENE_SECONDS`를 20→10으로, `lib/llm.ts`의 텍스트 전용
     스토리보드 프롬프트 힌트("duration은 3~20")도 "3~10"으로 맞춰 AI 자동 생성값도 항상
     슬라이더 범위 안에 들어오도록 통일.
5. **장면 미리보기 화면비율(가로/세로 꽉 차게) + 여백 블러 배경** (`components/AppRoot.tsx`
   `MediaFrame`, `SceneEditor`) — 섹션 4.7 참고.
   - 새 `MediaFrame` 컴포넌트: 실제 컨텐츠는 `object-contain`으로 렌더링해 가로/세로 어느
     쪽이든 잘리지 않고 항상 전체가 보이게 하고, 남는 여백은 같은 미디어의 첫 프레임을
     캔버스로 캡처한 정지 이미지를 확대+블러 처리해 배경으로 채웁니다. `SceneEditor`의
     기존 `object-cover` 미리보기(사진/영상 양쪽)를 이걸로 교체.
   - 범위는 편집기 화면뿐이며 MP4 실제 렌더링에는 적용하지 않음(요청 범위 밖) — 섹션 10에
     알려진 제약으로 명시.
6. **헤더 "가져오기" 단순화 — 블로그 가져오기 전용 + 폴더 연결이 곧 프로젝트 열기**
   (`components/AppRoot.tsx`, `store/useStore.ts`) — 섹션 4.5 참고.
   - `ImportHubModal`(3카드 허브)과 `LoadModal`("불러오기" 모달) 컴포넌트를 완전히 삭제.
     `ModalState` 타입에서도 `'import'`/`'load'`를 제거. 헤더의 "가져오기" 버튼은
     이제 `setModal('blog-import')`를 직접 호출(라벨도 "블로그에서 가져오기"로 변경).
   - `MediaLibraryModal`/`BlogImportModal`의 "허브로 돌아가기" `onBack` 연결을 제거(허브가
     없어졌으므로). 두 모달 자체와 `SceneEditor`의 "미디어 라이브러리에서 변경" 딥링크는
     그대로 유지.
   - `attachSaveDir`(폴더 연결)이 그 폴더에 저장된 장면(`app_state.json`)이 없으면(완전히
     새 폴더) 메모리의 이전 장면/채팅/수정이력을 명시적으로 빈 상태로 초기화하고, 그 자리에서
     바로 `saveAllToFolder({silent:true})`를 호출해 빈 데이터 파일들을 실제로 생성해둡니다
     ("폴더에 데이터가 없으면 빈 데이터를 다시 생성해야 한다"는 요구사항). 저장된 장면이
     있으면 예전처럼 그대로 복원합니다 — 즉 "폴더 연결" 자체가 "그 폴더의 프로젝트 열기"
     역할을 대신합니다.
   - `pickDirectory`/`listJsonFiles`/`readJsonFile`(`lib/fsAccess.ts`) import는 `LoadModal`
     삭제로 더 이상 쓰이지 않아 `AppRoot.tsx`에서 제거(라이브러리 함수 자체는 그대로 남아있음
     — 다른 곳에서 필요하면 재사용 가능).

**검증**: 네트워크가 열려 있어 `npm install` → `npx tsc --noEmit`(오류 없음) →
`next build`(정상 컴파일 + 정적 페이지 생성 성공)까지 전부 실행해 확인했습니다. 다만 다음은
실기기 수동 확인이 필요합니다: ① 실제 LM Studio에 연결한 상태에서 "텍스트 AI로 생성" 버튼의
실제 응답 품질(전후 문맥이 자연스러운지), ② 세로/가로 각각 다른 화면비율의 실제 사진·영상으로
`MediaFrame`의 블러 배경이 시각적으로 자연스러운지, ③ 실제 영상 파일 여러 개로 영상 길이 자동
고정이 다양한 코덱/컨테이너에서도 잘 동작하는지, ④ 완전히 빈 폴더를 새로 연결했을 때 빈 데이터
파일이 실제로 생성되는지.

## 2026-08-02(2) — "새 폴더 다시 연결 → 브라우저 강제종료" 버그 수정 + agent.md/README.md 정리

**사용자 보고**: 저장 폴더 연결을 해제한 뒤 "새 폴더"로 다시 연결하려 하면 웹사이트(탭/브라우저)가
갑자기 닫혔고, 브라우저를 다시 열어 연결을 시도해도 같은 문제가 반복됨.

수정 파일: `store/useStore.ts`, `components/AppRoot.tsx`, `agent.md`, `README.md`. 자세한 설계
근거는 섹션 4.8에 "현재 진실"로 기록해두었으니, 다음에 이 영역을 손볼 때는 이 changelog보다
그 섹션을 먼저 참고하세요.

1. **원인 특정 + 수정**(`store/useStore.ts`, `components/AppRoot.tsx`) — 섹션 4.8 참고.
   - `disconnectSaveFolder()`가 IndexedDB에 남아있는 "기억해둔 폴더" 참조는 지우지 않고 메모리
     상태만 지우고 있었음 → `forgetRememberedDirectoryHandle(REMEMBERED_SAVE_DIR_KEY)` 호출과
     `rememberedSaveDirName: null` 초기화를 추가.
   - 기억된 폴더로 자동 재연결(`initStorage()`) 도중 비정상 종료되면 다음 실행 때도 같은 폴더로
     계속 재시도하던 문제 → `localStorage`에 재연결 진행 플래그(`RECONNECT_IN_PROGRESS_KEY`)를
     추가해, 다음 실행 시 플래그가 남아있으면(=지난번 미완료) 자동 재연결을 건너뛰고 기억해둔
     폴더도 함께 지우도록 함.
   - `FolderConnectGate`, `SaveFolderOfflineBanner`에 "다른(새) 폴더 선택하기" 버튼을 추가해,
     문제 있는 폴더에 갇히지 않고 언제든 탈출할 수 있게 함.
2. **agent.md 정리**(agent.md 자체)
   - 섹션 4.3이 이미 2026-07-27(2)에 제거된 "미디어 폴더 별도 연결" 개념을 여전히 현재
     설계인 것처럼 설명하고 있어 실제 코드(`projects/<프로젝트명>/media/`에 실제 파일 복사)
     기준으로 재작성.
   - 섹션 4.2의 폴더 트리에 이미 삭제된 `exports/`가 남아있어 제거하고, 실제 존재하는
     `projects/<이름>/media/`, `media_analysis.json`을 반영.
   - 5.3과 7 사이에 있던 블로그 데이터 연동 설명 블록에 섹션 헤더 자체가 없어서 번호가
     "5.3 → (헤더 없음) → 7"로 어긋나 있던 것을 발견 → `## 6. 블로그 데이터 연동` 헤더 추가.
   - 이번 버그 수정의 설계 근거를 담은 섹션 4.8 신설.
3. **README.md 정리**(README.md 자체)
   - "미디어 폴더 연결"(별도 폴더 연결 개념, 이미 제거됨) 언급을 실제 동작(저장 폴더 안
     `media/`에 업로드)으로 수정.
   - 이미 없어진 "저장된 프로젝트 불러오기" UI 언급 제거.
   - 내보내기 형식 목록에 빠져있던 "이미지·영상(ZIP)"을 추가.

**검증**: `npm install` → `npx tsc --noEmit`(오류 없음) → `next build`(정상 컴파일 + 정적 페이지
생성 성공)까지 실행해 확인했습니다. 다만 다음은 실기기 수동 확인이 필요합니다: ① 실제 크롬/엣지
브라우저에서 "저장 폴더 연결 해제 → 새 폴더로 재연결"을 반복해도 더 이상 강제종료가 재현되지
않는지, ② 기억된 폴더가 이미 손상/삭제된 상태에서 앱을 새로 열었을 때 자동으로 OPFS로 대체되고
문제없이 "새 폴더 선택"으로 이어지는지.




