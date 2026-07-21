# KWJMvideoAI

블로그 데이터나 텍스트로 영상 스토리보드를 자동으로 만들어주는 앱입니다.
채팅으로 아이디어를 구체화하다가 **"🎬 스토리보드로 만들기"** 버튼을 누르면, 로컬에서 실행 중인
LM Studio(Qwen 등)가 장면을 구성하고 바로 편집기로 이동합니다. 완성한 스토리보드는 자막이
실제로 입혀진 MP4로 내보낼 수 있습니다(FFmpeg 사용, SRT/TXT 자막 파일도 함께 생성).

## 사전 준비물 (필수)

1. **[LM Studio](https://lmstudio.ai)** 설치 후, 원하는 모델(기본 설정값: `qwen3.5-9b`, 헤더의
   "설정"에서 변경 가능)을 다운로드해 로드하고, 좌측 **"Local Server"** 탭에서 서버를 시작하세요
   (기본 주소 `http://localhost:1234`). 이 앱은 오직 LM Studio(로컬)만 사용하며 다른 클라우드
   AI는 호출하지 않습니다.
2. **[FFmpeg](https://ffmpeg.org/download.html)** 설치 후 시스템 PATH에 추가하세요 (자막
   burn-in을 위해 `libass`가 포함된 빌드를 권장합니다 — Windows는 gyan.dev의 "full" 빌드,
   macOS는 Homebrew `brew install ffmpeg`). PATH에 추가하지 않았다면 헤더의 "설정"에서 ffmpeg
   실행 파일 경로를 직접 입력할 수 있습니다.

## 시작하기

```bash
# 의존성 설치
yarn install   # 또는 npm install

# 개발 서버 (핫 리로드)
yarn dev       # 또는 npm run dev

# 프로덕션 실행 (자동으로 build 후 start)
yarn start     # 또는 npm run start
```

> `next start`는 반드시 `next build`로 만든 `.next` 산출물이 있어야 동작합니다.
> 이 프로젝트의 `start` 스크립트는 `next build && next start`로 구성되어 있어
> `yarn start` 한 번으로 빌드부터 실행까지 자동으로 처리됩니다.
> 빌드만 따로 하고 싶다면 `yarn build`, 이미 빌드된 결과로 서버만 켜고 싶다면
> `yarn start:only`를 사용하세요.

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 열어 확인하세요. 화면(헤더 포함)은
항상 브라우저 창 높이에 딱 맞고, 페이지 전체가 스크롤되지 않습니다 — 채팅/편집기 내부만 스크롤됩니다.

## 주요 기능

- **채팅 화면**: LM Studio와 실시간 스트리밍 대화로 영상 컨셉을 구체화합니다. 준비되면 하단의
  "🎬 스토리보드로 만들기" 버튼을 눌러야 편집기로 이동합니다 (자동 이동 없음).
- **블로그 데이터 가져오기**: "블로그에서 가져오기"로 블로그(`sampledata` 프로젝트)가 만든 데이터
  폴더(`posts.json`/`media-meta.json`/`uploads/`)를 연결하면, 실제 사진·글·캡션을 근거로
  스토리보드를 만듭니다. LLM은 실제로 존재하는 사진/영상만 사용하며, 없는 내용을 지어내지 않습니다.
- **스토리보드 편집기**: 장면 순서 변경/삭제/추가, 제목·나레이션·대사·재생시간·태그 편집,
  "AI 재생성"으로 나레이션을 LM Studio가 다시 작성.
- **비슷한 이미지 추천**: 장면 태그에 따라 어울리는 이미지를 추천하고 클릭 한 번으로 교체.
- **미디어 라이브러리**: 내 컴퓨터의 이미지/영상 폴더를 연결해 실제 로컬 파일을 장면에 바로 적용.
- **실제 폴더 저장**: 로컬스토리지·백엔드 없이, 사용자가 지정한 폴더에 채팅 기록·씬 내용·수정 이력을
  실제 파일로 저장(자동저장 + 수동 저장 버튼).
- **프로젝트 관리**: 새 프로젝트 생성(저장 폴더의 `projects/`에 JSON 저장), 저장된 프로젝트 불러오기,
  PDF(인쇄)/JSON/TXT/**MP4**로 내보내기.
- **MP4 내보내기**: FFmpeg으로 장면을 실제 렌더링하고 자막(나레이션+대사)을 영상에 굽습니다.
  같은 내용의 **SRT**, **TXT** 자막 파일도 함께 다운로드됩니다.
- **다크모드** 지원.

## 저장 구조 (로컬스토리지·백엔드 없음)

상단 "저장 폴더 연결" 버튼으로 폴더를 선택하면, 그 폴더 안에 `KWJMvideoAI_data/` 폴더가 만들어지고 아래 파일들에 텍스트 데이터가 저장됩니다.

```
[선택한 폴더]/
  README.txt              # 폴더 구조 안내
  KWJMvideoAI_data/
    app_state.json         # 현재 씬 목록, 다크모드 등
    chat_history.json      # 채팅 기록
    edit_log.json          # 수정 이력
    projects/               # "새 프로젝트"로 저장한 프로젝트들
    exports/                # 내보내기 시 함께 저장한 JSON/TXT
```

이미지·영상 원본은 이 폴더에 복사되지 않습니다. "미디어 폴더 연결"로 별도 지정한 폴더의 파일을 참조(파일명 기억)하며, 같은 미디어 폴더를 다시 연결하면 자동으로 미리보기가 복원됩니다.

자세한 설계 배경과 향후 작업 가이드는 프로젝트 루트의 `agent.md`를 참고하세요.

## 폴더 구조

```
app/                    Next.js App Router 엔트리 (layout.tsx, page.tsx, globals.css)
app/api/llm/            LM Studio 프록시 (chat 스트리밍, health 체크)
app/api/ffmpeg/check/   FFmpeg 설치 확인
app/api/export/video/   실제 FFmpeg 렌더링 + mp4/srt/txt 다운로드
components/AppRoot.tsx  전체 UI/로직이 담긴 클라이언트 컴포넌트
store/useStore.ts       zustand 전역 상태 (장면, 채팅, 수정이력, 저장/미디어/블로그 폴더 연결, LLM/FFmpeg 설정)
lib/utils.ts            클래스명 병합 유틸(cn), 이미지 자리표시자 등
lib/fsAccess.ts         File System Access API 래퍼 (실제 폴더 읽기/쓰기)
lib/blogData.ts         블로그 데이터 폴더(posts.json/media-meta.json/uploads) 리더
lib/llm.ts              LM Studio 클라이언트 (스트리밍 채팅, 스토리보드 생성, 나레이션 재생성)
lib/subtitles.ts        SRT/TXT 자막 생성
lib/server/ffmpeg.ts    서버 전용 ffmpeg 프로세스 실행 유틸
agent.md                AI 코딩 어시스턴트용 프로젝트 가이드 (변경 시 함께 업데이트)
```

## 기술 스택

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS 3
- zustand (상태 관리)
- framer-motion (애니메이션)
- lucide-react (아이콘)
