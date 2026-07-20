# KWJMvideoAI

블로그 데이터나 텍스트로 영상 스토리보드를 자동으로 만들어주는 앱입니다.
기존 Vite + React 프로젝트를 **Next.js 14 (App Router) + Tailwind CSS**로 변환했습니다.

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

브라우저에서 [http://localhost:3000](http://localhost:3000) 을 열어 확인하세요.

## 주요 기능

- **채팅 화면**: 원하는 영상 컨셉을 입력하면 시나리오 형태로 스토리보드 생성 과정을 안내합니다. (실제 LLM 연동 전까지는 데모 응답)
- **스토리보드 편집기**: 장면 순서 변경/삭제/추가, 제목·나레이션·대사·재생시간·태그 편집.
- **비슷한 이미지 추천**: 장면 태그에 따라 어울리는 이미지를 추천하고 클릭 한 번으로 교체.
- **미디어 라이브러리**: 내 컴퓨터의 이미지/영상 폴더를 연결해 실제 로컬 파일을 장면에 바로 적용.
- **실제 폴더 저장**: 로컬스토리지·백엔드 없이, 사용자가 지정한 폴더에 채팅 기록·씬 내용·수정 이력을 실제 파일로 저장(자동저장 + 수동 저장 버튼).
- **프로젝트 관리**: 새 프로젝트 생성(저장 폴더의 `projects/`에 JSON 저장), 저장된 프로젝트 불러오기, PDF(인쇄)/JSON/TXT로 내보내기.
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
app/                Next.js App Router 엔트리 (layout.tsx, page.tsx, globals.css)
components/AppRoot.tsx  전체 UI/로직이 담긴 클라이언트 컴포넌트
store/useStore.ts   zustand 전역 상태 (장면, 채팅, 수정이력, 저장/미디어 폴더 연결)
lib/utils.ts         클래스명 병합 유틸(cn), 이미지 자리표시자 등
lib/fsAccess.ts      File System Access API 래퍼 (실제 폴더 읽기/쓰기)
agent.md             AI 코딩 어시스턴트용 프로젝트 가이드 (변경 시 함께 업데이트)
```

## 기술 스택

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS 3
- zustand (상태 관리)
- framer-motion (애니메이션)
- lucide-react (아이콘)
