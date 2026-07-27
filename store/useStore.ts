'use client';

import { create } from 'zustand';
import {
  pickDirectory,
  verifyPermission,
  getDataDir,
  getProjectsDir,
  writeJsonFile,
  writeTextFile,
  readJsonFileIfExists,
  readTextFileIfExists,
  listJsonFiles,
  readJsonFile,
  listMediaFiles,
  fileHandleToObjectUrl,
  getOpfsRoot,
  rememberDirectoryHandle,
  getRememberedDirectoryHandle,
  forgetRememberedDirectoryHandle,
  queryPermissionSilently,
  getProjectMediaDir,
  getProjectDir,
  writeBinaryFile,
  buildUniqueMediaFileName,
  REMEMBERED_SAVE_DIR_KEY,
  MEDIA_ANALYSIS_FILE_NAME,
  type MediaFileEntry,
} from '@/lib/fsAccess';
import { readBlogData, type BlogPost, type BlogMediaMeta, type BlogCategory } from '@/lib/blogData';

// 2026-07-27(3): 폴더 선택/연결 도중 나는 오류가 화면에서 "영원히 로딩 중"으로만 보이던 문제를
// 고치기 위한 공용 헬퍼입니다. pickDirectory/verifyPermission 등은 사용자가 다이얼로그를
// 취소한 경우 외에도(예: 브라우저가 사용자 제스처로 인식하지 못해 막는 SecurityError 등)
// 예외를 던질 수 있는데, 이걸 호출부에서 못 잡으면 busy 상태가 절대 풀리지 않습니다.
// 아래 헬퍼로 어떤 예외든 사람이 이해할 수 있는 한국어 문구로 바꿔 반환합니다.
function describeFolderPickError(err: unknown): string {
  const name = (err as any)?.name;
  const message = (err as any)?.message;
  if (name === 'SecurityError') {
    return '브라우저가 폴더 선택창을 열지 못했습니다. 페이지를 새로고침한 뒤 버튼을 다시 눌러주세요.';
  }
  if (name === 'NotFoundError') {
    return '선택한 폴더를 찾을 수 없습니다. 폴더가 이동되었거나 삭제되지 않았는지 확인해주세요.';
  }
  return `폴더를 여는 중 문제가 발생했습니다.${message ? ` (${message})` : ''}`;
}

export interface Scene {
  id: string;
  photoRef: string;
  narration: string;
  dialogue: string;
  duration: number;
  customTitle: string;
  filename?: string;
  tags?: string[];
  /** 미디어 폴더에서 가져온 로컬 이미지의 원본 파일명 (재연결 시 이 이름으로 다시 찾아 미리보기를 복원합니다) */
  localImageName?: string;
  /** 미디어 폴더에서 가져온 로컬 영상의 원본 파일명 */
  localVideoName?: string;
  /** 로컬 영상 미리보기용 objectURL (세션 동안만 유효 — 저장 파일에는 기록되지 않습니다) */
  localVideoUrl?: string;
  /** 블로그 데이터에서 가져온 장면이면 원본 글/미디어 id (추적용, 선택 항목) */
  sourcePostId?: string;
  sourceMediaId?: string;
  /** 2026-07-27(4) 추가: "비슷한 이미지 추천" 패널에서 이 장면 전용으로 등록한 프로젝트
   *  미디어 파일 경로들(KWJMvideoAI_data/projects/<프로젝트명>/media/ 기준). 다른 장면의
   *  추천 패널에는 나타나지 않고, 오직 이 장면에서만 "등록된 미디어"로 표시됩니다. */
  pinnedMediaPaths?: string[];
}

/** 프로젝트 media 폴더 안 파일 하나에 대한 AI(휴리스틱) 분석 결과 — 비슷한 이미지 추천에 사용됩니다.
 *  현재 연결 가능한 LM Studio 모델은 텍스트 전용이라(agent.md 10절 참고) 실제 이미지 인식은
 *  하지 못하므로, 파일명에서 뽑아낸 태그/설명을 "메타데이터 기반 분석"으로 사용합니다. */
export interface MediaAnalysisEntry {
  /** listProjectMediaFiles()가 반환하는 MediaFileEntry.path와 동일한 값(파일명) */
  path: string;
  kind: 'image' | 'video';
  /** 파일 변경 감지용 (재분석이 필요한지 판단) */
  size: number;
  lastModified: number;
  tags: string[];
  caption: string;
  analyzedAt: string;
}

export interface Project {
  id: string;
  name: string;
  folderPath: string;
  createdAt: string;
  modifiedAt: string;
  scenes: Scene[];
  thumbnail?: string;
}

export type ViewState = 'chat' | 'editor';
export type ModalState = null | 'new-project' | 'load' | 'export' | 'media' | 'settings' | 'blog-import' | 'import';

export type LlmStatus = 'unknown' | 'checking' | 'online' | 'offline';
/** 빠른모드: 속도 위주(짧은 생성, 응답이 가장 빠름) · 보통모드: 가성비(기본값) · 전문가모드: 토큰을 많이 써서 더 길고 자세한 결과 */
export type LlmMode = 'fast' | 'normal' | 'expert';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface EditLogEntry {
  id: string;
  type: string;
  message: string;
  createdAt: string;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const APP_STATE_FILE = 'app_state.json';
const CHAT_HISTORY_FILE = 'chat_history.json';
const EDIT_LOG_FILE = 'edit_log.json';
const README_FILE = 'README.txt';
const MAX_LOG_ENTRIES = 500;

const README_CONTENT = `KWJMvideoAI 저장 폴더
========================

이 폴더는 KWJMvideoAI 앱이 브라우저의 "저장 폴더 연결" 기능으로
실제 파일에 데이터를 저장하는 곳입니다. 로컬스토리지나 별도의 백엔드
서버는 전혀 사용하지 않으며, 아래 파일들이 곧 앱의 데이터 전체입니다.

- app_state.json   : 현재 작업 중인 씬(장면) 목록, 다크모드 등 앱 상태
- chat_history.json: 채팅 화면의 대화 기록
- edit_log.json    : 장면 추가/삭제/수정, 이미지 교체 등 수정 이력
- projects/        : "새 프로젝트"로 이름을 붙여 저장한 프로젝트들(JSON)
- projects/<프로젝트명>/media/ : 스토리보드 편집기에서 "사진 등록"/"영상 등록" 버튼으로
  직접 등록한 사진·영상 원본 파일이 실제로 복사되어 저장되는 곳입니다. 프로젝트별로
  폴더가 나뉘어 있어 탐색기에서 바로 열어 확인할 수 있습니다.

별도로 "미디어 폴더"를 연결해 사용하는 사진/영상은 이 폴더에 복사되지 않고, 원본
위치의 파일을 그대로 참조(파일명 기억)합니다 — 같은 미디어 폴더를 다시 연결하면
자동으로 미리보기가 복원됩니다.

이 폴더를 지우거나 옮기면 저장된 기록(등록한 사진·영상 포함)도 함께 사라지니 주의하세요.
`;

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 파일명에서 태그/설명을 뽑아내는 휴리스틱 분석입니다 (2026-07-27(4) 추가).
 *
 * agent.md 10절에 명시된 대로, 현재 연결 가능한 LM Studio 모델은 텍스트 전용이라 사진을
 * 직접 "보고" 분석하지 못합니다. 그래서 실제 이미지 인식 대신, 등록 시 붙는 타임스탬프/
 * 임의문자 접두어(`buildUniqueMediaFileName` 참고)를 제거한 원래 파일명을 토큰으로 쪼개
 * 태그처럼 사용합니다 — 사용자가 "제주_협재_노을.jpg"처럼 의미 있는 이름으로 등록해두면
 * 그만큼 추천 정확도가 올라갑니다. 나중에 비전(Vision) 모델을 연결하면 이 함수를 실제
 * 이미지 인식 호출로 교체하되, 반환 형태(tags/caption)는 그대로 유지하면 됩니다.
 */
function analyzeMediaFileName(fileName: string, kind: 'image' | 'video'): { tags: string[]; caption: string } {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  // buildUniqueMediaFileName이 붙이는 `<timestamp>_<random4자>_` 접두어를 제거합니다.
  const withoutPrefix = base.replace(/^\d{6,}_[a-z0-9]{2,8}_/i, '');
  const tokens = withoutPrefix
    .split(/[_\-.\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
  const uniqueTags = Array.from(new Set(tokens.map((t) => t.toLowerCase()))).slice(0, 8);
  const caption = uniqueTags.length > 0 ? uniqueTags.join(' ') : kind === 'video' ? '영상' : '사진';
  return { tags: uniqueTags, caption };
}

/** 저장용으로 씬을 정리합니다: 세션에만 유효한 blob URL은 제거하고, 로컬 파일명 참조만 남깁니다. */
export function sanitizeSceneForSave(scene: Scene): Scene {
  const { localVideoUrl, ...rest } = scene;
  let photoRef = scene.photoRef;
  if (photoRef && photoRef.startsWith('blob:') && scene.localImageName) {
    // 다음 세션에서는 유효하지 않은 주소이므로 비워두고, 미디어 폴더 재연결 시 localImageName으로 복원합니다.
    photoRef = '';
  }
  return { ...rest, photoRef };
}

export function sanitizeScenesForSave(scenes: Scene[]): Scene[] {
  return scenes.map(sanitizeSceneForSave);
}

// 2026-07-27(3): 이 프로젝트는 이제 샘플/데모 데이터를 전혀 사용하지 않습니다. 모든 프로젝트,
// 장면, 미디어는 사용자가 연결한 실제 저장 폴더의 실제 파일에서만 만들어집니다.

const INITIAL_CHAT_MESSAGE: ChatMessage = {
  id: genId('msg'),
  role: 'assistant',
  text:
    '안녕하세요! KWJMvideoAI입니다. 블로그 데이터나 텍스트로 영상 스토리보드를 자동으로 만들어드립니다.\n\n어떤 영상을 만들고 싶으신가요? 예를 들어 "제주도 가족 여행 감성 브이로그 만들어줘" 라고 입력해보세요.',
  createdAt: new Date().toISOString(),
};

interface AppState {
  view: ViewState;
  setView: (view: ViewState) => void;
  modal: ModalState;
  setModal: (modal: ModalState) => void;

  darkMode: boolean;
  setDarkMode: (v: boolean) => void;

  scenes: Scene[];
  setScenes: (scenes: Scene[]) => void;
  updateScene: (id: string, updates: Partial<Scene>) => void;
  moveScene: (id: string, direction: 'up' | 'down') => void;
  deleteScene: (id: string) => void;
  addScene: () => void;
  applyImageToScene: (
    id: string,
    photoRef: string,
    opts?: { localImageName?: string | null; logMessage?: string; sourcePostId?: string | null; sourceMediaId?: string | null }
  ) => void;
  applyLocalVideoToScene: (id: string, fileEntry: MediaFileEntry) => Promise<void>;
  /** 사용자가 컴퓨터에서 직접 고른 사진 파일을 장면에 등록하고, 저장 폴더 안 프로젝트별
   *  media 폴더(KWJMvideoAI_data/projects/<프로젝트명>/media/)에 실제로 복사해 저장합니다. */
  uploadPhotoToScene: (id: string, file: File) => Promise<{ ok: boolean; message?: string }>;
  /** uploadPhotoToScene과 동일하지만 영상 파일용입니다. */
  uploadVideoToScene: (id: string, file: File) => Promise<{ ok: boolean; message?: string }>;

  selectedSceneId: string | null;
  setSelectedSceneId: (id: string | null) => void;

  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;

  chatMessages: ChatMessage[];
  addChatMessage: (role: 'user' | 'assistant', text: string) => void;
  setChatMessages: (messages: ChatMessage[]) => void;

  editLog: EditLogEntry[];
  pushEditLog: (type: string, message: string) => void;

  /** 현재 편집 중인 스토리보드를 완전히 비우고 처음(0)부터 새로 시작합니다 ("새 프로젝트"용). */
  resetForNewProject: () => void;

  saveDirHandle: any | null;
  saveDirName: string | null;
  /** 저장 폴더가 사용자가 직접 고른 실제 폴더인지('external'), 폴더를 아직 안 골라 브라우저
   *  내부 자동 저장소(OPFS)를 쓰고 있는지('opfs')를 나타냅니다. */
  saveDirSource: 'external' | 'opfs' | null;
  /** 이전에 연결했던 실제 저장 폴더 이름 (기억은 하고 있지만 아직 이번 세션에 권한이 재확인되지
   *  않은 상태 — 사용자가 클릭해서 재연결하도록 안내할 때 사용). */
  rememberedSaveDirName: string | null;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: (v: boolean) => void;
  saveStatus: SaveStatus;
  saveError: string | null;
  lastSavedAt: string | null;
  /** 앱 시작 시 1회 호출: 기억해둔 저장 폴더에 조용히 재연결을 시도하고, 실패하면 브라우저
   *  내부 자동 저장소(OPFS)로 자동 연결해 폴더가 전혀 없어도 바로 자동저장이 되도록 합니다. */
  initStorage: () => Promise<void>;
  /** 기억해둔 저장 폴더에 사용자 클릭(제스처)으로 다시 연결합니다 (권한 재요청 다이얼로그 가능). */
  reconnectRememberedSaveFolder: () => Promise<{ ok: boolean; message?: string }>;
  connectSaveFolder: () => Promise<{ ok: boolean; message?: string }>;
  disconnectSaveFolder: () => void;
  saveAllToFolder: (opts?: { silent?: boolean }) => Promise<{ ok: boolean; message?: string }>;
  saveNamedProject: (name: string) => Promise<{ ok: boolean; message?: string }>;
  listNamedProjects: () => Promise<{ name: string; handle: any; modifiedAt?: string; sceneCount?: number }[]>;
  loadNamedProject: (fileHandle: any) => Promise<{ ok: boolean; message?: string }>;
  /** 저장 폴더의 projects/<이름>.json 파일 하나를 삭제합니다 ("불러오기" 목록의 삭제 버튼용). */
  deleteNamedProject: (fileName: string) => Promise<{ ok: boolean; message?: string }>;

  // 2026-07-27(2): 이전에는 "미디어 폴더 연결"(mediaDirHandle)로 사용자가 이미 갖고 있는
  // 폴더를 읽기 전용으로 별도 참조했지만, 브라우저 저장소가 커지고 개념이 두 갈래로
  // 나뉘는 문제가 있어 완전히 제거하고 저장 폴더(자동 저장소 포함)에 합쳤습니다. 사진/영상은
  // 항상 현재 프로젝트의 KWJMvideoAI_data/projects/<프로젝트명>/media/ 폴더에 실제로
  // 저장되고, 미디어 라이브러리도 그 폴더를 그대로 보여줍니다.
  /** 현재 프로젝트의 media 폴더에 이미 저장되어 있는 사진/영상 목록을 반환합니다. */
  listProjectMediaFiles: () => Promise<MediaFileEntry[]>;
  /** 사용자가 고른 파일들을 현재 프로젝트의 media 폴더에 실제로 복사해 라이브러리에 추가합니다. */
  addFilesToProjectMedia: (files: File[]) => Promise<{ ok: boolean; message?: string; added?: MediaFileEntry[] }>;
  resyncMediaReferences: () => Promise<void>;

  // 2026-07-27(4): "비슷한 이미지 추천"이 매번 처음부터 다시 분석하지 않도록, 프로젝트별
  // 분석 결과를 메모리에도 캐시해두고 저장 폴더 안 media_analysis.json에도 저장합니다.
  mediaAnalysisCache: Record<string, MediaAnalysisEntry[]>;
  /** 현재 프로젝트 media 폴더의 파일별 분석 데이터를 반환합니다. 저장 폴더에 이미
   *  media_analysis.json이 있고 파일이 바뀌지 않았으면 그 데이터를 그대로 재사용하고,
   *  새 파일이거나 캐시가 없으면 새로 분석해 저장 폴더에 다시 저장합니다. */
  ensureProjectMediaAnalysis: () => Promise<MediaAnalysisEntry[]>;

  // ── 블로그 데이터 폴더 (posts.json / media-meta.json / uploads) ──────────
  blogDirHandle: any | null;
  blogDirName: string | null;
  blogPosts: BlogPost[];
  blogMedia: BlogMediaMeta[];
  blogCategories: BlogCategory[];
  blogAuthorLabels: Record<string, string>;
  connectBlogDataFolder: () => Promise<{ ok: boolean; message?: string }>;
  disconnectBlogDataFolder: () => void;
  /** 블로그 가져오기 모달에서 선택한 글 id들 — 채팅에 첨부되어 스토리보드 생성 시 미디어 후보로 사용됩니다. */
  blogSelectedPostIds: string[];
  setBlogSelectedPostIds: (ids: string[]) => void;

  // ── LM Studio / FFmpeg 설정 ────────────────────────────────────────────
  llmBaseUrl: string;
  setLlmBaseUrl: (v: string) => void;
  llmModel: string;
  setLlmModel: (v: string) => void;
  llmStatus: LlmStatus;
  setLlmStatus: (v: LlmStatus) => void;
  llmAvailableModels: string[];
  setLlmAvailableModels: (v: string[]) => void;
  /** AI 응답 속도/품질 모드: 빠른모드(속도 위주) · 보통모드(가성비) · 전문가모드(토큰 많이 써서 품질 위주) */
  llmMode: LlmMode;
  setLlmMode: (v: LlmMode) => void;

  subtitleFontName: string;
  setSubtitleFontName: (v: string) => void;
}

export const useStore = create<AppState>((set, get) => {
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleAutosave = () => {
    const state = get();
    if (!state.saveDirHandle || !state.autoSaveEnabled) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      get().saveAllToFolder({ silent: true });
    }, 1500);
  };

  const addLogEntry = (type: string, message: string) => {
    set((s) => ({
      editLog: [...s.editLog, { id: genId('log'), type, message, createdAt: new Date().toISOString() }].slice(
        -MAX_LOG_ENTRIES
      ),
    }));
  };

  /**
   * 저장 폴더 핸들(사용자가 고른 실제 폴더든, OPFS 자동 저장소든)을 연결하고 그 안의
   * 이전 저장 내용을 복원합니다. connectSaveFolder(수동 연결)와 initStorage(자동 연결)가
   * 이 로직을 공유합니다.
   */
  const attachSaveDir = async (
    handle: any,
    source: 'external' | 'opfs',
    displayName: string
  ): Promise<{ ok: boolean; message?: string }> => {
    try {
      const dataDir = await getDataDir(handle);

      const [appState, chatData, logData] = await Promise.all([
        readJsonFileIfExists(dataDir, APP_STATE_FILE),
        readJsonFileIfExists(dataDir, CHAT_HISTORY_FILE),
        readJsonFileIfExists(dataDir, EDIT_LOG_FILE),
      ]);

      if (source === 'external') {
        const existingReadme = await readTextFileIfExists(handle, README_FILE);
        if (existingReadme === null) {
          await writeTextFile(handle, README_FILE, README_CONTENT);
        }
      }

      set({
        saveDirHandle: handle,
        saveDirName: displayName,
        saveDirSource: source,
        saveStatus: 'idle',
        saveError: null,
      });

      if (appState && Array.isArray(appState.scenes) && appState.scenes.length > 0) {
        set({
          scenes: appState.scenes,
          darkMode: typeof appState.darkMode === 'boolean' ? appState.darkMode : get().darkMode,
          selectedSceneId: appState.selectedSceneId ?? appState.scenes[0]?.id ?? null,
          llmBaseUrl: typeof appState.llmBaseUrl === 'string' && appState.llmBaseUrl ? appState.llmBaseUrl : get().llmBaseUrl,
          llmModel: typeof appState.llmModel === 'string' && appState.llmModel ? appState.llmModel : get().llmModel,
          llmMode: appState.llmMode === 'fast' || appState.llmMode === 'normal' || appState.llmMode === 'expert' ? appState.llmMode : get().llmMode,
          subtitleFontName: typeof appState.subtitleFontName === 'string' ? appState.subtitleFontName : get().subtitleFontName,
          view: 'editor',
        });
        if (appState.currentProjectMeta) {
          set((s) => ({
            currentProject: {
              ...appState.currentProjectMeta,
              scenes: s.scenes,
            },
          }));
        }
        // 2026-07-27: 저장 시 blob: URL은 지워지고 localImageName/localVideoName(파일명)만
        // 남으므로, 폴더를 다시 연결한 직후 프로젝트 media 폴더(및 연결된 미디어 폴더)에서
        // 실제 파일을 찾아 미리보기를 복원합니다.
        get()
          .resyncMediaReferences()
          .catch((err) => console.error(err));
      }
      if (chatData && Array.isArray(chatData.messages) && chatData.messages.length > 0) {
        set({ chatMessages: chatData.messages });
      }
      if (logData && Array.isArray(logData.entries)) {
        set({ editLog: logData.entries });
      }

      addLogEntry(
        'folder_connect',
        source === 'external'
          ? `저장 폴더 연결됨: "${displayName}"`
          : '브라우저 내부 자동 저장소에 연결됨 (실제 폴더를 아직 연결하지 않음)'
      );

      const restored = Boolean(appState || chatData);
      return {
        ok: true,
        message:
          source === 'external'
            ? restored
              ? `"${displayName}" 폴더에서 이전 저장 내용을 불러왔습니다.`
              : `"${displayName}" 폴더에 새로 연결되었습니다.`
            : restored
              ? '이전 자동저장 내용을 불러왔습니다. (저장 폴더를 연결하면 실제 폴더에 저장됩니다)'
              : '저장 폴더가 없어 브라우저 내부 저장소에 자동 저장을 시작합니다. 언제든 "저장 폴더 연결"로 실제 폴더로 옮길 수 있습니다.',
      };
    } catch (err: any) {
      console.error(err);
      return { ok: false, message: '폴더를 여는 중 문제가 발생했습니다.' };
    }
  };

  return {
    // 2026-07-25: 처음 실행하거나(yarn start) 새 프로젝트를 만들었을 때 항상 빈 스토리보드에서
    // 시작하도록, 초기 view는 채팅 화면(view: 'chat')으로 둡니다. 2026-07-27(3)부터는 샘플/데모
    // 데이터를 코드에서 완전히 제거해, 모든 프로젝트/장면/미디어는 사용자의 실제 저장 폴더에서만
    // 만들어집니다.
    view: 'chat',
    setView: (view) => set({ view }),
    modal: null,
    setModal: (modal) => set({ modal }),

    darkMode: false,
    setDarkMode: (v) => {
      set({ darkMode: v });
      scheduleAutosave();
    },

    scenes: [],
    setScenes: (scenes) => set({ scenes }),
    updateScene: (id, updates) => {
      set((s) => ({ scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, ...updates } : sc)) }));
      scheduleAutosave();
    },
    moveScene: (id, direction) => {
      set((s) => {
        const idx = s.scenes.findIndex((sc) => sc.id === id);
        if (idx < 0) return s;
        const newScenes = [...s.scenes];
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= newScenes.length) return s;
        [newScenes[idx], newScenes[targetIdx]] = [newScenes[targetIdx], newScenes[idx]];
        return { scenes: newScenes };
      });
      addLogEntry('scene_move', `장면 순서 변경 (${direction === 'up' ? '위로' : '아래로'})`);
      scheduleAutosave();
    },
    deleteScene: (id) => {
      const target = get().scenes.find((sc) => sc.id === id);
      set((s) => {
        const newScenes = s.scenes.filter((sc) => sc.id !== id);
        const newSelected = s.selectedSceneId === id ? (newScenes[0]?.id ?? null) : s.selectedSceneId;
        return { scenes: newScenes, selectedSceneId: newSelected };
      });
      if (target) addLogEntry('scene_delete', `장면 삭제: "${target.customTitle}"`);
      scheduleAutosave();
    },
    addScene: () => {
      set((s) => {
        const newScene: Scene = {
          id: genId('scene'),
          customTitle: `새 장면 ${s.scenes.length + 1}`,
          photoRef: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=450&fit=crop&auto=format',
          narration: '새로운 장면의 나레이션을 입력해주세요.',
          dialogue: '',
          duration: 5,
          tags: [],
        };
        return { scenes: [...s.scenes, newScene], selectedSceneId: newScene.id };
      });
      addLogEntry('scene_add', '새 장면 추가');
      scheduleAutosave();
    },
    applyImageToScene: (id, photoRef, opts) => {
      set((s) => ({
        scenes: s.scenes.map((sc) =>
          sc.id === id
            ? {
                ...sc,
                photoRef,
                localImageName: opts?.localImageName ?? undefined,
                ...(opts && 'sourcePostId' in opts ? { sourcePostId: opts.sourcePostId ?? undefined } : {}),
                ...(opts && 'sourceMediaId' in opts ? { sourceMediaId: opts.sourceMediaId ?? undefined } : {}),
              }
            : sc
        ),
      }));
      addLogEntry('image_apply', opts?.logMessage ?? '장면 이미지 교체');
      scheduleAutosave();
    },
    applyLocalVideoToScene: async (id, fileEntry) => {
      const url = await fileHandleToObjectUrl(fileEntry.handle);
      set((s) => ({
        scenes: s.scenes.map((sc) =>
          sc.id === id ? { ...sc, localVideoName: fileEntry.name, localVideoUrl: url } : sc
        ),
      }));
      addLogEntry('video_apply', `장면에 로컬 영상 연결: ${fileEntry.name}`);
      scheduleAutosave();
    },

    // ── 2026-07-27(2) 수정: 스토리보드 편집기에서 사진/영상 직접 등록 ──────────────
    //
    // 사진/영상은 항상 저장 폴더 안 프로젝트별 media 폴더에 실제 파일로 저장됩니다
    // (별도 "미디어 폴더"는 더 이상 존재하지 않습니다 — 완전히 저장 폴더에 합쳐졌습니다).
    // 브라우저 내부 자동 저장소(OPFS)만으로는 사용자가 탐색기에서 파일을 확인할 수 없고,
    // 브라우저 저장 용량이 계속 커지는 문제가 있으므로, 이 기능은 사용자가 "저장 폴더
    // 연결"로 실제 폴더를 등록했을 때만 사용할 수 있습니다. 아직 등록 전이면 먼저
    // 등록하라고 안내합니다.
    uploadPhotoToScene: async (id, file) => {
      const state = get();
      if (!state.saveDirHandle || state.saveDirSource !== 'external') {
        return { ok: false, message: '실제 저장 폴더를 먼저 등록해야 사진을 등록할 수 있습니다. 상단의 "저장 폴더 연결"을 눌러주세요.' };
      }
      try {
        const granted = await verifyPermission(state.saveDirHandle, 'readwrite');
        if (!granted) return { ok: false, message: '폴더 쓰기 권한이 없습니다.' };
        const dataDir = await getDataDir(state.saveDirHandle);
        const projectName = state.currentProject?.name || '임시_프로젝트';
        const mediaDir = await getProjectMediaDir(dataDir, projectName);
        const fileName = buildUniqueMediaFileName(file.name);
        await writeBinaryFile(mediaDir, fileName, file);
        const url = URL.createObjectURL(file);
        set((s) => ({
          scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, photoRef: url, localImageName: fileName } : sc)),
        }));
        addLogEntry('image_apply', `장면에 사진 등록(파일 업로드): ${fileName} → "${projectName}" 프로젝트 미디어 폴더에 저장됨`);
        scheduleAutosave();
        return { ok: true, message: `사진이 "${projectName}" 프로젝트 폴더 안 media 폴더에 저장되었습니다.` };
      } catch (err) {
        console.error(err);
        return { ok: false, message: '사진을 저장하는 중 문제가 발생했습니다.' };
      }
    },
    uploadVideoToScene: async (id, file) => {
      const state = get();
      if (!state.saveDirHandle || state.saveDirSource !== 'external') {
        return { ok: false, message: '실제 저장 폴더를 먼저 등록해야 영상을 등록할 수 있습니다. 상단의 "저장 폴더 연결"을 눌러주세요.' };
      }
      try {
        const granted = await verifyPermission(state.saveDirHandle, 'readwrite');
        if (!granted) return { ok: false, message: '폴더 쓰기 권한이 없습니다.' };
        const dataDir = await getDataDir(state.saveDirHandle);
        const projectName = state.currentProject?.name || '임시_프로젝트';
        const mediaDir = await getProjectMediaDir(dataDir, projectName);
        const fileName = buildUniqueMediaFileName(file.name);
        await writeBinaryFile(mediaDir, fileName, file);
        const url = URL.createObjectURL(file);
        set((s) => ({
          scenes: s.scenes.map((sc) =>
            sc.id === id ? { ...sc, localVideoName: fileName, localVideoUrl: url } : sc
          ),
        }));
        addLogEntry('video_apply', `장면에 영상 등록(파일 업로드): ${fileName} → "${projectName}" 프로젝트 미디어 폴더에 저장됨`);
        scheduleAutosave();
        return { ok: true, message: `영상이 "${projectName}" 프로젝트 폴더 안 media 폴더에 저장되었습니다.` };
      } catch (err) {
        console.error(err);
        return { ok: false, message: '영상을 저장하는 중 문제가 발생했습니다.' };
      }
    },

    selectedSceneId: null,
    setSelectedSceneId: (id) => set({ selectedSceneId: id }),

    currentProject: null,
    setCurrentProject: (project) => set({ currentProject: project, scenes: project?.scenes ?? [] }),

    resetForNewProject: () => {
      set({
        scenes: [],
        selectedSceneId: null,
        currentProject: null,
        chatMessages: [INITIAL_CHAT_MESSAGE],
      });
      addLogEntry('new_project', '새 프로젝트 시작 (빈 스토리보드에서 0부터 다시 시작)');
      scheduleAutosave();
    },

    chatMessages: [INITIAL_CHAT_MESSAGE],
    addChatMessage: (role, text) => {
      set((s) => ({
        chatMessages: [...s.chatMessages, { id: genId('msg'), role, text, createdAt: new Date().toISOString() }],
      }));
      if (role === 'user') addLogEntry('chat', `채팅 메시지 전송: "${text.slice(0, 60)}"`);
      scheduleAutosave();
    },
    setChatMessages: (messages) => set({ chatMessages: messages }),

    editLog: [],
    pushEditLog: (type, message) => {
      addLogEntry(type, message);
      scheduleAutosave();
    },

    saveDirHandle: null,
    saveDirName: null,
    saveDirSource: null,
    rememberedSaveDirName: null,
    autoSaveEnabled: true,
    setAutoSaveEnabled: (v) => set({ autoSaveEnabled: v }),
    saveStatus: 'idle',
    saveError: null,
    lastSavedAt: null,

    initStorage: async () => {
      if (get().saveDirHandle) return; // 이미 이번 세션에 연결됨
      try {
        const remembered = await getRememberedDirectoryHandle(REMEMBERED_SAVE_DIR_KEY);
        if (remembered) {
          set({ rememberedSaveDirName: remembered.name ?? null });
          // 사용자 제스처 없이 조용히 권한만 확인합니다 (다이얼로그 없음). 이미 허용되어 있으면
          // 바로 재연결하고, 아니면 StorageBar에 "다시 연결" 안내를 띄웁니다.
          const alreadyGranted = await queryPermissionSilently(remembered, 'readwrite');
          if (alreadyGranted) {
            const res = await attachSaveDir(remembered, 'external', remembered.name ?? '저장 폴더');
            if (res.ok) return;
          }
        }
      } catch (err) {
        console.error(err);
      }
      // 기억해둔 폴더가 없거나 조용히 재연결하지 못했으면, 폴더 선택 없이도 바로 자동저장이
      // 되도록 브라우저 내부 자동 저장소(OPFS)에 연결합니다.
      try {
        const opfsRoot = await getOpfsRoot();
        if (opfsRoot) {
          await attachSaveDir(opfsRoot, 'opfs', '자동 저장소 (브라우저 내부)');
        }
      } catch (err) {
        console.error(err);
      }
    },

    reconnectRememberedSaveFolder: async () => {
      try {
        const remembered = await getRememberedDirectoryHandle(REMEMBERED_SAVE_DIR_KEY);
        if (!remembered) return { ok: false, message: '기억된 저장 폴더가 없습니다.' };
        const granted = await verifyPermission(remembered, 'readwrite');
        if (!granted) return { ok: false, message: '폴더 쓰기 권한이 거부되었습니다.' };
        return await attachSaveDir(remembered, 'external', remembered.name ?? '저장 폴더');
      } catch (err) {
        console.error(err);
        return { ok: false, message: describeFolderPickError(err) };
      }
    },

    connectSaveFolder: async () => {
      try {
        const handle = await pickDirectory('readwrite');
        if (!handle) return { ok: false, message: '폴더 선택이 취소되었습니다.' };

        const granted = await verifyPermission(handle, 'readwrite');
        if (!granted) {
          return { ok: false, message: '폴더 쓰기 권한이 거부되었습니다.' };
        }

        const res = await attachSaveDir(handle, 'external', handle.name);
        if (res.ok) {
          // 다음 방문 때 "마지막에 저장한 폴더"로 자동 재연결을 시도할 수 있도록 기억해둡니다.
          rememberDirectoryHandle(REMEMBERED_SAVE_DIR_KEY, handle).catch((err) => console.error(err));
          set({ rememberedSaveDirName: handle.name });
        }
        return res;
      } catch (err) {
        // 2026-07-27(3): 이 catch가 없으면(예: 브라우저가 폴더 선택창을 사용자 제스처로
        // 인식하지 못해 SecurityError를 던지는 경우) 이 함수 전체가 예외를 던지고, 이를
        // 호출하는 모든 화면의 "연결 중..." 스피너가 영원히 멈추지 않는 문제가 있었습니다.
        // 이제 어떤 예외가 나도 항상 { ok:false, message } 형태로 반환합니다.
        console.error(err);
        return { ok: false, message: describeFolderPickError(err) };
      }
    },

    disconnectSaveFolder: () => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      set({ saveDirHandle: null, saveDirName: null, saveDirSource: null, saveStatus: 'idle', saveError: null });
    },

    saveAllToFolder: async (opts) => {
      const state = get();
      if (!state.saveDirHandle) {
        return { ok: false, message: '저장 폴더가 연결되지 않았습니다. 먼저 저장 폴더를 연결해주세요.' };
      }
      if (!opts?.silent) set({ saveStatus: 'saving' });
      try {
        const granted = await verifyPermission(state.saveDirHandle, 'readwrite');
        if (!granted) {
          set({ saveStatus: 'error', saveError: '폴더 쓰기 권한이 없습니다.' });
          return { ok: false, message: '폴더 쓰기 권한이 없습니다.' };
        }
        const dataDir = await getDataDir(state.saveDirHandle);
        const now = new Date().toISOString();

        const appStatePayload = {
          version: 1,
          updatedAt: now,
          darkMode: state.darkMode,
          selectedSceneId: state.selectedSceneId,
          scenes: sanitizeScenesForSave(state.scenes),
          currentProjectMeta: state.currentProject
            ? {
                id: state.currentProject.id,
                name: state.currentProject.name,
                folderPath: state.currentProject.folderPath,
                createdAt: state.currentProject.createdAt,
                modifiedAt: now,
              }
            : null,
          llmBaseUrl: state.llmBaseUrl,
          llmModel: state.llmModel,
          llmMode: state.llmMode,
          subtitleFontName: state.subtitleFontName,
        };
        const chatPayload = { version: 1, updatedAt: now, messages: state.chatMessages };
        const logPayload = { version: 1, updatedAt: now, entries: state.editLog.slice(-MAX_LOG_ENTRIES) };

        await writeJsonFile(dataDir, APP_STATE_FILE, appStatePayload);
        await writeJsonFile(dataDir, CHAT_HISTORY_FILE, chatPayload);
        await writeJsonFile(dataDir, EDIT_LOG_FILE, logPayload);

        set({ saveStatus: 'saved', saveError: null, lastSavedAt: now });
        return { ok: true };
      } catch (err: any) {
        console.error(err);
        set({ saveStatus: 'error', saveError: '저장 중 문제가 발생했습니다.' });
        return { ok: false, message: '저장 중 문제가 발생했습니다.' };
      }
    },

    saveNamedProject: async (name) => {
      const state = get();
      if (!state.saveDirHandle) {
        return { ok: false, message: '저장 폴더가 연결되지 않았습니다. 먼저 저장 폴더를 연결해주세요.' };
      }
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, message: '프로젝트 이름을 입력해주세요.' };
      try {
        const granted = await verifyPermission(state.saveDirHandle, 'readwrite');
        if (!granted) return { ok: false, message: '폴더 쓰기 권한이 없습니다.' };

        const dataDir = await getDataDir(state.saveDirHandle);
        const projectsDir = await getProjectsDir(dataDir);
        const safeName = trimmed.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
        const fileName = `${safeName}.json`;
        const now = new Date().toISOString();
        const sanitizedScenes = sanitizeScenesForSave(state.scenes);
        const existing = state.currentProject && state.currentProject.name === trimmed ? state.currentProject : null;
        const project: Project = {
          id: existing?.id ?? genId('proj'),
          name: trimmed,
          folderPath: `${state.saveDirName ?? ''}/KWJMvideoAI_data/projects/${fileName}`,
          createdAt: existing?.createdAt ?? now,
          modifiedAt: now,
          scenes: sanitizedScenes,
          thumbnail: sanitizedScenes[0]?.photoRef,
        };
        await writeJsonFile(projectsDir, fileName, project);
        set({ currentProject: { ...project, scenes: state.scenes } });
        addLogEntry('project_save', `프로젝트 "${trimmed}" 저장됨 (파일: ${fileName})`);
        await get().saveAllToFolder({ silent: true });
        return { ok: true, message: `프로젝트가 "${fileName}" 파일로 저장되었습니다.` };
      } catch (err: any) {
        console.error(err);
        return { ok: false, message: '프로젝트를 저장하는 중 문제가 발생했습니다.' };
      }
    },

    listNamedProjects: async () => {
      const state = get();
      if (!state.saveDirHandle) return [];
      try {
        const dataDir = await getDataDir(state.saveDirHandle);
        const projectsDir = await getProjectsDir(dataDir);
        const files = await listJsonFiles(projectsDir);
        const results = await Promise.all(
          files.map(async (f) => {
            try {
              const data = await readJsonFile(f.handle);
              return {
                name: f.name,
                handle: f.handle,
                modifiedAt: typeof data?.modifiedAt === 'string' ? data.modifiedAt : undefined,
                sceneCount: Array.isArray(data?.scenes) ? data.scenes.length : undefined,
              };
            } catch {
              return { name: f.name, handle: f.handle };
            }
          })
        );
        return results;
      } catch (err) {
        console.error(err);
        return [];
      }
    },

    loadNamedProject: async (fileHandle) => {
      try {
        const data = await readJsonFile(fileHandle);
        if (!data || !Array.isArray(data.scenes)) {
          return { ok: false, message: '올바른 프로젝트 파일 형식이 아닙니다.' };
        }
        const project: Project = {
          id: typeof data.id === 'string' ? data.id : genId('proj'),
          name: typeof data.name === 'string' ? data.name : '이름 없는 프로젝트',
          folderPath: typeof data.folderPath === 'string' ? data.folderPath : '',
          createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
          modifiedAt: typeof data.modifiedAt === 'string' ? data.modifiedAt : new Date().toISOString(),
          scenes: data.scenes,
          thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : data.scenes[0]?.photoRef,
        };
        set({ currentProject: project, scenes: project.scenes, selectedSceneId: project.scenes[0]?.id ?? null });
        addLogEntry('project_load', `프로젝트 "${project.name}" 불러옴`);
        await get().resyncMediaReferences();
        return { ok: true };
      } catch (err) {
        console.error(err);
        return { ok: false, message: '파일을 읽는 중 문제가 발생했습니다.' };
      }
    },

    deleteNamedProject: async (fileName) => {
      const state = get();
      if (!state.saveDirHandle) {
        return { ok: false, message: '저장 폴더가 연결되지 않았습니다.' };
      }
      try {
        const granted = await verifyPermission(state.saveDirHandle, 'readwrite');
        if (!granted) return { ok: false, message: '폴더 쓰기 권한이 없습니다.' };
        const dataDir = await getDataDir(state.saveDirHandle);
        const projectsDir = await getProjectsDir(dataDir);
        await projectsDir.removeEntry(fileName);
        addLogEntry('project_delete', `프로젝트 파일 삭제: "${fileName}"`);
        return { ok: true, message: '프로젝트가 삭제되었습니다.' };
      } catch (err) {
        console.error(err);
        return { ok: false, message: '프로젝트를 삭제하는 중 문제가 발생했습니다.' };
      }
    },

    // 2026-07-27(2): 이전 "미디어 폴더 연결"(mediaDirHandle) 개념을 완전히 제거하고 저장
    // 폴더(자동 저장소 포함)와 하나로 합쳤습니다. 새 사진/영상을 등록하는 것도, 이미 등록된
    // 미디어를 살펴보는 것도 모두 현재 프로젝트의 KWJMvideoAI_data/projects/<프로젝트명>/media/
    // 폴더 하나만 사용합니다. 이 기능은 실제 폴더가 연결되어 있어야만(OPFS 자동 저장소만으로는
    // 부족) 동작합니다 — 사용자가 먼저 저장 폴더를 등록하도록 안내합니다.
    listProjectMediaFiles: async () => {
      const state = get();
      if (!state.saveDirHandle || state.saveDirSource !== 'external') return [];
      try {
        const dataDir = await getDataDir(state.saveDirHandle);
        const projectName = state.currentProject?.name || '임시_프로젝트';
        const mediaDir = await getProjectMediaDir(dataDir, projectName);
        return await listMediaFiles(mediaDir, 1);
      } catch (err) {
        console.error(err);
        return [];
      }
    },
    addFilesToProjectMedia: async (files) => {
      const state = get();
      if (!state.saveDirHandle || state.saveDirSource !== 'external') {
        return { ok: false, message: '실제 저장 폴더를 먼저 등록해야 사진/영상을 등록할 수 있습니다. 저장 폴더를 연결해주세요.' };
      }
      try {
        const granted = await verifyPermission(state.saveDirHandle, 'readwrite');
        if (!granted) return { ok: false, message: '폴더 쓰기 권한이 없습니다.' };
        const dataDir = await getDataDir(state.saveDirHandle);
        const projectName = state.currentProject?.name || '임시_프로젝트';
        const mediaDir = await getProjectMediaDir(dataDir, projectName);
        const added: MediaFileEntry[] = [];
        for (const file of files) {
          const fileName = buildUniqueMediaFileName(file.name);
          await writeBinaryFile(mediaDir, fileName, file);
          const lower = fileName.toLowerCase();
          const kind: 'image' | 'video' = /\.(mp4|mov|webm|mkv|avi|m4v)$/.test(lower) ? 'video' : 'image';
          const handle = await mediaDir.getFileHandle(fileName, { create: false });
          added.push({ name: fileName, path: fileName, handle, kind });
        }
        addLogEntry('media_upload', `미디어 라이브러리에 파일 ${added.length}개 등록됨 → "${projectName}" 프로젝트 media 폴더`);
        scheduleAutosave();
        return { ok: true, message: `${added.length}개 파일이 저장되었습니다.`, added };
      } catch (err) {
        console.error(err);
        return { ok: false, message: '파일을 저장하는 중 문제가 발생했습니다.' };
      }
    },
    resyncMediaReferences: async () => {
      const state = get();
      const needsResync = state.scenes.some((sc) => sc.localImageName || (sc.localVideoName && !sc.localVideoUrl));
      if (!needsResync || !state.saveDirHandle) return;

      let projectMediaDir: any = null;
      try {
        const dataDir = await getDataDir(state.saveDirHandle);
        const projectName = state.currentProject?.name || '임시_프로젝트';
        projectMediaDir = await getProjectMediaDir(dataDir, projectName);
      } catch (err) {
        console.error(err);
      }

      const resolveFile = async (name: string): Promise<any | null> => {
        if (projectMediaDir) {
          try {
            return await projectMediaDir.getFileHandle(name, { create: false });
          } catch {
            // 프로젝트 미디어 폴더에도 없으면 조용히 무시
          }
        }
        return null;
      };

      const updated = await Promise.all(
        state.scenes.map(async (sc) => {
          let next = sc;
          if (sc.localImageName) {
            try {
              const fh = await resolveFile(sc.localImageName);
              if (fh) next = { ...next, photoRef: await fileHandleToObjectUrl(fh) };
            } catch (err) {
              console.error(err);
            }
          }
          if (sc.localVideoName && !sc.localVideoUrl) {
            try {
              const fh = await resolveFile(sc.localVideoName);
              if (fh) next = { ...next, localVideoUrl: await fileHandleToObjectUrl(fh) };
            } catch (err) {
              console.error(err);
            }
          }
          return next;
        })
      );
      set({ scenes: updated });
    },

    // 2026-07-27(4): "비슷한 이미지 추천"용 프로젝트 미디어 분석 캐시. 저장 폴더 안
    // projects/<프로젝트명>/media_analysis.json에 그대로 저장/재사용됩니다(섹션 상단
    // MediaAnalysisEntry, analyzeMediaFileName 참고).
    mediaAnalysisCache: {},
    ensureProjectMediaAnalysis: async () => {
      const state = get();
      if (!state.saveDirHandle || state.saveDirSource !== 'external') return [];
      const projectName = state.currentProject?.name || '임시_프로젝트';
      try {
        const dataDir = await getDataDir(state.saveDirHandle);
        const projectDir = await getProjectDir(dataDir, projectName);
        const mediaDir = await getProjectMediaDir(dataDir, projectName);
        const files = await listMediaFiles(mediaDir, 1);

        // 폴더 지정된 경우, 이미 분석해둔 데이터가 있으면(메모리 캐시 우선, 없으면
        // media_analysis.json 파일) 그대로 사용하고 새 파일만 추가로 분석합니다.
        let existing: MediaAnalysisEntry[] | undefined = get().mediaAnalysisCache[projectName];
        if (!existing) {
          const stored = await readJsonFileIfExists(projectDir, MEDIA_ANALYSIS_FILE_NAME);
          existing = Array.isArray(stored?.entries) ? stored.entries : [];
        }
        const existingByPath = new Map((existing ?? []).map((e) => [e.path, e]));

        let changed = false;
        const merged: MediaAnalysisEntry[] = [];
        for (const f of files) {
          let size = 0;
          let lastModified = 0;
          try {
            const file = await f.handle.getFile();
            size = file.size;
            lastModified = file.lastModified;
          } catch (err) {
            console.error(err);
          }
          const prev = existingByPath.get(f.path);
          if (prev && prev.size === size && prev.lastModified === lastModified) {
            merged.push(prev);
            continue;
          }
          // 새 파일이거나 내용이 바뀐 파일 — 데이터가 없으므로 새로 생성합니다.
          changed = true;
          const { tags, caption } = analyzeMediaFileName(f.name, f.kind);
          merged.push({ path: f.path, kind: f.kind, size, lastModified, tags, caption, analyzedAt: new Date().toISOString() });
        }
        // 파일이 삭제되어 목록에서 빠진 항목도 자동으로 걸러집니다(merged가 곧 최신 목록).
        if (changed || merged.length !== (existing?.length ?? 0)) {
          try {
            await writeJsonFile(projectDir, MEDIA_ANALYSIS_FILE_NAME, {
              updatedAt: new Date().toISOString(),
              entries: merged,
            });
          } catch (err) {
            console.error(err);
          }
        }
        set((s) => ({ mediaAnalysisCache: { ...s.mediaAnalysisCache, [projectName]: merged } }));
        return merged;
      } catch (err) {
        console.error(err);
        return [];
      }
    },

    // ── 블로그 데이터 폴더 ────────────────────────────────────────────────
    blogDirHandle: null,
    blogDirName: null,
    blogPosts: [],
    blogMedia: [],
    blogCategories: [],
    blogAuthorLabels: { gyeongwoo: '경우', jungmin: '정민', other: '기타' },
    connectBlogDataFolder: async () => {
      try {
        const handle = await pickDirectory('read');
        if (!handle) return { ok: false, message: '폴더 선택이 취소되었습니다.' };
        const granted = await verifyPermission(handle, 'read');
        if (!granted) return { ok: false, message: '폴더 읽기 권한이 거부되었습니다.' };
        const data = await readBlogData(handle);
        if (data.posts.length === 0) {
          return {
            ok: false,
            message: `"${handle.name}" 폴더에서 posts.json을 찾지 못했습니다. 블로그가 데이터를 저장하는 폴더(data 폴더)를 선택했는지 확인해주세요.`,
          };
        }
        set({
          blogDirHandle: handle,
          blogDirName: handle.name,
          blogPosts: data.posts,
          blogMedia: data.media,
          blogCategories: data.categories,
          blogAuthorLabels: data.authorLabels,
        });
        addLogEntry('blog_connect', `블로그 데이터 폴더 연결됨: "${handle.name}" (글 ${data.posts.length}개)`);
        return {
          ok: true,
          message: `블로그 글 ${data.posts.length}개, 사진/영상 ${data.media.length}개를 불러왔습니다.${
            data.hasMediaMetaFile ? '' : ' (media-meta.json은 없지만, 글 본문에서 사진/영상을 직접 찾았습니다)'
          }`,
        };
      } catch (err) {
        console.error(err);
        return { ok: false, message: describeFolderPickError(err) };
      }
    },
    disconnectBlogDataFolder: () => {
      set({
        blogDirHandle: null,
        blogDirName: null,
        blogPosts: [],
        blogMedia: [],
        blogCategories: [],
        blogSelectedPostIds: [],
      });
    },
    blogSelectedPostIds: [],
    setBlogSelectedPostIds: (ids) => set({ blogSelectedPostIds: ids }),

    // ── LM Studio / FFmpeg 설정 ────────────────────────────────────────────
    llmBaseUrl: 'http://localhost:1234/v1',
    setLlmBaseUrl: (v) => {
      set({ llmBaseUrl: v, llmStatus: 'unknown' });
      scheduleAutosave();
    },
    llmModel: 'qwen3.5-9b',
    setLlmModel: (v) => {
      set({ llmModel: v });
      scheduleAutosave();
    },
    llmStatus: 'unknown',
    setLlmStatus: (v) => set({ llmStatus: v }),
    llmAvailableModels: [],
    setLlmAvailableModels: (v) => set({ llmAvailableModels: v }),
    llmMode: 'normal',
    setLlmMode: (v) => {
      set({ llmMode: v });
      scheduleAutosave();
    },

    subtitleFontName: '',
    setSubtitleFontName: (v) => {
      set({ subtitleFontName: v });
      scheduleAutosave();
    },
  };
});
