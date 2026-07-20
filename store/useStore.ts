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
  findMediaFileByName,
  fileHandleToObjectUrl,
  type MediaFileEntry,
} from '@/lib/fsAccess';

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
export type ModalState = null | 'new-project' | 'load' | 'export' | 'media';

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

이미지·영상 원본 파일은 이 폴더에 복사되지 않습니다. 앱에서 별도로
연결한 "미디어 폴더"에 있는 파일을 그대로 참조(파일명 기억)하며,
같은 미디어 폴더를 다시 연결하면 자동으로 미리보기가 복원됩니다.

이 폴더를 지우거나 옮기면 저장된 기록도 함께 사라지니 주의하세요.
`;

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

const SAMPLE_SCENES: Scene[] = [
  {
    id: 'scene_001',
    customTitle: '제주 바다 도착',
    photoRef: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=450&fit=crop&auto=format',
    narration: '2023년 여름, 우리 가족은 에메랄드빛 바다가 매력적인 제주도로 첫발을 내디뎠다. 눈부신 햇살 아래 펼쳐진 수평선이 우리를 반겼다.',
    dialogue: '와, 바다다! 너무 예뻐요! 어서 가요!',
    duration: 5,
    tags: ['해변', '바다', '제주'],
  },
  {
    id: 'scene_002',
    customTitle: '해변 산책',
    photoRef: 'https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=800&h=450&fit=crop&auto=format',
    narration: '고운 모래사장을 맨발로 걸으며 아이들은 조개껍질을 줍고, 어른들은 시원한 파도 소리에 피로를 씻었다.',
    dialogue: '아빠, 이것 봐! 소라 껍데기야. 가져가도 돼요?',
    duration: 4,
    tags: ['해변', '산책', '가족'],
  },
  {
    id: 'scene_003',
    customTitle: '오름 하이킹',
    photoRef: 'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=800&h=450&fit=crop&auto=format',
    narration: '이튿날 아침, 우리는 성산일출봉 근처 오름에 올랐다. 초록빛 능선이 발아래 펼쳐지며 제주의 진짜 얼굴을 보여줬다.',
    dialogue: '여기서 보면 제주가 전부 보이네. 정말 아름답다.',
    duration: 6,
    tags: ['오름', '자연', '하이킹'],
  },
  {
    id: 'scene_004',
    customTitle: '감성 카페 방문',
    photoRef: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=800&h=450&fit=crop&auto=format',
    narration: '하산 후 들른 감성 카페에서 제주산 감귤 에이드 한 잔. 지친 다리를 쉬어가며 창밖 풍경에 취했다.',
    dialogue: '이 에이드 진짜 맛있다. 제주 오길 잘했어.',
    duration: 4,
    tags: ['카페', '휴식', '음료'],
  },
  {
    id: 'scene_005',
    customTitle: '노을빛 마무리',
    photoRef: 'https://images.unsplash.com/photo-1542315149-c146eb4a0fc0?w=800&h=450&fit=crop&auto=format',
    narration: '저녁 무렵 바닷가에서 마주한 붉은 노을. 짧았지만 가슴 가득 채워진 제주의 시간이 하루를 아름답게 닫았다.',
    dialogue: '오늘 정말 행복했지? 내년에 또 오자.',
    duration: 7,
    tags: ['노을', '석양', '감성'],
  },
];

const SAMPLE_PROJECT: Project = {
  id: 'proj_sample',
  name: '제주 가족 여행 브이로그 (샘플)',
  folderPath: '샘플 데이터 — 실제 파일 아님',
  createdAt: '2023-08-15T09:00:00Z',
  modifiedAt: '2023-08-20T14:30:00Z',
  scenes: SAMPLE_SCENES,
  thumbnail: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=225&fit=crop&auto=format',
};

const SAMPLE_PROJECTS: Project[] = [
  SAMPLE_PROJECT,
  {
    id: 'proj_002',
    name: '서울 일상 브이로그 (샘플)',
    folderPath: '샘플 데이터 — 실제 파일 아님',
    createdAt: '2023-09-01T10:00:00Z',
    modifiedAt: '2023-09-05T16:00:00Z',
    scenes: SAMPLE_SCENES.slice(0, 3),
    thumbnail: 'https://images.unsplash.com/photo-1601621915196-2621bfb0cd6e?w=400&h=225&fit=crop&auto=format',
  },
  {
    id: 'proj_003',
    name: '부산 바다 여행 (샘플)',
    folderPath: '샘플 데이터 — 실제 파일 아님',
    createdAt: '2023-10-10T08:00:00Z',
    modifiedAt: '2023-10-12T20:00:00Z',
    scenes: SAMPLE_SCENES.slice(0, 2),
    thumbnail: 'https://images.unsplash.com/photo-1594736797933-d0401ba2fe65?w=400&h=225&fit=crop&auto=format',
  },
];

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
  applyImageToScene: (id: string, photoRef: string, opts?: { localImageName?: string | null; logMessage?: string }) => void;
  applyLocalVideoToScene: (id: string, fileEntry: MediaFileEntry) => Promise<void>;

  selectedSceneId: string | null;
  setSelectedSceneId: (id: string | null) => void;

  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;
  savedProjects: Project[];
  setSavedProjects: (projects: Project[]) => void;

  chatMessages: ChatMessage[];
  addChatMessage: (role: 'user' | 'assistant', text: string) => void;
  setChatMessages: (messages: ChatMessage[]) => void;

  editLog: EditLogEntry[];
  pushEditLog: (type: string, message: string) => void;

  saveDirHandle: any | null;
  saveDirName: string | null;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: (v: boolean) => void;
  saveStatus: SaveStatus;
  saveError: string | null;
  lastSavedAt: string | null;
  connectSaveFolder: () => Promise<{ ok: boolean; message?: string }>;
  disconnectSaveFolder: () => void;
  saveAllToFolder: (opts?: { silent?: boolean }) => Promise<{ ok: boolean; message?: string }>;
  saveNamedProject: (name: string) => Promise<{ ok: boolean; message?: string }>;
  listNamedProjects: () => Promise<{ name: string; handle: any; modifiedAt?: string; sceneCount?: number }[]>;
  loadNamedProject: (fileHandle: any) => Promise<{ ok: boolean; message?: string }>;

  mediaDirHandle: any | null;
  mediaDirName: string | null;
  connectMediaFolder: () => Promise<{ ok: boolean; message?: string }>;
  disconnectMediaFolder: () => void;
  resyncMediaReferences: () => Promise<void>;
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

  return {
    view: 'editor',
    setView: (view) => set({ view }),
    modal: null,
    setModal: (modal) => set({ modal }),

    darkMode: false,
    setDarkMode: (v) => {
      set({ darkMode: v });
      scheduleAutosave();
    },

    scenes: SAMPLE_SCENES,
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
          sc.id === id ? { ...sc, photoRef, localImageName: opts?.localImageName ?? undefined } : sc
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

    selectedSceneId: 'scene_001',
    setSelectedSceneId: (id) => set({ selectedSceneId: id }),

    currentProject: SAMPLE_PROJECT,
    setCurrentProject: (project) => set({ currentProject: project, scenes: project?.scenes ?? [] }),
    savedProjects: SAMPLE_PROJECTS,
    setSavedProjects: (projects) => set({ savedProjects: projects }),

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
    autoSaveEnabled: true,
    setAutoSaveEnabled: (v) => set({ autoSaveEnabled: v }),
    saveStatus: 'idle',
    saveError: null,
    lastSavedAt: null,

    connectSaveFolder: async () => {
      const handle = await pickDirectory('readwrite');
      if (!handle) return { ok: false, message: '폴더 선택이 취소되었습니다.' };

      const granted = await verifyPermission(handle, 'readwrite');
      if (!granted) {
        return { ok: false, message: '폴더 쓰기 권한이 거부되었습니다.' };
      }

      try {
        const dataDir = await getDataDir(handle);

        const [appState, chatData, logData] = await Promise.all([
          readJsonFileIfExists(dataDir, APP_STATE_FILE),
          readJsonFileIfExists(dataDir, CHAT_HISTORY_FILE),
          readJsonFileIfExists(dataDir, EDIT_LOG_FILE),
        ]);

        const existingReadme = await readTextFileIfExists(handle, README_FILE);
        if (existingReadme === null) {
          await writeTextFile(handle, README_FILE, README_CONTENT);
        }

        set({ saveDirHandle: handle, saveDirName: handle.name, saveStatus: 'idle', saveError: null });

        if (appState && Array.isArray(appState.scenes) && appState.scenes.length > 0) {
          set({
            scenes: appState.scenes,
            darkMode: typeof appState.darkMode === 'boolean' ? appState.darkMode : get().darkMode,
            selectedSceneId: appState.selectedSceneId ?? appState.scenes[0]?.id ?? null,
          });
          if (appState.currentProjectMeta) {
            set((s) => ({
              currentProject: {
                ...appState.currentProjectMeta,
                scenes: s.scenes,
              },
            }));
          }
        }
        if (chatData && Array.isArray(chatData.messages) && chatData.messages.length > 0) {
          set({ chatMessages: chatData.messages });
        }
        if (logData && Array.isArray(logData.entries)) {
          set({ editLog: logData.entries });
        }

        addLogEntry('folder_connect', `저장 폴더 연결됨: "${handle.name}"`);

        const restored = Boolean(appState || chatData);
        return {
          ok: true,
          message: restored
            ? `"${handle.name}" 폴더에서 이전 저장 내용을 불러왔습니다.`
            : `"${handle.name}" 폴더에 새로 연결되었습니다.`,
        };
      } catch (err: any) {
        console.error(err);
        return { ok: false, message: '폴더를 여는 중 문제가 발생했습니다.' };
      }
    },

    disconnectSaveFolder: () => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      set({ saveDirHandle: null, saveDirName: null, saveStatus: 'idle', saveError: null });
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
          mediaDirName: state.mediaDirName,
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

    mediaDirHandle: null,
    mediaDirName: null,
    connectMediaFolder: async () => {
      const handle = await pickDirectory('read');
      if (!handle) return { ok: false, message: '폴더 선택이 취소되었습니다.' };
      const granted = await verifyPermission(handle, 'read');
      if (!granted) return { ok: false, message: '폴더 읽기 권한이 거부되었습니다.' };
      set({ mediaDirHandle: handle, mediaDirName: handle.name });
      addLogEntry('media_connect', `미디어 폴더 연결됨: "${handle.name}"`);
      await get().resyncMediaReferences();
      scheduleAutosave();
      return { ok: true, message: `"${handle.name}" 폴더에 연결되었습니다.` };
    },
    disconnectMediaFolder: () => {
      set({ mediaDirHandle: null, mediaDirName: null });
    },
    resyncMediaReferences: async () => {
      const state = get();
      if (!state.mediaDirHandle) return;
      const updated = await Promise.all(
        state.scenes.map(async (sc) => {
          let next = sc;
          if (sc.localImageName) {
            try {
              const fh = await findMediaFileByName(state.mediaDirHandle, sc.localImageName);
              if (fh) {
                const url = await fileHandleToObjectUrl(fh);
                next = { ...next, photoRef: url };
              }
            } catch (err) {
              console.error(err);
            }
          }
          if (sc.localVideoName && !sc.localVideoUrl) {
            try {
              const fh = await findMediaFileByName(state.mediaDirHandle, sc.localVideoName);
              if (fh) {
                const url = await fileHandleToObjectUrl(fh);
                next = { ...next, localVideoUrl: url };
              }
            } catch (err) {
              console.error(err);
            }
          }
          return next;
        })
      );
      set({ scenes: updated });
    },
  };
});
