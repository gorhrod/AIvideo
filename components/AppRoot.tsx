'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useStore, sanitizeScenesForSave } from '@/store/useStore';
import type { Scene, Project, LlmMode } from '@/store/useStore';
import {
  isFileSystemAccessSupported,
  pickDirectory,
  listJsonFiles,
  readJsonFile,
  getDataDir,
  getOrCreateSubDirectory,
  writeTextFile,
  listMediaFiles,
  fileHandleToObjectUrl,
  type MediaFileEntry,
} from '@/lib/fsAccess';
import { cn, getSceneImageSrc, formatShortDateTime, getExportResolution } from '@/lib/utils';
import {
  filterPostsByDateRange,
  getMediaForPosts,
  blogMediaPreviewUrl,
  blogMediaFileName,
  stripHtml,
  type BlogMediaMeta,
} from '@/lib/blogData';
import {
  streamChat,
  checkLlmHealth,
  generateStoryboardFromChat,
  generateStoryboardFromMedia,
  generateStoryboardFromPosts,
  regenerateSceneNarration,
  CHAT_SYSTEM_PROMPT,
  buildBlogContextText,
  type MediaDescriptor,
  type PostTextDescriptor,
} from '@/lib/llm';
import { buildSrt, buildPlainTextScript, totalDuration } from '@/lib/subtitles';
import { CAPTION_STYLE_PRESETS, DEFAULT_CAPTION_STYLE_ID } from '@/lib/captionStyles';
import {
  Film,
  MessageSquare,
  FolderOpen,
  FolderPlus,
  Download,
  Upload,
  Moon,
  Sun,
  ArrowUp,
  ArrowDown,
  Trash2,
  RefreshCw,
  Plus,
  Image as ImageIcon,
  FileText,
  Clapperboard,
  Sparkles,
  Clock,
  Tag,
  X,
  Check,
  Folder,
  FolderCheck,
  Play,
  LayoutGrid,
  AlertCircle,
  Loader2,
  Save,
  Link2,
  Link2Off,
  Video,
  Info,
  Settings,
  Newspaper,
  Send,
  Wand2,
  WifiOff,
  CheckSquare,
  Images,
  Zap,
  Gauge,
  Search,
  ImageOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Recommendation pools ────────────────────────────────────────────────────

const RECOMMEND_POOLS: Record<string, string[]> = {
  beach: [
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1519046904884-53103b34b206?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1509233725247-49e657c54213?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&h=300&fit=crop&auto=format',
  ],
  nature: [
    'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?w=400&h=300&fit=crop&auto=format',
  ],
  cafe: [
    'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=300&fit=crop&auto=format',
  ],
  sunset: [
    'https://images.unsplash.com/photo-1542315149-c146eb4a0fc0?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=300&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1474524955719-b9f87c50ce47?w=400&h=300&fit=crop&auto=format',
  ],
};

function getRecommendations(scene: Scene): string[] {
  const tags = scene.tags ?? [];
  let pool = RECOMMEND_POOLS.beach;
  if (tags.some((t) => ['오름', '자연', '하이킹'].includes(t))) pool = RECOMMEND_POOLS.nature;
  else if (tags.some((t) => ['카페', '음료'].includes(t))) pool = RECOMMEND_POOLS.cafe;
  else if (tags.some((t) => ['노을', '석양'].includes(t))) pool = RECOMMEND_POOLS.sunset;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 4);
}

/**
 * LLM이 골라준 mediaId(블로그 media-meta의 id)를 실제 사진/영상 파일로 변환해 씬에 채워 넣습니다.
 * mediaId가 없거나 파일을 찾지 못하면 태그 기반 추천 이미지로 대체합니다.
 */
async function resolveScenesWithBlogMedia(
  scenes: Omit<Scene, 'id'>[],
  mediaIds: (string | null)[],
  blogDirHandle: any,
  blogMedia: BlogMediaMeta[]
): Promise<Scene[]> {
  // 2026-07-23: 각 장면의 미디어 파일 읽기는 서로 독립적이므로 순차 대기 대신 병렬로 처리해
  // 장면 수가 많은 프로젝트에서 스토리보드 생성 체감 속도를 높입니다.
  return Promise.all(
    scenes.map(async (base, i) => {
    const mediaId = mediaIds[i];
    let photoRef = '';
    let localImageName: string | undefined;
    let localVideoName: string | undefined;
    let localVideoUrl: string | undefined;
    let sourceMediaId: string | undefined;
    let sourcePostId: string | undefined;

    if (mediaId && blogDirHandle) {
      const item = blogMedia.find((m) => m.id === mediaId);
      if (item) {
        try {
          const url = await blogMediaPreviewUrl(blogDirHandle, item);
          if (url) {
            if (item.type === 'video') {
              localVideoName = blogMediaFileName(item.url);
              localVideoUrl = url;
            } else {
              localImageName = blogMediaFileName(item.url);
              photoRef = url;
            }
            sourceMediaId = item.id;
            sourcePostId = item.postId;
          }
        } catch (err) {
          console.error('블로그 미디어를 불러오지 못했습니다:', err);
        }
      }
    }

    if (!photoRef && !localVideoUrl) {
      photoRef = getRecommendations({ tags: base.tags } as Scene)[0] ?? RECOMMEND_POOLS.beach[0];
    }

      return {
        id: genId('scene'),
        ...base,
        photoRef,
        localImageName,
        localVideoName,
        localVideoUrl,
        sourceMediaId,
        sourcePostId,
      };
    })
  );
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function AppRoot() {
  const { view, setView, modal, setModal, darkMode, setDarkMode, initStorage } = useStore();

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  // 2026-07-25: 앱을 열 때마다 1회, 저장 폴더를 자동으로 준비합니다 — 기억해둔 폴더에
  // 조용히 재연결을 시도하고, 안 되면 브라우저 내부 자동 저장소(OPFS)로 즉시 연결해
  // 사용자가 폴더를 고르지 않아도 바로 자동저장이 시작되도록 합니다.
  useEffect(() => {
    initStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={cn(
        'h-dvh w-full flex flex-col font-sans transition-colors duration-300 overflow-hidden',
        darkMode ? 'bg-neutral-950 text-neutral-100' : 'bg-neutral-50 text-neutral-900'
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className={cn(
          'h-14 border-b flex items-center justify-between px-5 shrink-0 z-20 backdrop-blur-sm',
          darkMode
            ? 'border-neutral-800 bg-neutral-950/90'
            : 'border-neutral-200 bg-white/90'
        )}
      >
        <div className="flex items-center gap-5">
          {/* Logo */}
          <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 shrink-0">
            <Clapperboard className="w-5 h-5" />
            <span className="font-bold text-base tracking-tight">KWJMvideoAI</span>
          </div>

          {/* Divider */}
          <div className={cn('w-px h-5', darkMode ? 'bg-neutral-800' : 'bg-neutral-200')} />

          {/* Nav */}
          <nav className="flex items-center gap-1">
            <HeaderNavBtn
              icon={<MessageSquare className="w-3.5 h-3.5" />}
              label="채팅"
              active={view === 'chat'}
              onClick={() => setView('chat')}
              darkMode={darkMode}
            />
            <HeaderNavBtn
              icon={<Clapperboard className="w-3.5 h-3.5" />}
              label="스토리보드 편집기"
              active={view === 'editor'}
              onClick={() => setView('editor')}
              darkMode={darkMode}
            />
            <div className={cn('w-px h-4 mx-1', darkMode ? 'bg-neutral-800' : 'bg-neutral-200')} />
            <HeaderNavBtn
              icon={<FolderPlus className="w-3.5 h-3.5" />}
              label="새 프로젝트"
              onClick={() => setModal('new-project')}
              darkMode={darkMode}
            />
            <HeaderNavBtn
              icon={<FolderOpen className="w-3.5 h-3.5" />}
              label="불러오기"
              onClick={() => setModal('load')}
              darkMode={darkMode}
            />
            <HeaderNavBtn
              icon={<Download className="w-3.5 h-3.5" />}
              label="내보내기"
              onClick={() => setModal('export')}
              darkMode={darkMode}
            />
            <HeaderNavBtn
              icon={<ImageIcon className="w-3.5 h-3.5" />}
              label="미디어 라이브러리"
              onClick={() => setModal('media')}
              darkMode={darkMode}
            />
            <HeaderNavBtn
              icon={<Newspaper className="w-3.5 h-3.5" />}
              label="블로그에서 가져오기"
              onClick={() => setModal('blog-import')}
              darkMode={darkMode}
            />
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <LlmStatusBadge darkMode={darkMode} onClick={() => setModal('settings')} />

          {/* 설정 */}
          <button
            onClick={() => setModal('settings')}
            title="LM Studio / FFmpeg 설정"
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-lg transition-colors',
              darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-100 text-neutral-500'
            )}
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Dark mode */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-lg transition-colors',
              darkMode
                ? 'hover:bg-neutral-800 text-neutral-400'
                : 'hover:bg-neutral-100 text-neutral-500'
            )}
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* ── Storage Bar (저장 폴더 / 미디어 폴더 상태) ───────────────────────── */}
      <StorageBar darkMode={darkMode} />

      {/* ── AI(LM Studio) 연결 안내 배너 ──────────────────────────────────── */}
      <LlmOfflineBanner darkMode={darkMode} onOpenSettings={() => setModal('settings')} />

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 min-h-0 overflow-hidden flex">
        <AnimatePresence mode="wait">
          {view === 'chat' ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex"
            >
              <ChatInterface onComplete={() => setView('editor')} darkMode={darkMode} />
            </motion.div>
          ) : (
            <motion.div
              key="editor"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex overflow-hidden"
            >
              <EditorInterface darkMode={darkMode} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {modal === 'new-project' && (
          <NewProjectModal darkMode={darkMode} onClose={() => setModal(null)} />
        )}
        {modal === 'load' && (
          <LoadModal darkMode={darkMode} onClose={() => setModal(null)} />
        )}
        {modal === 'export' && (
          <ExportModal darkMode={darkMode} onClose={() => setModal(null)} />
        )}
        {modal === 'media' && (
          <MediaLibraryModal darkMode={darkMode} onClose={() => setModal(null)} />
        )}
        {modal === 'settings' && (
          <SettingsModal darkMode={darkMode} onClose={() => setModal(null)} />
        )}
        {modal === 'blog-import' && (
          <BlogImportModal darkMode={darkMode} onClose={() => setModal(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── LLM(LM Studio) 연결 상태 배지 ──────────────────────────────────────────────

function LlmStatusBadge({ darkMode, onClick }: { darkMode: boolean; onClick: () => void }) {
  const { llmBaseUrl, llmModel, llmStatus, setLlmStatus, setLlmAvailableModels } = useStore();

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      setLlmStatus('checking');
      const health = await checkLlmHealth(llmBaseUrl);
      if (cancelled) return;
      setLlmStatus(health.ok ? 'online' : 'offline');
      if (health.ok) setLlmAvailableModels(health.models);
    };
    check();
    const interval = setInterval(check, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmBaseUrl]);

  const dotColor =
    llmStatus === 'online' ? 'bg-emerald-500' : llmStatus === 'offline' ? 'bg-rose-500' : 'bg-neutral-400';
  const label =
    llmStatus === 'online'
      ? `LM Studio 연결됨 (${llmModel})`
      : llmStatus === 'offline'
      ? 'LM Studio 연결 안 됨'
      : llmStatus === 'checking'
      ? '연결 확인 중...'
      : 'LM Studio';

  return (
    <button
      onClick={onClick}
      title="클릭하여 LM Studio 설정 열기"
      className={cn(
        'hidden md:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-colors',
        darkMode
          ? 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700'
          : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300'
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', dotColor, llmStatus === 'checking' && 'animate-pulse')} />
      <span>{label}</span>
    </button>
  );
}

// ─── AI(LM Studio) 오프라인 안내 배너 ────────────────────────────────────────────
//
// LlmStatusBadge의 작은 점만으로는 "지금 AI 기능을 쓸 수 없다"는 사실을 놓치기 쉽습니다.
// 채팅으로 대화하거나, 미디어를 골라 AI 스토리보드를 만들거나, 장면을 AI로 재생성하려는
// 시도가 전부 이 상태에 걸려 있으므로, LM Studio가 꺼져 있으면 화면 상단에 눈에 띄는
// 배너로 "연결하세요"라고 안내합니다. 같은 오프라인 구간에서 한 번 닫으면 다시 온라인이
// 되었다가 또 오프라인이 될 때까지는 다시 뜨지 않습니다.

function LlmOfflineBanner({ darkMode, onOpenSettings }: { darkMode: boolean; onOpenSettings: () => void }) {
  const { llmStatus } = useStore();
  const [dismissed, setDismissed] = useState(false);
  const prevStatus = useRef(llmStatus);

  useEffect(() => {
    if (prevStatus.current !== 'offline' && llmStatus === 'offline') setDismissed(false);
    if (llmStatus === 'online') setDismissed(false);
    prevStatus.current = llmStatus;
  }, [llmStatus]);

  if (llmStatus !== 'offline' || dismissed) return null;

  return (
    <div
      className={cn(
        'shrink-0 flex items-center justify-between gap-3 px-5 py-2 text-xs border-b',
        darkMode ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-700'
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span className="truncate">
          AI(LM Studio)가 연결되어 있지 않습니다. 채팅, 스토리보드 자동 생성, 장면 AI 재생성 기능을 사용할 수 없습니다. LM Studio 앱을 실행하고 "Local Server"를 시작한 뒤 연결해주세요.
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onOpenSettings}
          className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 transition-colors"
        >
          연결하기
        </button>
        <button
          onClick={() => setDismissed(true)}
          className={cn('w-6 h-6 flex items-center justify-center rounded-lg', darkMode ? 'hover:bg-rose-500/20' : 'hover:bg-rose-100')}
          title="닫기"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Header Nav Button ────────────────────────────────────────────────────────

function HeaderNavBtn({
  icon,
  label,
  active,
  onClick,
  darkMode,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  darkMode: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150',
        active
          ? 'bg-indigo-600 text-white shadow-sm'
          : darkMode
          ? 'hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200'
          : 'hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900'
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ─── Storage Bar (저장 폴더 / 미디어 폴더 상태) ────────────────────────────────

function StorageBar({ darkMode }: { darkMode: boolean }) {
  const {
    saveDirHandle,
    saveDirName,
    saveDirSource,
    rememberedSaveDirName,
    reconnectRememberedSaveFolder,
    mediaDirName,
    saveStatus,
    saveError,
    lastSavedAt,
    autoSaveEnabled,
    setAutoSaveEnabled,
    connectSaveFolder,
    disconnectSaveFolder,
    connectMediaFolder,
    disconnectMediaFolder,
    saveAllToFolder,
  } = useStore();

  const [fsSupported, setFsSupported] = useState(true);
  const [busy, setBusy] = useState<'save' | 'media' | 'reconnect' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setFsSupported(isFileSystemAccessSupported());
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const handleConnectSave = async () => {
    setBusy('save');
    const res = await connectSaveFolder();
    setBusy(null);
    if (res.message) setNotice({ tone: res.ok ? 'ok' : 'error', text: res.message });
  };

  const handleReconnect = async () => {
    setBusy('reconnect');
    const res = await reconnectRememberedSaveFolder();
    setBusy(null);
    if (res.message) setNotice({ tone: res.ok ? 'ok' : 'error', text: res.message });
  };

  const handleManualSave = async () => {
    setBusy('save');
    const res = await saveAllToFolder();
    setBusy(null);
    if (!res.ok && res.message) setNotice({ tone: 'error', text: res.message });
  };

  const handleConnectMedia = async () => {
    setBusy('media');
    const res = await connectMediaFolder();
    setBusy(null);
    if (res.message) setNotice({ tone: res.ok ? 'ok' : 'error', text: res.message });
  };

  // 마지막에 연결했던 실제 폴더가 있는데, 지금은(자동으로) OPFS 자동 저장소만 붙어있는 상태면
  // 한 번의 클릭으로 그 폴더에 다시 연결할 수 있도록 안내합니다.
  const showReconnectHint =
    fsSupported && rememberedSaveDirName && saveDirSource === 'opfs' && rememberedSaveDirName !== saveDirName;

  return (
    <div
      className={cn(
        'shrink-0 border-b px-5 py-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs',
        darkMode ? 'border-neutral-800 bg-neutral-900/60 text-neutral-300' : 'border-neutral-200 bg-neutral-50/80 text-neutral-600'
      )}
    >
      {!fsSupported ? (
        <div className="flex items-center gap-1.5 text-amber-500">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>이 브라우저는 폴더 저장 기능을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.</span>
        </div>
      ) : (
        <>
          {/* 저장 폴더 상태 */}
          <div className="flex items-center gap-1.5">
            {saveDirHandle && saveDirSource === 'external' ? (
              <>
                <FolderCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="font-medium">저장 폴더: "{saveDirName}"</span>
                <button
                  onClick={disconnectSaveFolder}
                  title="저장 폴더 연결 해제"
                  className={cn(
                    'ml-0.5 w-5 h-5 flex items-center justify-center rounded transition-colors',
                    darkMode ? 'hover:bg-neutral-800 text-neutral-500' : 'hover:bg-neutral-200 text-neutral-400'
                  )}
                >
                  <Link2Off className="w-3.5 h-3.5" />
                </button>
              </>
            ) : saveDirHandle && saveDirSource === 'opfs' ? (
              <>
                <Save className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className={cn('font-medium', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
                  자동 저장소 사용 중 (폴더 미연결)
                </span>
                <button
                  onClick={handleConnectSave}
                  disabled={busy === 'save'}
                  className={cn(
                    'ml-1 flex items-center gap-1 font-medium px-2 py-0.5 rounded-md transition-colors',
                    darkMode ? 'text-indigo-400 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'
                  )}
                >
                  {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                  실제 폴더로 옮기기
                </button>
              </>
            ) : (
              <button
                onClick={handleConnectSave}
                disabled={busy === 'save'}
                className={cn(
                  'flex items-center gap-1.5 font-medium px-2.5 py-1 rounded-md transition-colors',
                  darkMode ? 'text-indigo-400 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'
                )}
              >
                {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                저장 폴더 연결
              </button>
            )}
            {showReconnectHint && (
              <button
                onClick={handleReconnect}
                disabled={busy === 'reconnect'}
                title={`이전에 연결했던 "${rememberedSaveDirName}" 폴더에 다시 연결합니다`}
                className={cn(
                  'ml-1 flex items-center gap-1 font-medium px-2 py-0.5 rounded-md border transition-colors',
                  darkMode ? 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10' : 'border-amber-300 text-amber-600 hover:bg-amber-50'
                )}
              >
                {busy === 'reconnect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                "{rememberedSaveDirName}" 다시 연결
              </button>
            )}
          </div>

          <div className={cn('w-px h-4', darkMode ? 'bg-neutral-800' : 'bg-neutral-200')} />

          {/* 미디어 폴더 상태 */}
          <div className="flex items-center gap-1.5">
            {mediaDirName ? (
              <>
                <FolderCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="font-medium">미디어 폴더: "{mediaDirName}"</span>
                <button
                  onClick={disconnectMediaFolder}
                  title="미디어 폴더 연결 해제"
                  className={cn(
                    'ml-0.5 w-5 h-5 flex items-center justify-center rounded transition-colors',
                    darkMode ? 'hover:bg-neutral-800 text-neutral-500' : 'hover:bg-neutral-200 text-neutral-400'
                  )}
                >
                  <Link2Off className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <button
                onClick={handleConnectMedia}
                disabled={busy === 'media'}
                className={cn(
                  'flex items-center gap-1.5 font-medium px-2.5 py-1 rounded-md transition-colors',
                  darkMode ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-emerald-600 hover:bg-emerald-50'
                )}
              >
                {busy === 'media' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
                미디어 폴더 연결
              </button>
            )}
          </div>

          <div className="flex-1" />

          {/* 자동저장 토글 */}
          {saveDirHandle && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoSaveEnabled}
                onChange={(e) => setAutoSaveEnabled(e.target.checked)}
                className="accent-indigo-500 w-3.5 h-3.5"
              />
              <span>자동저장</span>
            </label>
          )}

          {/* 저장 상태 표시 */}
          {saveDirHandle && (
            <span className={cn('font-mono', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
              {saveStatus === 'saving'
                ? '저장 중...'
                : saveStatus === 'error'
                ? saveError ?? '저장 오류'
                : lastSavedAt
                ? `마지막 저장: ${formatShortDateTime(lastSavedAt)}`
                : '아직 저장 안 됨'}
            </span>
          )}

          {/* 저장 버튼 */}
          <button
            onClick={handleManualSave}
            disabled={!saveDirHandle || busy === 'save'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-colors',
              !saveDirHandle
                ? darkMode
                  ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                  : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                : saveStatus === 'saved'
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            )}
            title={saveDirHandle ? '채팅, 장면, 수정 기록을 저장 폴더에 지금 저장합니다' : '먼저 저장 폴더를 연결해주세요'}
          >
            {busy === 'save' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : saveStatus === 'saved' ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            저장
          </button>
        </>
      )}

      {notice && (
        <div
          className={cn(
            'w-full basis-full text-[11px] px-2.5 py-1 rounded-md',
            notice.tone === 'ok'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-rose-500/10 text-rose-500'
          )}
        >
          {notice.text}
        </div>
      )}
    </div>
  );
}

// ─── Chat Interface ───────────────────────────────────────────────────────────

function ChatInterface({ onComplete, darkMode }: { onComplete: () => void; darkMode: boolean }) {
  const {
    chatMessages: messages,
    addChatMessage,
    llmBaseUrl,
    llmModel,
    llmMode,
    llmStatus,
    blogDirName,
    blogPosts,
    blogMedia,
    blogAuthorLabels,
    blogSelectedPostIds,
    setBlogSelectedPostIds,
    blogDirHandle,
    setScenes,
    setSelectedSceneId,
    setCurrentProject,
    setModal,
    pushEditLog,
  } = useStore();
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isBuildingStoryboard, setIsBuildingStoryboard] = useState(false);
  const [buildStage, setBuildStage] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const selectedPosts = blogPosts.filter((p) => blogSelectedPostIds.includes(p.id));
  const selectedMedia = getMediaForPosts(blogMedia, blogSelectedPostIds);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const userMsg = input.trim();
    addChatMessage('user', userMsg);
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const history = [...useStore.getState().chatMessages];
      const openAiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ];
      const blogContext = buildBlogContextText(selectedPosts, selectedMedia, blogAuthorLabels);
      if (blogContext) openAiMessages.push({ role: 'system', content: blogContext });
      for (const m of history) openAiMessages.push({ role: m.role, content: m.text });

      let full = '';
      await streamChat(openAiMessages, {
        baseUrl: llmBaseUrl,
        model: llmModel,
        mode: llmMode,
        temperature: 0.7,
        signal: controller.signal,
        onToken: (chunk) => {
          full += chunk;
          setStreamingText(full);
        },
      });
      addChatMessage('assistant', full.trim() || '(빈 응답을 받았습니다)');
    } catch (err) {
      addChatMessage(
        'assistant',
        `⚠️ LM Studio 서버(${llmBaseUrl})에 연결하지 못했습니다. LM Studio 앱에서 "Local Server"가 켜져 있고, 모델(${llmModel})이 로드되어 있는지 확인한 뒤 다시 시도해주세요. 헤더의 "설정"에서 주소/모델을 바꿀 수 있습니다.`
      );
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      abortRef.current = null;
    }
  };

  const handleBuildStoryboard = async () => {
    if (isBuildingStoryboard || isStreaming) return;
    setIsBuildingStoryboard(true);
    setBuildStage('대화 내용을 분석하는 중...');
    try {
      const { scenes: rawScenes, rawMediaIds } = await generateStoryboardFromChat({
        chatHistory: useStore.getState().chatMessages,
        blogPosts: selectedPosts,
        blogMedia: selectedMedia,
        blogAuthorLabels,
        settings: { baseUrl: llmBaseUrl, model: llmModel, mode: llmMode },
      });

      setBuildStage('사진·영상을 장면에 배치하는 중...');
      const resolved = await resolveScenesWithBlogMedia(rawScenes, rawMediaIds, blogDirHandle, selectedMedia);

      setScenes(resolved);
      setSelectedSceneId(resolved[0]?.id ?? null);
      const now = new Date().toISOString();
      setCurrentProject({
        id: genId('proj'),
        name: resolved[0]?.customTitle ? `${resolved[0].customTitle} 외 ${resolved.length - 1}개 장면` : '새 스토리보드',
        folderPath: '',
        createdAt: now,
        modifiedAt: now,
        scenes: resolved,
      });
      pushEditLog('storyboard_generate', `채팅 내용으로 스토리보드 생성 (${resolved.length}개 장면)`);
      addChatMessage('assistant', `🎬 ${resolved.length}개 장면으로 스토리보드를 만들었어요! 편집기로 이동합니다.`);
      onComplete();
    } catch (err: any) {
      addChatMessage(
        'assistant',
        `⚠️ 스토리보드를 만드는 중 문제가 발생했습니다 (${err?.message ?? '알 수 없는 오류'}). LM Studio 연결 상태를 확인하고 다시 시도해주세요.`
      );
    } finally {
      setIsBuildingStoryboard(false);
      setBuildStage('');
    }
  };

  const suggestions = [
    '제주도 가족 여행 감성 브이로그 만들어줘',
    '서울 한강 피크닉 일상 영상 만들어줘',
    '봄 꽃구경 여행 스토리보드 생성해줘',
  ];

  const hasUserMessage = messages.some((m) => m.role === 'user');
  const canBuild = hasUserMessage && !isStreaming && !isBuildingStoryboard;

  return (
    <div className="flex-1 flex min-h-0">
      {/* Sidebar tips */}
      <div
        className={cn(
          'w-72 border-r p-6 shrink-0 hidden lg:flex flex-col gap-6 overflow-y-auto scrollbar-hide',
          darkMode ? 'border-neutral-800 bg-neutral-900/30' : 'border-neutral-200 bg-neutral-50/50'
        )}
      >
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-indigo-500 mb-3">기능 안내</h3>
          <ul className="space-y-3">
            {[
              { icon: <Sparkles className="w-4 h-4 text-indigo-400" />, text: 'LM Studio의 로컬 LLM이 대화 내용을 분석해 장면을 구성합니다' },
              { icon: <Newspaper className="w-4 h-4 text-sky-400" />, text: '블로그 데이터를 가져오면 실제 사진/영상과 캡션을 근거로 장면을 만듭니다' },
              { icon: <RefreshCw className="w-4 h-4 text-amber-400" />, text: '편집기에서 마음에 들지 않는 나레이션은 AI로 다시 만들 수 있습니다' },
              { icon: <Download className="w-4 h-4 text-rose-400" />, text: '완성된 스토리보드는 자막이 입혀진 MP4로 내보냅니다' },
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <div className="mt-0.5 shrink-0">{item.icon}</div>
                <p className={cn('text-xs leading-relaxed', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
                  {item.text}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-indigo-500 mb-3">블로그 데이터</h3>
          {blogDirName ? (
            <div className="space-y-2">
              <p className={cn('text-xs', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
                "{blogDirName}" 연결됨 · 선택한 글 {selectedPosts.length}개
              </p>
              <button
                onClick={() => setModal('blog-import')}
                className="w-full text-xs px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium transition-colors"
              >
                가져올 글 선택/변경
              </button>
            </div>
          ) : (
            <button
              onClick={() => setModal('blog-import')}
              className={cn(
                'w-full text-left text-xs px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-2',
                darkMode
                  ? 'border-neutral-700 bg-neutral-800/50 hover:border-sky-500 text-neutral-300'
                  : 'border-neutral-200 bg-white hover:border-sky-300 text-neutral-600'
              )}
            >
              <Newspaper className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              블로그 데이터 폴더 연결하기
            </button>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-indigo-500 mb-3">입력 예시</h3>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => setInput(s)}
                className={cn(
                  'w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors',
                  darkMode
                    ? 'border-neutral-700 bg-neutral-800/50 hover:bg-indigo-500/10 hover:border-indigo-500 text-neutral-300'
                    : 'border-neutral-200 bg-white hover:bg-indigo-50 hover:border-indigo-300 text-neutral-600'
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full p-6 min-h-0">
        <div
          className={cn(
            'flex-1 min-h-0 rounded-2xl border flex flex-col overflow-hidden',
            darkMode ? 'border-neutral-800 bg-neutral-900/50' : 'border-neutral-200 bg-white shadow-sm'
          )}
        >
          {blogDirName && selectedPosts.length > 0 && (
            <div
              className={cn(
                'shrink-0 px-4 py-2 text-[11px] flex items-center gap-2 border-b',
                darkMode ? 'border-neutral-800 bg-sky-500/5 text-sky-300' : 'border-neutral-200 bg-sky-50 text-sky-700'
              )}
            >
              <Newspaper className="w-3 h-3 shrink-0" />
              <span>블로그 글 {selectedPosts.length}개가 컨텍스트로 연결되어 있습니다: {selectedPosts.map((p) => p.title).join(', ')}</span>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5 scrollbar-hide">
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mr-2.5 mt-0.5">
                    <Clapperboard className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line',
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : darkMode
                      ? 'bg-neutral-800 text-neutral-200 rounded-bl-sm'
                      : 'bg-neutral-100 text-neutral-800 rounded-bl-sm'
                  )}
                >
                  {msg.text}
                </div>
              </motion.div>
            ))}
            {isStreaming && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mr-2.5 mt-0.5">
                  <Clapperboard className="w-3.5 h-3.5 text-white" />
                </div>
                {streamingText ? (
                  <div
                    className={cn(
                      'max-w-[78%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-line',
                      darkMode ? 'bg-neutral-800 text-neutral-200' : 'bg-neutral-100 text-neutral-800'
                    )}
                  >
                    {streamingText}
                    <span className="inline-block w-1.5 h-4 ml-0.5 bg-indigo-400 animate-pulse align-middle" />
                  </div>
                ) : (
                  <div
                    className={cn(
                      'rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1.5 items-center',
                      darkMode ? 'bg-neutral-800' : 'bg-neutral-100'
                    )}
                  >
                    {[0, 0.15, 0.3].map((delay, i) => (
                      <span
                        key={i}
                        className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce"
                        style={{ animationDelay: `${delay}s` }}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 스토리보드로 만들기 — 채팅을 계속하다가 준비되면 이 버튼으로 편집기로 이동합니다 */}
          <div className={cn('shrink-0 px-4 pt-3', darkMode ? '' : '')}>
            <button
              onClick={handleBuildStoryboard}
              disabled={!canBuild}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all',
                !canBuild
                  ? darkMode
                    ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                    : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white shadow-md'
              )}
            >
              {isBuildingStoryboard ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {buildStage || '스토리보드를 만드는 중...'}
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  🎬 스토리보드로 만들기
                </>
              )}
            </button>
            {!hasUserMessage && (
              <p className={cn('text-[11px] text-center mt-1.5', darkMode ? 'text-neutral-600' : 'text-neutral-400')}>
                먼저 어떤 영상을 만들고 싶은지 대화를 시작해주세요.
              </p>
            )}
          </div>

          <div className={cn('p-4 pt-3 border-t mt-3', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="예: 제주도 가족 여행 감성 브이로그 만들어줘..."
                disabled={isStreaming}
                className={cn(
                  'flex-1 px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all disabled:opacity-60',
                  darkMode
                    ? 'bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500'
                    : 'bg-neutral-50 border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                )}
              />
              <button
                onClick={handleSend}
                disabled={isStreaming || !input.trim()}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-1.5"
              >
                {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                보내기
              </button>
            </div>
            {llmStatus === 'offline' && (
              <p className="text-[11px] text-rose-500 mt-1.5">
                LM Studio에 연결되어 있지 않습니다. 헤더의 상태 배지 또는 설정 버튼을 눌러 확인해주세요.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Editor Interface ─────────────────────────────────────────────────────────

function EditorInterface({ darkMode }: { darkMode: boolean }) {
  const {
    scenes,
    selectedSceneId,
    setSelectedSceneId,
    moveScene,
    deleteScene,
    addScene,
    currentProject,
  } = useStore();
  const selectedScene = scenes.find((s) => s.id === selectedSceneId) ?? scenes[0] ?? null;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ── Timeline (Left) ──────────────────────────────────────────────── */}
      <div
        className={cn(
          'w-72 flex flex-col border-r shrink-0',
          darkMode ? 'border-neutral-800 bg-neutral-900/40' : 'border-neutral-200 bg-neutral-50/60'
        )}
      >
        {/* Timeline header */}
        <div
          className={cn(
            'px-4 py-3 border-b flex items-center justify-between',
            darkMode ? 'border-neutral-800' : 'border-neutral-200'
          )}
        >
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-indigo-500" />
            <span className="font-semibold text-sm">타임라인</span>
          </div>
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full font-mono',
              darkMode ? 'bg-neutral-800 text-neutral-400' : 'bg-neutral-200 text-neutral-500'
            )}
          >
            {scenes.length}장면
          </span>
        </div>

        {/* Project label */}
        {currentProject && (
          <div
            className={cn(
              'px-4 py-2 border-b flex items-center gap-2 text-xs',
              darkMode ? 'border-neutral-800 text-neutral-500' : 'border-neutral-200 text-neutral-400'
            )}
          >
            <Folder className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate" title={currentProject.folderPath}>
              {currentProject.name}
            </span>
          </div>
        )}

        {/* Scene list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-hide">
          {scenes.map((scene, index) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              index={index}
              isSelected={selectedSceneId === scene.id || (selectedSceneId === null && index === 0)}
              darkMode={darkMode}
              onSelect={() => setSelectedSceneId(scene.id)}
              onMoveUp={() => moveScene(scene.id, 'up')}
              onMoveDown={() => moveScene(scene.id, 'down')}
              onDelete={() => deleteScene(scene.id)}
              canMoveUp={index > 0}
              canMoveDown={index < scenes.length - 1}
            />
          ))}

          {/* Add scene */}
          <button
            onClick={addScene}
            className={cn(
              'w-full py-3 border-2 border-dashed rounded-xl flex items-center justify-center gap-2 text-sm transition-colors',
              darkMode
                ? 'border-neutral-700 hover:border-indigo-500 hover:bg-indigo-500/5 text-neutral-500 hover:text-indigo-400'
                : 'border-neutral-300 hover:border-indigo-400 hover:bg-indigo-50 text-neutral-400 hover:text-indigo-600'
            )}
          >
            <Plus className="w-4 h-4" />
            <span>장면 추가</span>
          </button>
        </div>

        {/* Total duration */}
        <div
          className={cn(
            'px-4 py-3 border-t flex items-center gap-2 text-xs',
            darkMode ? 'border-neutral-800 text-neutral-500' : 'border-neutral-200 text-neutral-400'
          )}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>총 재생시간: {scenes.reduce((sum, s) => sum + s.duration, 0)}초</span>
        </div>
      </div>

      {/* ── Editor center + right ─────────────────────────────────────────── */}
      {selectedScene ? (
        <div className="flex-1 flex overflow-hidden">
          <SceneEditor scene={selectedScene} darkMode={darkMode} />
          <RecommendPanel scene={selectedScene} darkMode={darkMode} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-neutral-400">
          <Film className="w-14 h-14 opacity-20" />
          <p className="text-base font-medium">장면을 선택해주세요</p>
          <p className="text-sm opacity-60">타임라인에서 편집할 장면을 클릭하세요</p>
        </div>
      )}
    </div>
  );
}

// ─── Scene Card ───────────────────────────────────────────────────────────────

function SceneCard({
  scene,
  index,
  isSelected,
  darkMode,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDelete,
  canMoveUp,
  canMoveDown,
}: {
  scene: Scene;
  index: number;
  isSelected: boolean;
  darkMode: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const [showActions, setShowActions] = useState(false);

  return (
    <motion.div
      layout
      onClick={onSelect}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      className={cn(
        'relative rounded-xl border p-2.5 cursor-pointer transition-all duration-150',
        isSelected
          ? darkMode
            ? 'border-indigo-500 bg-indigo-500/10'
            : 'border-indigo-500 bg-indigo-50 shadow-sm'
          : darkMode
          ? 'border-neutral-800 hover:border-neutral-600 bg-neutral-800/40'
          : 'border-neutral-200 hover:border-neutral-300 bg-white'
      )}
    >
      <div className="flex gap-2.5">
        {/* Thumbnail */}
        <div className="w-20 h-[52px] rounded-lg overflow-hidden shrink-0 bg-neutral-200">
          <img
            src={getSceneImageSrc(scene.photoRef)}
            alt={scene.customTitle}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                'text-xs font-semibold truncate',
                isSelected ? 'text-indigo-600 dark:text-indigo-400' : ''
              )}
            >
              {index + 1}. {scene.customTitle}
            </span>
            <span
              className={cn(
                'text-xs font-mono shrink-0',
                darkMode ? 'text-neutral-500' : 'text-neutral-400'
              )}
            >
              {scene.duration}s
            </span>
          </div>
          <p
            className={cn(
              'text-xs mt-1 line-clamp-2 leading-relaxed',
              darkMode ? 'text-neutral-400' : 'text-neutral-500'
            )}
          >
            {scene.narration}
          </p>
        </div>
      </div>

      {/* Hover actions */}
      <AnimatePresence>
        {showActions && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute right-2 top-2 flex flex-col gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className={cn(
                'w-5 h-5 flex items-center justify-center rounded shadow-sm transition-colors',
                darkMode
                  ? 'bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30'
                  : 'bg-white hover:bg-neutral-100 disabled:opacity-30 border border-neutral-200'
              )}
            >
              <ArrowUp className="w-3 h-3" />
            </button>
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className={cn(
                'w-5 h-5 flex items-center justify-center rounded shadow-sm transition-colors',
                darkMode
                  ? 'bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30'
                  : 'bg-white hover:bg-neutral-100 disabled:opacity-30 border border-neutral-200'
              )}
            >
              <ArrowDown className="w-3 h-3" />
            </button>
            <button
              onClick={onDelete}
              className={cn(
                'w-5 h-5 flex items-center justify-center rounded shadow-sm transition-colors',
                darkMode
                  ? 'bg-red-500/20 hover:bg-red-500/40 text-red-400'
                  : 'bg-white hover:bg-red-50 text-red-500 border border-neutral-200'
              )}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Scene Editor (center) ────────────────────────────────────────────────────

function SceneEditor({ scene, darkMode }: { scene: Scene; darkMode: boolean }) {
  const { scenes, updateScene, pushEditLog, setModal, llmBaseUrl, llmModel, llmMode } = useStore();
  const [aiNotice, setAiNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const titleDraftRef = useRef(scene.customTitle);
  const narrationDraftRef = useRef(scene.narration);
  const dialogueDraftRef = useRef(scene.dialogue);
  const durationDraftRef = useRef(scene.duration);

  // 다른 장면을 선택했을 때 블러 비교 기준값을 최신 상태로 맞춥니다.
  useEffect(() => {
    titleDraftRef.current = scene.customTitle;
    narrationDraftRef.current = scene.narration;
    dialogueDraftRef.current = scene.dialogue;
    durationDraftRef.current = scene.duration;
  }, [scene.id]);

  const logIfChanged = (ref: React.MutableRefObject<string | number>, next: string | number, label: string) => {
    if (ref.current !== next) {
      const preview = typeof next === 'string' ? next.slice(0, 60) : `${next}초`;
      pushEditLog('scene_field_edit', `"${scene.customTitle}" 장면 ${label} 수정 → ${preview}`);
      ref.current = next;
    }
  };

  const handleAiRegenerate = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiNotice(null);
    try {
      const { narration, dialogue } = await regenerateSceneNarration({
        scene,
        allScenes: scenes,
        settings: { baseUrl: llmBaseUrl, model: llmModel, mode: llmMode },
      });
      updateScene(scene.id, { narration, dialogue });
      pushEditLog('scene_ai_regenerate', `"${scene.customTitle}" 장면 나레이션 AI 재생성`);
      setAiNotice({ tone: 'info', text: '나레이션을 새로 만들었습니다.' });
    } catch (err: any) {
      setAiNotice({
        tone: 'error',
        text: 'LM Studio에 연결하지 못했습니다. 헤더의 "설정"에서 서버 주소/모델을 확인해주세요.',
      });
    } finally {
      setAiBusy(false);
      setTimeout(() => setAiNotice(null), 4000);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto scrollbar-hide">
      {/* Preview */}
      <div className="p-5">
        <div className="aspect-video w-full rounded-2xl overflow-hidden bg-neutral-900 relative shadow-lg">
          {scene.localVideoUrl ? (
            <video
              src={scene.localVideoUrl}
              controls
              className="w-full h-full object-cover bg-black"
            />
          ) : (
            <>
              <img
                src={getSceneImageSrc(scene.photoRef)}
                alt={scene.customTitle}
                className="w-full h-full object-cover opacity-90"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent flex flex-col justify-end p-5 pointer-events-none">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest bg-white/10 px-2 py-0.5 rounded">
                    장면 미리보기
                  </span>
                  {scene.tags?.map((tag) => (
                    <span key={tag} className="text-[10px] text-white/60 bg-white/10 px-2 py-0.5 rounded font-mono">
                      #{tag}
                    </span>
                  ))}
                </div>
                <p className="text-white text-sm leading-relaxed drop-shadow-md font-medium">{scene.narration}</p>
                {scene.dialogue && (
                  <p className="text-amber-300 text-xs mt-1.5 drop-shadow-md">"{scene.dialogue}"</p>
                )}
              </div>
              {/* Play overlay */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/20 pointer-events-none">
                <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Play className="w-6 h-6 text-white ml-1" />
                </div>
              </div>
            </>
          )}
        </div>

        {/* 로컬 미디어 참조 표시 */}
        {(scene.localImageName || scene.localVideoName) && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {scene.localImageName && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md font-mono',
                  darkMode ? 'bg-neutral-800 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
                )}
              >
                <ImageIcon className="w-3 h-3" /> {scene.localImageName}
              </span>
            )}
            {scene.localVideoName && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md font-mono',
                  darkMode ? 'bg-neutral-800 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
                )}
              >
                <Video className="w-3 h-3" /> {scene.localVideoName}
              </span>
            )}
            <button
              onClick={() => setModal('media')}
              className="text-[11px] text-indigo-500 hover:text-indigo-600 font-medium"
            >
              미디어 라이브러리에서 변경
            </button>
          </div>
        )}
      </div>

      {/* Fields */}
      <div className="px-5 pb-5 space-y-4">
        {/* Title */}
        <Field
          label="장면 제목"
          icon={<Clapperboard className="w-3.5 h-3.5 text-indigo-500" />}
        >
          <input
            type="text"
            value={scene.customTitle}
            onChange={(e) => updateScene(scene.id, { customTitle: e.target.value })}
            onBlur={(e) => logIfChanged(titleDraftRef, e.target.value, '제목')}
            className={cn(
              'w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all',
              darkMode
                ? 'bg-neutral-900 border-neutral-700 text-neutral-100'
                : 'bg-white border-neutral-200 text-neutral-900'
            )}
          />
        </Field>

        {/* Narration */}
        <Field
          label="나레이션"
          icon={<FileText className="w-3.5 h-3.5 text-indigo-500" />}
          action={
            <div className="relative">
              <button
                onClick={handleAiRegenerate}
                disabled={aiBusy}
                className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-600 transition-colors disabled:opacity-50"
              >
                {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {aiBusy ? 'AI 재생성 중...' : 'AI 재생성'}
              </button>
              {aiNotice && (
                <div
                  className={cn(
                    'absolute right-0 top-6 z-10 w-56 text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg border',
                    aiNotice.tone === 'error'
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-500'
                      : darkMode
                      ? 'bg-neutral-800 border-neutral-700 text-neutral-300'
                      : 'bg-white border-neutral-200 text-neutral-600'
                  )}
                >
                  {aiNotice.text}
                </div>
              )}
            </div>
          }
        >
          <textarea
            value={scene.narration}
            onChange={(e) => updateScene(scene.id, { narration: e.target.value })}
            onBlur={(e) => logIfChanged(narrationDraftRef, e.target.value, '나레이션')}
            rows={3}
            className={cn(
              'w-full px-3 py-2 text-sm rounded-lg border resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all leading-relaxed',
              darkMode
                ? 'bg-neutral-900 border-neutral-700 text-neutral-100'
                : 'bg-white border-neutral-200 text-neutral-900'
            )}
          />
        </Field>

        {/* Dialogue */}
        <Field
          label="대사"
          icon={<MessageSquare className="w-3.5 h-3.5 text-amber-500" />}
        >
          <textarea
            value={scene.dialogue}
            onChange={(e) => updateScene(scene.id, { dialogue: e.target.value })}
            onBlur={(e) => logIfChanged(dialogueDraftRef, e.target.value, '대사')}
            rows={2}
            className={cn(
              'w-full px-3 py-2 text-sm rounded-lg border resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all leading-relaxed',
              darkMode
                ? 'bg-neutral-900 border-neutral-700 text-neutral-100'
                : 'bg-white border-neutral-200 text-neutral-900'
            )}
          />
        </Field>

        {/* Duration */}
        <Field
          label={`재생 시간 — ${scene.duration}초`}
          icon={<Clock className="w-3.5 h-3.5 text-emerald-500" />}
        >
          <input
            type="range"
            min={1}
            max={20}
            value={scene.duration}
            onChange={(e) => updateScene(scene.id, { duration: Number(e.target.value) })}
            onMouseUp={(e) => logIfChanged(durationDraftRef, Number((e.target as HTMLInputElement).value), '재생시간')}
            onTouchEnd={(e) => logIfChanged(durationDraftRef, Number((e.target as HTMLInputElement).value), '재생시간')}
            className="w-full accent-indigo-500"
          />
          <div className="flex justify-between text-xs text-neutral-400 mt-1">
            <span>1초</span>
            <span>20초</span>
          </div>
        </Field>

        {/* Tags */}
        <Field
          label="태그"
          icon={<Tag className="w-3.5 h-3.5 text-rose-400" />}
        >
          <div className="flex flex-wrap gap-1.5">
            {(scene.tags ?? []).map((tag) => (
              <span
                key={tag}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full border',
                  darkMode
                    ? 'border-neutral-700 bg-neutral-800 text-neutral-300'
                    : 'border-neutral-200 bg-neutral-50 text-neutral-600'
                )}
              >
                #{tag}
              </span>
            ))}
            {(scene.tags ?? []).length === 0 && (
              <span className="text-xs text-neutral-400">태그 없음</span>
            )}
          </div>
        </Field>
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  action,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="flex items-center gap-1.5 text-xs font-semibold">
          {icon}
          <span>{label}</span>
        </label>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Recommend Panel (right) ──────────────────────────────────────────────────

function RecommendPanel({ scene, darkMode }: { scene: Scene; darkMode: boolean }) {
  const { applyImageToScene } = useStore();
  const [recs, setRecs] = useState<string[]>(() => getRecommendations(scene));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [appliedIdx, setAppliedIdx] = useState<number | null>(null);

  useEffect(() => {
    setRecs(getRecommendations(scene));
    setAppliedIdx(null);
  }, [scene.id]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setRecs(getRecommendations(scene));
      setAppliedIdx(null);
      setIsRefreshing(false);
    }, 600);
  };

  const handleApply = (url: string, idx: number) => {
    applyImageToScene(scene.id, url, { localImageName: null, logMessage: `"${scene.customTitle}" 장면에 추천 이미지 적용` });
    setAppliedIdx(idx);
  };

  return (
    <div
      className={cn(
        'w-72 border-l flex flex-col shrink-0',
        darkMode ? 'border-neutral-800 bg-neutral-900/40' : 'border-neutral-200 bg-neutral-50/60'
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'px-4 py-3 border-b flex items-center justify-between shrink-0',
          darkMode ? 'border-neutral-800' : 'border-neutral-200'
        )}
      >
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-emerald-500" />
          <span className="font-semibold text-sm">비슷한 이미지 추천</span>
        </div>
        <button
          onClick={handleRefresh}
          className={cn(
            'w-7 h-7 flex items-center justify-center rounded-lg transition-colors',
            darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-200 text-neutral-500'
          )}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
        </button>
      </div>

      {/* Grid */}
      <div className="p-4 grid grid-cols-2 gap-2">
        {recs.map((url, i) => (
          <button
            key={`${url}-${i}`}
            onClick={() => handleApply(url, i)}
            className={cn(
              'aspect-square rounded-xl overflow-hidden relative group ring-2 transition-all duration-150',
              appliedIdx === i ? 'ring-indigo-500' : 'ring-transparent hover:ring-indigo-400'
            )}
          >
            <img src={url} alt="추천 이미지" className="w-full h-full object-cover bg-neutral-200" />
            <div
              className={cn(
                'absolute inset-0 flex items-center justify-center transition-opacity',
                appliedIdx === i
                  ? 'bg-indigo-500/30 opacity-100'
                  : 'bg-black/30 opacity-0 group-hover:opacity-100'
              )}
            >
              {appliedIdx === i ? (
                <Check className="w-5 h-5 text-white drop-shadow" />
              ) : (
                <span className="text-white text-xs font-medium bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-sm">
                  교체
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Scene info */}
      <div className={cn('px-4 pb-4 border-t pt-4', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
        <p className="text-xs font-semibold mb-3 flex items-center gap-1.5">
          <Clapperboard className="w-3.5 h-3.5 text-indigo-500" />
          장면 정보
        </p>
        <div className="space-y-2">
          <InfoRow label="장면 번호" value={`#${scene.id.split('_')[1] ?? scene.id}`} darkMode={darkMode} />
          <InfoRow label="재생 시간" value={`${scene.duration}초`} darkMode={darkMode} />
          <InfoRow label="파일 이름" value={scene.filename ?? `${scene.id}_clip`} darkMode={darkMode} truncate />
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  darkMode,
  truncate,
}: {
  label: string;
  value: string;
  darkMode: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className={cn('text-xs', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>{label}</span>
      <span
        className={cn(
          'text-xs font-mono font-medium',
          truncate && 'truncate max-w-[120px]',
          darkMode ? 'text-neutral-300' : 'text-neutral-600'
        )}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Modal Backdrop ────────────────────────────────────────────────────────────

function ModalBackdrop({
  onClose,
  children,
  closeOnBackdropClick = true,
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** false로 두면 배경(바깥) 클릭으로 닫히지 않고, 모달 안의 닫기(X) 버튼으로만 닫힙니다. */
  closeOnBackdropClick?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={closeOnBackdropClick ? onClose : undefined}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', damping: 30, stiffness: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

// ─── New Project Modal ────────────────────────────────────────────────────────

function NewProjectModal({ darkMode, onClose }: { darkMode: boolean; onClose: () => void }) {
  const { saveDirHandle, saveDirName, scenes, connectSaveFolder, saveNamedProject, resetForNewProject, setView } = useStore();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fsSupported, setFsSupported] = useState(false);

  // 서버 렌더링과 첫 클라이언트 렌더를 동일하게 유지하기 위해
  // 브라우저 지원 여부는 마운트 후에 확인합니다.
  useEffect(() => {
    setFsSupported(isFileSystemAccessSupported());
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setErrorMsg(null);
    const res = await connectSaveFolder();
    setConnecting(false);
    if (!res.ok && res.message && res.message !== '폴더 선택이 취소되었습니다.') {
      setErrorMsg(res.message);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      // 2026-07-25: "새 프로젝트"는 항상 빈 스토리보드(0부터 시작)로 만듭니다 — 저장은 그
      // 빈 상태를 이름 붙여 저장하는 것이고, 편집기로 이동하면 빈 타임라인에서 시작합니다.
      resetForNewProject();
      const res = await saveNamedProject(name.trim());
      if (!res.ok) {
        setErrorMsg(res.message ?? '프로젝트를 저장하는 중 문제가 발생했습니다.');
        return;
      }
      setSaved(true);
      setTimeout(() => {
        onClose();
        setView('editor');
      }, 900);
    } finally {
      setSaving(false);
    }
  };

  const modalBg = darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200';

  return (
    <ModalBackdrop onClose={onClose}>
      <div className={cn('w-full max-w-md rounded-2xl border shadow-2xl', modalBg)}>
        <div className={cn('flex items-center justify-between px-6 py-4 border-b', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <div className="flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-indigo-500" />
            <h2 className="font-bold text-base">새 프로젝트 만들기</h2>
          </div>
          <button onClick={onClose} className={cn('w-7 h-7 flex items-center justify-center rounded-lg', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-semibold mb-1.5 block text-indigo-500">프로젝트 이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 제주도 가족 여행 브이로그"
              className={cn(
                'w-full px-3 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-500/40',
                darkMode ? 'bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500' : 'bg-neutral-50 border-neutral-200 text-neutral-900 placeholder:text-neutral-400'
              )}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-indigo-500 mb-1.5 block">저장 위치</label>
            {!fsSupported ? (
              <div className="flex items-start gap-2 text-xs text-amber-500 bg-amber-500/10 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>이 브라우저는 실제 폴더 저장을 지원하지 않습니다 (Chrome/Edge 권장). 저장 없이 미리보기만 가능합니다.</span>
              </div>
            ) : saveDirHandle ? (
              <div
                className={cn(
                  'flex items-center gap-2 text-xs rounded-lg px-3 py-2.5 border',
                  darkMode ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-emerald-200 bg-emerald-50 text-emerald-600'
                )}
              >
                <FolderCheck className="w-4 h-4 shrink-0" />
                <span className="font-mono">
                  "{saveDirName}" 폴더 → KWJMvideoAI_data/projects/{name.trim() ? `${name.trim().replace(/\s+/g, '_')}.json` : '(파일명).json'}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start gap-2 text-xs text-neutral-500 bg-neutral-500/10 rounded-lg px-3 py-2.5">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>저장 폴더가 아직 연결되지 않았습니다. 먼저 저장 폴더를 연결해야 실제 파일로 저장됩니다.</span>
                </div>
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={connecting}
                  className={cn(
                    'w-full flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors',
                    darkMode ? 'bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                  )}
                >
                  {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                  저장 폴더 연결하기
                </button>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 text-xs text-rose-500 bg-rose-500/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-indigo-500 bg-indigo-500/10 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              새 프로젝트는 항상 빈 스토리보드(0부터)로 시작합니다.
              {scenes.length > 0 ? ` 현재 편집 중인 장면 ${scenes.length}개는 저장하지 않았다면 사라집니다.` : ''}
            </span>
          </div>
        </div>

        <div className={cn('px-6 py-4 border-t flex justify-end gap-2', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <button onClick={onClose} className={cn('px-4 py-2 text-sm rounded-lg transition-colors', darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-100 text-neutral-500')}>
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saved || saving || !saveDirHandle}
            className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-1.5"
          >
            {saved ? (
              <><Check className="w-4 h-4" /> 저장됨</>
            ) : saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 저장 중...</>
            ) : (
              <><FolderPlus className="w-4 h-4" /> 프로젝트 생성</>
            )}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── Load Modal ───────────────────────────────────────────────────────────────

function LoadModal({ darkMode, onClose }: { darkMode: boolean; onClose: () => void }) {
  const { savedProjects, saveDirHandle, saveDirName, listNamedProjects, loadNamedProject, setCurrentProject, setView } = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [fsSupported, setFsSupported] = useState(false);

  // 연결된 저장 폴더의 projects/ 목록
  const [namedProjects, setNamedProjects] = useState<{ name: string; handle: any; modifiedAt?: string; sceneCount?: number }[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingNamed, setLoadingNamed] = useState<string | null>(null);

  // 임의 폴더에서 불러오기 (저장 폴더 연결 없이도 사용 가능한 보조 기능)
  const [folderName, setFolderName] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<{ name: string; handle: any }[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [browsingFolder, setBrowsingFolder] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setFsSupported(isFileSystemAccessSupported());
  }, []);

  useEffect(() => {
    if (!saveDirHandle) {
      setNamedProjects([]);
      return;
    }
    setLoadingList(true);
    listNamedProjects()
      .then(setNamedProjects)
      .finally(() => setLoadingList(false));
  }, [saveDirHandle, listNamedProjects]);

  const handleLoadNamed = async (proj: { name: string; handle: any }) => {
    setLoadingNamed(proj.name);
    setErrorMsg(null);
    const res = await loadNamedProject(proj.handle);
    setLoadingNamed(null);
    if (!res.ok) {
      setErrorMsg(res.message ?? '프로젝트를 불러오는 중 문제가 발생했습니다.');
      return;
    }
    setView('editor');
    onClose();
  };

  const handleLoadSample = () => {
    const proj = savedProjects.find((p) => p.id === selected);
    if (!proj) return;
    setCurrentProject(proj);
    setView('editor');
    onClose();
  };

  const handlePickFolder = async () => {
    setErrorMsg(null);
    setSelectedFile(null);
    setBrowsingFolder(true);
    try {
      const handle = await pickDirectory('read');
      if (!handle) {
        setBrowsingFolder(false);
        return; // 사용자가 취소했거나 미지원 브라우저
      }
      const files = await listJsonFiles(handle);
      setFolderName(handle.name);
      setFolderFiles(files);
      if (files.length === 0) {
        setErrorMsg('선택한 폴더에서 프로젝트 JSON 파일을 찾지 못했습니다.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('폴더를 여는 중 문제가 발생했습니다. 폴더 접근 권한을 확인해주세요.');
    } finally {
      setBrowsingFolder(false);
    }
  };

  const handleLoadFromFolderFile = async (fileEntry: { name: string; handle: any }) => {
    setErrorMsg(null);
    setLoadingFile(true);
    try {
      const data = await readJsonFile(fileEntry.handle);
      if (!data || !Array.isArray(data.scenes)) {
        setErrorMsg('올바른 프로젝트 파일 형식이 아닙니다 (scenes 배열이 없습니다).');
        return;
      }
      const now = new Date().toISOString();
      const project: Project = {
        id: typeof data.id === 'string' ? data.id : `proj_${Date.now()}`,
        name: typeof data.name === 'string' && data.name.trim() ? data.name : fileEntry.name.replace(/\.json$/i, ''),
        folderPath: typeof data.folderPath === 'string' ? data.folderPath : `/${folderName ?? ''}`,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : now,
        modifiedAt: typeof data.modifiedAt === 'string' ? data.modifiedAt : now,
        scenes: data.scenes as Scene[],
        thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : data.scenes[0]?.photoRef,
      };
      setCurrentProject(project);
      setView('editor');
      onClose();
    } catch (err) {
      console.error(err);
      setErrorMsg('파일을 읽는 중 문제가 발생했습니다. 올바른 JSON 파일인지 확인해주세요.');
    } finally {
      setLoadingFile(false);
    }
  };

  const modalBg = darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200';

  return (
    <ModalBackdrop onClose={onClose}>
      <div className={cn('w-full max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-hide rounded-2xl border shadow-2xl', modalBg)}>
        <div className={cn('flex items-center justify-between px-6 py-4 border-b sticky top-0 z-10', modalBg, darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-indigo-500" />
            <h2 className="font-bold text-base">프로젝트 불러오기</h2>
          </div>
          <button onClick={onClose} className={cn('w-7 h-7 flex items-center justify-center rounded-lg', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* 연결된 저장 폴더의 프로젝트 */}
          <div>
            <p className="text-xs mb-2 font-semibold text-indigo-500">
              {saveDirHandle ? `"${saveDirName}" 저장 폴더의 프로젝트` : '연결된 저장 폴더의 프로젝트'}
            </p>
            {!saveDirHandle ? (
              <div className="flex items-start gap-2 text-xs text-neutral-500 bg-neutral-500/10 rounded-lg px-3 py-2.5">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>저장 폴더를 연결하면 그 안에 저장해둔 프로젝트들이 여기 자동으로 나타납니다. (상단 저장 폴더 연결 버튼)</span>
              </div>
            ) : loadingList ? (
              <div className="flex items-center gap-2 text-xs text-neutral-400 px-1 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> 목록 불러오는 중...
              </div>
            ) : namedProjects.length === 0 ? (
              <p className={cn('text-xs px-1', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                아직 이 폴더에 저장된 프로젝트가 없습니다. "새 프로젝트"로 먼저 저장해보세요.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto scrollbar-hide">
                {namedProjects.map((proj) => (
                  <button
                    key={proj.name}
                    onClick={() => handleLoadNamed(proj)}
                    disabled={loadingNamed === proj.name}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left text-xs transition-colors disabled:opacity-50',
                      darkMode ? 'border-neutral-700 hover:border-indigo-500 bg-neutral-900/60' : 'border-neutral-200 hover:border-indigo-300 bg-white'
                    )}
                  >
                    {loadingNamed === proj.name ? (
                      <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-indigo-500" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                    )}
                    <span className="truncate font-mono flex-1">{proj.name.replace(/\.json$/i, '')}</span>
                    {typeof proj.sceneCount === 'number' && (
                      <span className={cn('shrink-0', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>{proj.sceneCount}개 장면</span>
                    )}
                    {proj.modifiedAt && (
                      <span className={cn('shrink-0', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                        {formatShortDateTime(proj.modifiedAt)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 임의 폴더에서 불러오기 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-indigo-500">다른 폴더에서 불러오기</label>
              {fsSupported && (
                <button
                  type="button"
                  onClick={handlePickFolder}
                  disabled={browsingFolder}
                  className={cn(
                    'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors disabled:opacity-50',
                    darkMode ? 'text-indigo-400 hover:bg-indigo-500/10' : 'text-indigo-600 hover:bg-indigo-50'
                  )}
                >
                  {browsingFolder ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderOpen className="w-3.5 h-3.5" />
                  )}
                  {folderName ? '다른 폴더 선택' : '폴더 선택'}
                </button>
              )}
            </div>

            {!fsSupported && (
              <p className={cn('text-xs', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                이 브라우저는 폴더 선택을 지원하지 않아요(Chrome/Edge 권장). 아래 샘플 프로젝트를 이용해주세요.
              </p>
            )}

            {folderName && (
              <div className={cn('mt-2 rounded-xl border p-3', darkMode ? 'border-neutral-800 bg-neutral-800/40' : 'border-neutral-200 bg-neutral-50')}>
                <p className={cn('text-xs mb-2 flex items-center gap-1.5', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
                  <Folder className="w-3.5 h-3.5" />
                  "{folderName}" 폴더 — JSON 파일 {folderFiles.length}개
                </p>
                {folderFiles.length > 0 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto scrollbar-hide">
                    {folderFiles.map((f) => (
                      <button
                        key={f.name}
                        onClick={() => {
                          setSelectedFile(f.name);
                          handleLoadFromFolderFile(f);
                        }}
                        disabled={loadingFile}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs transition-colors disabled:opacity-50',
                          selectedFile === f.name
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                            : darkMode
                            ? 'border-neutral-700 hover:border-neutral-600 bg-neutral-900/60'
                            : 'border-neutral-200 hover:border-neutral-300 bg-white'
                        )}
                      >
                        {loadingFile && selectedFile === f.name ? (
                          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-indigo-500" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                        )}
                        <span className="truncate font-mono">{f.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {errorMsg && (
              <div className="mt-2 flex items-start gap-2 text-xs text-rose-500 bg-rose-500/10 rounded-lg px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* 샘플 프로젝트 (데모) */}
          <div>
            <p className={cn('text-xs mb-2 font-semibold text-indigo-500')}>
              샘플 프로젝트 (데모용, 실제 파일 아님) — {savedProjects.length}개
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-hide">
              {savedProjects.map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => setSelected(proj.id)}
                  className={cn(
                    'w-full flex items-center gap-4 p-3 rounded-xl border text-left transition-all',
                    selected === proj.id
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                      : darkMode
                      ? 'border-neutral-800 bg-neutral-800/40 hover:border-neutral-600'
                      : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
                  )}
                >
                  <div className="w-20 h-12 rounded-lg overflow-hidden shrink-0 bg-neutral-200">
                    <img src={getSceneImageSrc(proj.thumbnail)} alt={proj.name} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{proj.name}</p>
                    <p className={cn('text-xs mt-0.5 truncate font-mono', darkMode ? 'text-neutral-500' : 'text-neutral-400')} title={proj.folderPath}>
                      {proj.folderPath}
                    </p>
                    <div className={cn('flex gap-3 mt-1 text-xs', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                      <span>{proj.scenes.length}개 장면</span>
                      <span>·</span>
                      <span>수정: {new Date(proj.modifiedAt).toLocaleDateString('ko-KR')}</span>
                    </div>
                  </div>
                  {selected === proj.id && <Check className="w-4 h-4 text-indigo-500 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={cn('px-6 py-4 border-t flex justify-end gap-2 sticky bottom-0', modalBg, darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <button onClick={onClose} className={cn('px-4 py-2 text-sm rounded-lg transition-colors', darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-100 text-neutral-500')}>
            취소
          </button>
          <button
            onClick={handleLoadSample}
            disabled={!selected}
            className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-1.5"
          >
            <Upload className="w-4 h-4" />
            샘플 불러오기
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── Export Modal ─────────────────────────────────────────────────────────────

function downloadTextFile(fileName: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function buildScriptText(projectName: string, scenes: Scene[]): string {
  const header = `${projectName} — 스크립트\n생성 시각: ${new Date().toLocaleString('ko-KR')}\n${'='.repeat(40)}\n\n`;
  const body = scenes
    .map(
      (s, i) =>
        `${i + 1}. ${s.customTitle} (${s.duration}초)\n나레이션: ${s.narration}\n대사: ${s.dialogue || '(없음)'}\n`
    )
    .join('\n');
  return header + body;
}

function escapeHtml(str: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}

function openPrintableStoryboard(projectName: string, scenes: Scene[]) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('팝업이 차단되어 PDF 미리보기를 열 수 없습니다. 브라우저의 팝업 차단을 해제해주세요.');
    return;
  }
  const rows = scenes
    .map(
      (s, i) => `
      <div style="page-break-inside:avoid;border:1px solid #ddd;border-radius:12px;padding:16px;margin-bottom:14px;">
        <h3 style="margin:0 0 8px;font-size:15px;">${i + 1}. ${escapeHtml(s.customTitle)}
          <span style="color:#999;font-weight:normal;font-size:12px;">(${s.duration}초)</span>
        </h3>
        <p style="margin:0 0 6px;color:#333;line-height:1.6;font-size:13px;">${escapeHtml(s.narration)}</p>
        ${s.dialogue ? `<p style="margin:0;color:#a15c00;font-style:italic;font-size:13px;">"${escapeHtml(s.dialogue)}"</p>` : ''}
      </div>`
    )
    .join('');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(projectName)}</title></head>
    <body style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:720px;margin:24px auto;padding:0 16px;">
      <h1 style="font-size:19px;">${escapeHtml(projectName)} — 스토리보드</h1>
      <p style="color:#888;font-size:12px;margin-top:-8px;">브라우저 인쇄 대화상자에서 "PDF로 저장"을 선택하면 PDF 파일로 저장할 수 있습니다.</p>
      ${rows}
      <script>window.onload = function() { setTimeout(function(){ window.print(); }, 300); };</script>
    </body></html>`);
  win.document.close();
}

function ExportModal({ darkMode, onClose }: { darkMode: boolean; onClose: () => void }) {
  const { scenes, currentProject, saveDirHandle, saveDirName, pushEditLog, subtitleFontName } = useStore();
  const projectName = currentProject?.name ?? '스토리보드';
  const [pathNote, setPathNote] = useState(currentProject ? `${currentProject.folderPath}/export` : '');
  const [format, setFormat] = useState<'pdf' | 'json' | 'txt' | 'mp4'>('pdf');
  const [alsoSaveToFolder, setAlsoSaveToFolder] = useState(true);
  const [aspect, setAspect] = useState<'16:9' | '9:16'>('16:9');
  const [quality, setQuality] = useState<'720' | '1080'>('720');
  const [captionStyle, setCaptionStyle] = useState<string>(DEFAULT_CAPTION_STYLE_ID);
  const [isExporting, setIsExporting] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState('');
  const [ffmpegOk, setFfmpegOk] = useState<boolean | null>(null);

  const formats = [
    { id: 'pdf', label: 'PDF 스토리보드', desc: '브라우저 인쇄창으로 저장' },
    { id: 'json', label: 'JSON 프로젝트', desc: '원본 데이터 백업 (다운로드)' },
    { id: 'txt', label: '텍스트 스크립트', desc: '나레이션/대사만 (다운로드)' },
    { id: 'mp4', label: 'MP4 영상', desc: 'FFmpeg으로 자막을 입힌 영상 (SRT/TXT 자막 포함)' },
  ] as const;

  const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');

  useEffect(() => {
    if (format !== 'mp4') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ffmpeg/check');
        const data = await res.json();
        if (!cancelled) setFfmpegOk(Boolean(data.ok));
      } catch {
        if (!cancelled) setFfmpegOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [format]);

  const writeExportToSaveFolder = async (fileName: string, content: string) => {
    if (!saveDirHandle) return;
    const dataDir = await getDataDir(saveDirHandle);
    const exportsDir = await getOrCreateSubDirectory(dataDir, 'exports');
    await writeTextFile(exportsDir, fileName, content);
  };

  const triggerDownload = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.click();
  };

  const handleMp4Export = async () => {
    const missing = scenes.filter((sc) => !sc.localVideoUrl && !sc.photoRef);
    if (missing.length > 0) {
      setErrorMsg(`${missing.length}개 장면에 사진/영상이 없습니다. 먼저 모든 장면에 이미지나 영상을 지정해주세요.`);
      return;
    }

    setProgressLabel('이미지/영상 파일을 준비하는 중...');
    const formData = new FormData();
    const manifestScenes: { fileField: string; kind: 'image' | 'video'; duration: number }[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const kind: 'image' | 'video' = sc.localVideoUrl ? 'video' : 'image';
      const src = kind === 'video' ? sc.localVideoUrl! : sc.photoRef;
      const blob = await (await fetch(src)).blob();
      const fileField = `file_${i}`;
      const ext = kind === 'video' ? 'mp4' : blob.type.includes('png') ? 'png' : 'jpg';
      formData.append(fileField, blob, `${fileField}.${ext}`);
      manifestScenes.push({ fileField, kind, duration: sc.duration });
    }

    const { width, height } = getExportResolution(aspect, quality);
    const srtContent = buildSrt(scenes);
    const txtContent = buildPlainTextScript(projectName, scenes);

    const manifest = {
      projectName: safeName,
      width,
      height,
      fps: 30,
      subtitleFontName: subtitleFontName || undefined,
      captionStyle,
      scenes: manifestScenes,
      srtContent,
      txtContent,
    };
    formData.append('manifest', JSON.stringify(manifest));

    setProgressLabel('FFmpeg으로 영상을 렌더링하는 중... (장면 수에 따라 시간이 걸릴 수 있습니다)');
    const res = await fetch('/api/export/video', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw Object.assign(new Error(data.error || '영상을 만드는 중 오류가 발생했습니다.'), {
        detail: data.ffmpegStderr,
      });
    }

    setProgressLabel('다운로드를 시작합니다...');
    triggerDownload(`/api/export/video/${data.jobId}/${data.files.mp4}`);
    setTimeout(() => triggerDownload(`/api/export/video/${data.jobId}/${data.files.srt}`), 400);
    setTimeout(() => triggerDownload(`/api/export/video/${data.jobId}/${data.files.txt}`), 800);
  };

  const handleExport = async () => {
    if (isExporting || done) return;
    setIsExporting(true);
    setErrorMsg(null);
    setErrorDetail(null);
    try {
      if (format === 'json') {
        const payload = {
          name: projectName,
          exportedAt: new Date().toISOString(),
          scenes: sanitizeScenesForSave(scenes),
        };
        const text = JSON.stringify(payload, null, 2);
        const fileName = `${safeName}.json`;
        downloadTextFile(fileName, text, 'application/json');
        if (alsoSaveToFolder && saveDirHandle) await writeExportToSaveFolder(fileName, text);
      } else if (format === 'txt') {
        const text = buildScriptText(projectName, scenes);
        const fileName = `${safeName}.txt`;
        downloadTextFile(fileName, text, 'text/plain;charset=utf-8');
        if (alsoSaveToFolder && saveDirHandle) await writeExportToSaveFolder(fileName, text);
      } else if (format === 'pdf') {
        openPrintableStoryboard(projectName, scenes);
      } else if (format === 'mp4') {
        await handleMp4Export();
      }
      pushEditLog('export', `"${projectName}" ${format.toUpperCase()} 형식으로 내보내기`);
      setDone(true);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || '내보내는 중 문제가 발생했습니다.');
      setErrorDetail(err?.detail);
    } finally {
      setIsExporting(false);
      setProgressLabel('');
    }
  };

  const modalBg = darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200';

  return (
    <ModalBackdrop onClose={onClose}>
      <div className={cn('w-full max-w-lg rounded-2xl border shadow-2xl max-h-[85vh] flex flex-col', modalBg)}>
        <div className={cn('shrink-0 flex items-center justify-between px-6 py-4 border-b', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-indigo-500" />
            <h2 className="font-bold text-base">내보내기</h2>
          </div>
          <button onClick={onClose} className={cn('w-7 h-7 flex items-center justify-center rounded-lg', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto scrollbar-hide">
          {/* Format selection */}
          <div>
            <label className="text-xs font-semibold mb-2 block text-indigo-500">내보내기 형식</label>
            <div className="grid grid-cols-2 gap-2">
              {formats.map((f) => (
                <button
                  key={f.id}
                  onClick={() => { setFormat(f.id as typeof format); setDone(false); setErrorMsg(null); }}
                  className={cn(
                    'p-3 rounded-xl border text-left transition-all',
                    format === f.id
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                      : darkMode
                      ? 'border-neutral-800 hover:border-neutral-700'
                      : 'border-neutral-200 hover:border-neutral-300'
                  )}
                >
                  <p className="text-sm font-medium">{f.label}</p>
                  <p className={cn('text-xs mt-0.5', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>{f.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {format === 'mp4' && (
            <div className="space-y-3">
              {ffmpegOk === false && (
                <div className="flex items-start gap-2 text-xs text-amber-500 bg-amber-500/10 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    이 컴퓨터에서 FFmpeg을 찾지 못했습니다. 프로젝트에 동봉된 ffmpeg 실행 파일(ffmpeg/bin/ffmpeg.exe)이 있는지 확인해주세요. (설치 안내: ffmpeg.org/download.html)
                  </span>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold mb-1.5 block text-indigo-500">화면비율</label>
                <div className="flex gap-2">
                  {([
                    { id: '16:9' as const, label: '16:9 가로', hint: '유튜브/일반 영상' },
                    { id: '9:16' as const, label: '9:16 세로', hint: '쇼츠/릴스/틱톡' },
                  ]).map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAspect(a.id)}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-xs font-medium border transition-colors',
                        aspect === a.id
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600'
                          : darkMode
                          ? 'border-neutral-800 text-neutral-400'
                          : 'border-neutral-200 text-neutral-500'
                      )}
                    >
                      {a.label}
                      <span className="block text-[10px] opacity-70 font-normal">{a.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block text-indigo-500">화질</label>
                <div className="flex gap-2">
                  {(['720', '1080'] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => setQuality(q)}
                      className={cn(
                        'flex-1 py-2 rounded-lg text-xs font-medium border transition-colors',
                        quality === q
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600'
                          : darkMode
                          ? 'border-neutral-800 text-neutral-400'
                          : 'border-neutral-200 text-neutral-500'
                      )}
                    >
                      {q === '720' ? '720p (빠름)' : '1080p (고화질)'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block text-indigo-500">자막 스타일</label>
                <div className="grid grid-cols-2 gap-2">
                  {CAPTION_STYLE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => setCaptionStyle(preset.id)}
                      title={preset.description}
                      className={cn(
                        'py-2 px-2.5 rounded-lg border transition-colors text-left',
                        captionStyle === preset.id
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                          : darkMode
                          ? 'border-neutral-800'
                          : 'border-neutral-200'
                      )}
                    >
                      <span className={cn('block text-xs font-bold truncate', preset.previewClassName)}>가나다 ABC</span>
                      <span className={cn('block text-[10px] mt-0.5 truncate', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <p className={cn('text-xs flex items-start gap-1.5', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                자막(나레이션·대사)이 영상에 그대로 구워지며, 같은 내용의 SRT·TXT 자막 파일도 함께 다운로드됩니다.
              </p>
            </div>
          )}

          {/* 저장 폴더에도 저장 */}
          {(format === 'json' || format === 'txt') && (
            <div>
              {saveDirHandle ? (
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={alsoSaveToFolder}
                    onChange={(e) => setAlsoSaveToFolder(e.target.checked)}
                    className="accent-indigo-500 w-3.5 h-3.5"
                  />
                  <span>
                    다운로드와 함께 저장 폴더("{saveDirName}"/KWJMvideoAI_data/exports/)에도 저장
                  </span>
                </label>
              ) : (
                <p className={cn('text-xs flex items-center gap-1.5', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  저장 폴더를 연결하면 다운로드와 함께 저장 폴더에도 백업할 수 있습니다.
                </p>
              )}
            </div>
          )}

          {/* 참고용 경로 메모 */}
          {format !== 'mp4' && (
            <div>
              <label className="text-xs font-semibold mb-1.5 block text-indigo-500">참고용 경로 메모</label>
              <div className="relative">
                <Folder className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input
                  type="text"
                  value={pathNote}
                  onChange={(e) => setPathNote(e.target.value)}
                  placeholder="예: /documents/KWJMvideoAI/export"
                  className={cn(
                    'w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-500/40 font-mono',
                    darkMode ? 'bg-neutral-800 border-neutral-700 text-neutral-100' : 'bg-neutral-50 border-neutral-200 text-neutral-900'
                  )}
                />
              </div>
              <p className={cn('text-xs mt-1', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                실제 다운로드 위치는 브라우저의 기본 다운로드 폴더를 따릅니다. 이 메모는 정리용 참고 텍스트일 뿐입니다.
              </p>
            </div>
          )}

          {/* Summary */}
          <div className={cn('rounded-xl p-4', darkMode ? 'bg-neutral-800/60' : 'bg-neutral-50 border border-neutral-200')}>
            <p className="text-xs font-semibold mb-2">내보내기 요약</p>
            <div className="space-y-1.5">
              <SummaryRow label="프로젝트" value={projectName} darkMode={darkMode} />
              <SummaryRow label="장면 수" value={`${scenes.length}개`} darkMode={darkMode} />
              <SummaryRow label="총 재생시간" value={`${totalDuration(scenes).toFixed(0)}초`} darkMode={darkMode} />
              <SummaryRow label="형식" value={format.toUpperCase()} darkMode={darkMode} />
            </div>
          </div>

          {isExporting && progressLabel && (
            <div className="flex items-center gap-2 text-xs text-indigo-500 bg-indigo-500/10 rounded-lg px-3 py-2">
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
              <span>{progressLabel}</span>
            </div>
          )}

          {errorMsg && (
            <div className="text-xs text-rose-500 bg-rose-500/10 rounded-lg px-3 py-2 space-y-1">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              {errorDetail && (
                <pre className="text-[10px] whitespace-pre-wrap opacity-70 max-h-24 overflow-y-auto">{errorDetail}</pre>
              )}
            </div>
          )}
        </div>

        <div className={cn('shrink-0 px-6 py-4 border-t flex justify-end gap-2', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <button onClick={onClose} className={cn('px-4 py-2 text-sm rounded-lg transition-colors', darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-100 text-neutral-500')}>
            취소
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className={cn(
              'px-5 py-2 text-sm rounded-lg font-medium transition-all flex items-center gap-1.5',
              done
                ? 'bg-emerald-600 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white'
            )}
          >
            {isExporting ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> 내보내는 중...</>
            ) : done ? (
              <><Check className="w-4 h-4" /> 완료!</>
            ) : (
              <><Download className="w-4 h-4" /> 내보내기</>
            )}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function SummaryRow({
  label,
  value,
  darkMode,
  truncate,
}: {
  label: string;
  value: string;
  darkMode: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className={cn('text-xs', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>{label}</span>
      <span
        className={cn('text-xs font-medium font-mono', truncate && 'truncate max-w-[200px]', darkMode ? 'text-neutral-300' : 'text-neutral-700')}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Settings Modal (LM Studio / FFmpeg) ──────────────────────────────────────

function SettingsModal({ darkMode, onClose }: { darkMode: boolean; onClose: () => void }) {
  const {
    llmBaseUrl,
    setLlmBaseUrl,
    llmModel,
    setLlmModel,
    llmAvailableModels,
    llmMode,
    setLlmMode,
    subtitleFontName,
    setSubtitleFontName,
  } = useStore();

  const [baseUrlDraft, setBaseUrlDraft] = useState(llmBaseUrl);
  const [modelDraft, setModelDraft] = useState(llmModel);
  const [modeDraft, setModeDraft] = useState<LlmMode>(llmMode);
  const [fontDraft, setFontDraft] = useState(subtitleFontName);

  const [llmCheck, setLlmCheck] = useState<{ busy: boolean; ok: boolean | null; message: string; models: string[] }>({
    busy: false,
    ok: null,
    message: '',
    models: llmAvailableModels,
  });
  const [ffmpegCheck, setFfmpegCheck] = useState<{ busy: boolean; ok: boolean | null; message: string }>({
    busy: false,
    ok: null,
    message: '',
  });

  const handleCheckLlm = async () => {
    setLlmCheck((s) => ({ ...s, busy: true }));
    const health = await checkLlmHealth(baseUrlDraft);
    setLlmCheck({
      busy: false,
      ok: health.ok,
      message: health.ok ? `연결 성공! 로드된 모델 ${health.models.length}개` : health.error ?? '연결 실패',
      models: health.models,
    });
  };

  const handleCheckFfmpeg = async () => {
    setFfmpegCheck((s) => ({ ...s, busy: true }));
    try {
      const res = await fetch('/api/ffmpeg/check');
      const data = await res.json();
      const okMessage = data.source ? `${data.version} — ${data.source}에서 찾음` : data.version;
      setFfmpegCheck({ busy: false, ok: Boolean(data.ok), message: data.ok ? okMessage : data.error });
    } catch (err: any) {
      setFfmpegCheck({ busy: false, ok: false, message: err?.message ?? 'FFmpeg 확인 중 오류' });
    }
  };

  const handleSave = () => {
    setLlmBaseUrl(baseUrlDraft.trim() || 'http://localhost:1234/v1');
    setLlmModel(modelDraft.trim());
    setLlmMode(modeDraft);
    setSubtitleFontName(fontDraft.trim());
    onClose();
  };

  const modalBg = darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200';
  const inputCls = cn(
    'w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-indigo-500/40 font-mono',
    darkMode ? 'bg-neutral-800 border-neutral-700 text-neutral-100' : 'bg-neutral-50 border-neutral-200 text-neutral-900'
  );

  const modeOptions: { id: LlmMode; label: string; desc: string; icon: React.ReactNode }[] = [
    { id: 'fast', label: '빠른모드', desc: '속도 위주 (응답이 가장 빠름)', icon: <Zap className="w-4 h-4" /> },
    { id: 'normal', label: '보통모드', desc: '가성비 (기본값)', icon: <Gauge className="w-4 h-4" /> },
    { id: 'expert', label: '전문가모드', desc: '토큰을 많이 써서 더 자세하고 품질 높은 결과', icon: <Sparkles className="w-4 h-4" /> },
  ];

  return (
    <ModalBackdrop onClose={onClose}>
      <div className={cn('w-full max-w-lg rounded-2xl border shadow-2xl max-h-[85vh] flex flex-col', modalBg)}>
        <div className={cn('shrink-0 flex items-center justify-between px-6 py-4 border-b', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-500" />
            <h2 className="font-bold text-base">설정</h2>
          </div>
          <button onClick={onClose} className={cn('w-7 h-7 flex items-center justify-center rounded-lg', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto scrollbar-hide">
          {/* LM Studio */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-indigo-500">LM Studio (LLM)</h3>
            <div>
              <label className="text-xs mb-1 block text-neutral-500">서버 주소</label>
              <input value={baseUrlDraft} onChange={(e) => setBaseUrlDraft(e.target.value)} placeholder="http://localhost:1234/v1" className={inputCls} />
            </div>
            <div>
              <label className="text-xs mb-1 block text-neutral-500">모델 ID (LM Studio에 로드된 모델과 정확히 일치해야 합니다)</label>
              <input value={modelDraft} onChange={(e) => setModelDraft(e.target.value)} placeholder="qwen3.5-9b" className={inputCls} />
              {llmCheck.models.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {llmCheck.models.map((m) => (
                    <button
                      key={m}
                      onClick={() => setModelDraft(m)}
                      className={cn(
                        'text-[11px] px-2 py-1 rounded-md font-mono border transition-colors',
                        m === modelDraft
                          ? 'border-indigo-500 text-indigo-500'
                          : darkMode
                          ? 'border-neutral-700 text-neutral-400 hover:border-neutral-600'
                          : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs mb-1.5 block text-neutral-500">응답 모드</label>
              <div className="grid grid-cols-3 gap-2">
                {modeOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setModeDraft(opt.id)}
                    title={opt.desc}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center transition-colors',
                      modeDraft === opt.id
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500'
                        : darkMode
                        ? 'border-neutral-700 text-neutral-400 hover:border-neutral-600'
                        : 'border-neutral-200 text-neutral-500 hover:border-neutral-300'
                    )}
                  >
                    {opt.icon}
                    <span className="text-xs font-semibold">{opt.label}</span>
                  </button>
                ))}
              </div>
              <p className={cn('text-[11px] mt-1.5', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                {modeOptions.find((o) => o.id === modeDraft)?.desc}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCheckLlm}
                disabled={llmCheck.busy}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium transition-colors"
              >
                {llmCheck.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                연결 확인
              </button>
              {llmCheck.ok !== null && (
                <span className={cn('text-xs', llmCheck.ok ? 'text-emerald-500' : 'text-rose-500')}>{llmCheck.message}</span>
              )}
            </div>
            <p className={cn('text-[11px] leading-relaxed', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
              LM Studio 앱을 열고 좌측 "Local Server" 탭에서 모델을 로드한 뒤 서버를 시작해야 합니다. 이 앱은 오직 LM Studio(로컬)만 사용하며 다른 원격 AI는 호출하지 않습니다.
            </p>
          </div>

          <div className={cn('h-px', darkMode ? 'bg-neutral-800' : 'bg-neutral-200')} />

          {/* FFmpeg */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-indigo-500">FFmpeg (MP4 내보내기)</h3>
            <p className={cn('text-[11px] leading-relaxed', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
              프로젝트 내부에 동봉된 FFmpeg을 자동으로 사용합니다. 별도 경로 설정이 필요 없습니다.
            </p>
            <div>
              <label className="text-xs mb-1 block text-neutral-500">자막 폰트 이름 (선택, 비워두면 시스템 기본 폰트)</label>
              <input value={fontDraft} onChange={(e) => setFontDraft(e.target.value)} placeholder="예: Malgun Gothic" className={inputCls} />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCheckFfmpeg}
                disabled={ffmpegCheck.busy}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-white font-medium transition-colors"
              >
                {ffmpegCheck.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                FFmpeg 확인
              </button>
              {ffmpegCheck.ok !== null && (
                <span className={cn('text-xs truncate', ffmpegCheck.ok ? 'text-emerald-500' : 'text-rose-500')}>{ffmpegCheck.message}</span>
              )}
            </div>
          </div>
        </div>

        <div className={cn('shrink-0 px-6 py-4 border-t flex justify-end gap-2', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <button onClick={onClose} className={cn('px-4 py-2 text-sm rounded-lg transition-colors', darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-100 text-neutral-500')}>
            취소
          </button>
          <button onClick={handleSave} className="px-5 py-2 text-sm rounded-lg font-medium bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5">
            <Check className="w-4 h-4" /> 저장
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── Blog Import Modal (블로그 데이터 폴더에서 글/사진 가져오기) ────────────────────

function BlogImportModal({ darkMode, onClose }: { darkMode: boolean; onClose: () => void }) {
  const {
    blogDirHandle,
    blogDirName,
    blogPosts,
    blogMedia,
    blogSelectedPostIds,
    setBlogSelectedPostIds,
    connectBlogDataFolder,
    disconnectBlogDataFolder,
    addChatMessage,
    llmBaseUrl,
    llmModel,
    llmMode,
    llmStatus,
    setScenes,
    setSelectedSceneId,
    setCurrentProject,
    setView,
    pushEditLog,
  } = useStore();

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set(blogSelectedPostIds));
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [building, setBuilding] = useState(false);
  const [buildStage, setBuildStage] = useState('');

  const dateFilteredPosts = filterPostsByDateRange(blogPosts, dateFrom || undefined, dateTo || undefined).sort(
    (a, b) => (a.createdAt < b.createdAt ? 1 : -1)
  );

  // 2026-07-25: 블로그에서 가져오기 검색 — 제목/본문/장소에서 검색어를 찾습니다.
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredPosts = normalizedQuery
    ? dateFilteredPosts.filter((p) => {
        const haystack = `${p.title} ${stripHtml(p.content)} ${p.location ?? ''}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : dateFilteredPosts;

  useEffect(() => {
    if (!blogDirHandle) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        filteredPosts.slice(0, 24).map(async (p) => {
          const firstMedia = blogMedia.find((m) => m.postId === p.id);
          if (!firstMedia) return [p.id, ''] as const;
          const url = await blogMediaPreviewUrl(blogDirHandle, firstMedia);
          return [p.id, url ?? ''] as const;
        })
      );
      if (!cancelled) setPreviewUrls(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blogDirHandle, blogPosts.length, dateFrom, dateTo]);

  const handleConnect = async () => {
    setBusy(true);
    setNotice(null);
    const res = await connectBlogDataFolder();
    setBusy(false);
    setNotice({ tone: res.ok ? 'ok' : 'error', text: res.message ?? '' });
  };

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    const ids = Array.from(checked);
    setBlogSelectedPostIds(ids);
    const posts = blogPosts.filter((p) => ids.includes(p.id));
    if (posts.length > 0) {
      const summary = posts
        .map((p) => `- "${p.title}" (${p.createdAt.slice(0, 10)}${p.location ? `, ${p.location}` : ''})`)
        .join('\n');
      addChatMessage(
        'user',
        `다음 블로그 글을 참고해서 영상을 만들어줘:\n${summary}`
      );
    }
    onClose();
  };


  /**
   * 채팅으로 컨셉을 먼저 정하지 않고, 선택한 블로그 글로 AI가 바로 스토리보드를 만듭니다.
   * 글의 실제 캡션/장소/날짜/본문 정보를 그대로 LLM에 전달하므로 사실이 아닌 내용을
   * 지어내지 않습니다. 결과는 새 프로젝트로 편집기에 바로 열립니다.
   *
   * 2026-07-25: 예전에는 선택한 글에 사진/영상이 하나도 없으면 무조건 오류로 막았지만,
   * 이제는 글(텍스트)만 있어도 나레이션 장면을 만들 수 있습니다. 사진/영상이 있는 글은
   * 그 사진/영상 하나당 장면 하나씩, 사진/영상이 없는 글은 본문 내용으로 장면 하나씩
   * 만들어 "글이나 사진이 있으면 모두" 스토리보드에 포함시킵니다.
   */
  const handleBuildStoryboardFromBlog = async () => {
    if (building || checked.size === 0) return;
    if (llmStatus === 'offline') {
      setNotice({ tone: 'error', text: 'AI(LM Studio)가 연결되어 있지 않습니다. 헤더의 "설정"에서 먼저 연결해주세요.' });
      return;
    }
    setBuilding(true);
    setNotice(null);
    setBuildStage('선택한 글을 분석하는 중...');
    try {
      const ids = Array.from(checked).sort((a, b) => {
        const pa = blogPosts.find((p) => p.id === a)?.createdAt ?? '';
        const pb = blogPosts.find((p) => p.id === b)?.createdAt ?? '';
        return pa < pb ? -1 : pa > pb ? 1 : 0;
      });
      const posts = blogPosts.filter((p) => ids.includes(p.id));
      const media = getMediaForPosts(blogMedia, ids);
      const postsWithMediaIds = new Set(media.map((m) => m.postId));
      const textOnlyPosts = posts.filter((p) => !postsWithMediaIds.has(p.id));

      // 사진/영상이 있는 글 → 미디어 개수만큼 장면 생성 (기존 방식)
      const scenesByPostId = new Map<string, Scene[]>();

      if (media.length > 0) {
        setBuildStage('선택한 글의 사진·영상에 나레이션을 작성하는 중...');
        const descriptors: MediaDescriptor[] = media.map((m) => {
          const post = posts.find((p) => p.id === m.postId);
          return {
            label: blogMediaFileName(m.url),
            kind: m.type,
            caption: m.caption || undefined,
            location: m.location || post?.location || undefined,
            date: `${m.year}-${m.month}-${m.day}`,
          };
        });
        const written = await generateStoryboardFromMedia({
          items: descriptors,
          settings: { baseUrl: llmBaseUrl, model: llmModel, mode: llmMode },
        });

        setBuildStage('사진·영상 파일을 장면에 연결하는 중...');
        await Promise.all(
          media.map(async (m, i) => {
            const base = written[i];
            const url = (await blogMediaPreviewUrl(blogDirHandle, m)) ?? '';
            const fileName = blogMediaFileName(m.url);
            const scene: Scene =
              m.type === 'video'
                ? {
                    id: genId('scene'),
                    ...base,
                    photoRef: '',
                    localVideoName: fileName,
                    localVideoUrl: url,
                    sourcePostId: m.postId,
                    sourceMediaId: m.id,
                  }
                : {
                    id: genId('scene'),
                    ...base,
                    photoRef: url,
                    localImageName: fileName,
                    sourcePostId: m.postId,
                    sourceMediaId: m.id,
                  };
            const list = scenesByPostId.get(m.postId) ?? [];
            list.push(scene);
            scenesByPostId.set(m.postId, list);
          })
        );
      }

      // 사진/영상이 없는 글 → 본문 내용으로 나레이션만 있는 장면 1개씩 생성
      // (화면에는 아이콘 기반 "이미지 없음" 표시가 나타납니다)
      if (textOnlyPosts.length > 0) {
        setBuildStage('사진·영상이 없는 글은 본문 내용으로 장면을 작성하는 중...');
        const textDescriptors: PostTextDescriptor[] = textOnlyPosts.map((p) => ({
          id: p.id,
          title: p.title,
          content: stripHtml(p.content),
          location: p.location || undefined,
          date: p.createdAt?.slice(0, 10),
        }));
        const writtenText = await generateStoryboardFromPosts({
          items: textDescriptors,
          settings: { baseUrl: llmBaseUrl, model: llmModel, mode: llmMode },
        });
        textOnlyPosts.forEach((p, i) => {
          const base = writtenText[i];
          const scene: Scene = {
            id: genId('scene'),
            ...base,
            photoRef: '',
            sourcePostId: p.id,
          };
          scenesByPostId.set(p.id, [scene]);
        });
      }

      // 글 원래 순서(날짜순)를 유지하며 합칩니다.
      const newScenes: Scene[] = posts.flatMap((p) => scenesByPostId.get(p.id) ?? []);

      if (newScenes.length === 0) {
        setNotice({ tone: 'error', text: '스토리보드로 만들 내용이 없습니다. 글을 다시 선택해주세요.' });
        return;
      }

      setScenes(newScenes);
      setSelectedSceneId(newScenes[0]?.id ?? null);
      const now = new Date().toISOString();
      setCurrentProject({
        id: genId('proj'),
        name: posts[0]?.title ? `${posts[0].title} 외 ${Math.max(0, posts.length - 1)}개 글` : '새 스토리보드',
        folderPath: '',
        createdAt: now,
        modifiedAt: now,
        scenes: newScenes,
      });
      pushEditLog(
        'storyboard_generate',
        `블로그 글 ${posts.length}개(사진·영상 장면 ${media.length}개, 텍스트 장면 ${textOnlyPosts.length}개)로 스토리보드 생성`
      );
      setView('editor');
      onClose();
    } catch (err: any) {
      setNotice({ tone: 'error', text: `스토리보드를 만드는 중 문제가 발생했습니다: ${err?.message ?? '알 수 없는 오류'}` });
    } finally {
      setBuilding(false);
      setBuildStage('');
    }
  };

  const modalBg = darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200';

  return (
    <ModalBackdrop onClose={onClose} closeOnBackdropClick={false}>
      <div className={cn('w-full max-w-2xl rounded-2xl border shadow-2xl max-h-[85vh] flex flex-col', modalBg)}>
        <div className={cn('shrink-0 flex items-center justify-between px-6 py-4 border-b', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <div className="flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-sky-500" />
            <h2 className="font-bold text-base">블로그에서 가져오기</h2>
          </div>
          <button onClick={onClose} className={cn('w-7 h-7 flex items-center justify-center rounded-lg', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto scrollbar-hide flex-1 min-h-0">
          {!blogDirHandle ? (
            <div className="text-center py-8 space-y-3">
              <Newspaper className={cn('w-10 h-10 mx-auto', darkMode ? 'text-neutral-700' : 'text-neutral-300')} />
              <p className={cn('text-sm', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
                블로그가 데이터를 저장하는 폴더(posts.json, media-meta.json, uploads/가 있는 폴더)를 연결해주세요.
              </p>
              <button
                onClick={handleConnect}
                disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                블로그 데이터 폴더 연결
              </button>
              {notice && (
                <p className={cn('text-xs', notice.tone === 'ok' ? 'text-emerald-500' : 'text-rose-500')}>{notice.text}</p>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-xs">
                  <FolderCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="font-medium">"{blogDirName}" · 글 {blogPosts.length}개 · 미디어 {blogMedia.length}개</span>
                </div>
                <button onClick={disconnectBlogDataFolder} className="text-xs text-neutral-400 hover:text-neutral-600 flex items-center gap-1">
                  <Link2Off className="w-3.5 h-3.5" /> 연결 해제
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-[140px]">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="제목·내용·장소 검색"
                    className={cn(
                      'w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border',
                      darkMode ? 'bg-neutral-800 border-neutral-700' : 'bg-neutral-50 border-neutral-200'
                    )}
                  />
                </div>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={cn('px-2.5 py-1.5 text-xs rounded-lg border', darkMode ? 'bg-neutral-800 border-neutral-700' : 'bg-neutral-50 border-neutral-200')} />
                <span className="text-xs text-neutral-400">~</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={cn('px-2.5 py-1.5 text-xs rounded-lg border', darkMode ? 'bg-neutral-800 border-neutral-700' : 'bg-neutral-50 border-neutral-200')} />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setChecked(new Set(filteredPosts.map((p) => p.id)))}
                  disabled={filteredPosts.length === 0}
                  className={cn(
                    'flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border font-medium transition-colors disabled:opacity-40',
                    darkMode ? 'border-neutral-700 text-neutral-300 hover:border-neutral-600' : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                  )}
                  title="글이나 사진/영상이 있으면 모두 스토리보드에 사용합니다"
                >
                  <CheckSquare className="w-3 h-3" /> 검색된 글 모두 선택
                </button>
                {checked.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setChecked(new Set())}
                    className={cn('text-[11px] px-2 py-1 rounded-md', darkMode ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-600')}
                  >
                    선택 해제
                  </button>
                )}
                <span className={cn('text-xs ml-auto', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>{checked.size}개 선택됨</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {filteredPosts.length === 0 && (
                  <p className={cn('col-span-2 text-xs text-center py-8', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                    조건에 맞는 글이 없습니다.
                  </p>
                )}
                {filteredPosts.map((post) => {
                  const isChecked = checked.has(post.id);
                  const preview = previewUrls[post.id];
                  const mediaCount = blogMedia.filter((m) => m.postId === post.id).length;
                  return (
                    <button
                      key={post.id}
                      onClick={() => toggle(post.id)}
                      className={cn(
                        'text-left rounded-xl border p-2.5 flex gap-2.5 transition-all',
                        isChecked
                          ? 'border-sky-500 bg-sky-50 dark:bg-sky-500/10'
                          : darkMode
                          ? 'border-neutral-800 hover:border-neutral-700'
                          : 'border-neutral-200 hover:border-neutral-300'
                      )}
                    >
                      <div className={cn('w-14 h-14 rounded-lg shrink-0 overflow-hidden flex items-center justify-center', darkMode ? 'bg-neutral-800' : 'bg-neutral-100')}>
                        {preview ? (
                          <img src={preview} alt={post.title} className="w-full h-full object-cover" />
                        ) : (
                          <ImageOff className="w-4 h-4 text-neutral-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'w-4 h-4 rounded border shrink-0 flex items-center justify-center',
                              isChecked ? 'bg-sky-500 border-sky-500' : darkMode ? 'border-neutral-600' : 'border-neutral-300'
                            )}
                          >
                            {isChecked && <Check className="w-3 h-3 text-white" />}
                          </span>
                          <p className="text-xs font-medium truncate">{post.title}</p>
                        </div>
                        <p className={cn('text-[11px] mt-0.5 truncate', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                          {post.createdAt.slice(0, 10)}{post.location ? ` · ${post.location}` : ''} · {mediaCount > 0 ? `사진/영상 ${mediaCount}개` : '사진/영상 없음 (글 내용으로 생성)'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {building && (
            <div className="flex items-center gap-2 text-xs text-emerald-500 bg-emerald-500/10 rounded-lg px-3 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {buildStage || 'AI가 스토리보드를 만드는 중...'}
            </div>
          )}
          {notice && !building && (
            <p className={cn('text-xs', notice.tone === 'ok' ? 'text-emerald-500' : 'text-rose-500')}>{notice.text}</p>
          )}
        </div>

        {blogDirHandle && (
          <div className={cn('shrink-0 px-6 py-4 border-t flex justify-end gap-2', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
            <button onClick={onClose} className={cn('px-4 py-2 text-sm rounded-lg transition-colors', darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-100 text-neutral-500')}>
              취소
            </button>
            <button
              onClick={handleApply}
              disabled={checked.size === 0}
              title="선택한 글을 채팅 컨텍스트로 가져와 대화하며 스토리보드를 만듭니다"
              className="px-4 py-2 text-sm rounded-lg font-medium bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" /> 채팅으로 가져오기
            </button>
            <button
              onClick={handleBuildStoryboardFromBlog}
              disabled={checked.size === 0 || building || llmStatus === 'offline'}
              title={llmStatus === 'offline' ? 'AI(LM Studio) 연결이 필요합니다' : '선택한 글의 사진·영상, 그리고 사진/영상이 없는 글은 본문 내용으로 AI가 바로 스토리보드를 만듭니다'}
              className="px-4 py-2 text-sm rounded-lg font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white flex items-center gap-1.5"
            >
              {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              AI로 바로 스토리보드 만들기
            </button>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

// ─── Media Library Modal (이미지/영상 폴더) ────────────────────────────────────

const MAX_MEDIA_ITEMS = 60;

function MediaLibraryModal({ darkMode, onClose }: { darkMode: boolean; onClose: () => void }) {
  const {
    mediaDirHandle,
    mediaDirName,
    connectMediaFolder,
    scenes,
    selectedSceneId,
    applyImageToScene,
    applyLocalVideoToScene,
    llmBaseUrl,
    llmModel,
    llmMode,
    llmStatus,
    setScenes,
    setSelectedSceneId,
    setCurrentProject,
    setView,
    pushEditLog,
  } = useStore();

  const [items, setItems] = useState<MediaFileEntry[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [applyingPath, setApplyingPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  // 여러 개 선택 모드: 선택한 순서대로 AI가 한 번에 스토리보드를 만들어줍니다.
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [building, setBuilding] = useState(false);
  const [buildStage, setBuildStage] = useState('');
  // 생성한 objectURL을 모두 누적해두었다가, 모달이 닫힐 때 한 번에 정리합니다.
  // (state를 클로저로 참조하면 마지막 값이 아닌 최초 렌더 시점 값을 참조하게 되므로 ref를 사용합니다)
  const createdUrlsRef = useRef<string[]>([]);
  // 2026-07-23 버그 수정: 예전에는 위 createdUrlsRef의 URL을 모달이 닫힐 때 무조건 전부
  // revoke했는데, 그중에는 이미 장면에 적용되어 계속 써야 하는 URL도 섞여 있어 모달을
  // 닫으면 방금 적용한 사진이 깨지는 문제가 있었습니다. 실제로 장면(store)에 적용되었거나
  // 새 스토리보드에 쓰인 URL은 여기 표시해두고, 모달이 닫힐 때 이 목록에 있는 URL은
  // revoke하지 않습니다 (썸네일 전용으로만 쓰인 URL만 정리합니다).
  const appliedUrlsRef = useRef<Set<string>>(new Set());

  const selectedScene = scenes.find((s) => s.id === selectedSceneId) ?? scenes[0] ?? null;

  useEffect(() => {
    if (!mediaDirHandle) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    listMediaFiles(mediaDirHandle)
      .then(async (files) => {
        if (cancelled) return;
        const limited = files.slice(0, MAX_MEDIA_ITEMS);
        setItems(limited);
        if (files.length > MAX_MEDIA_ITEMS) {
          setErrorMsg(`파일이 많아 처음 ${MAX_MEDIA_ITEMS}개만 표시합니다.`);
        }
        // 이미지 썸네일만 미리 objectURL 생성 (영상은 적용 시점에 생성)
        const urls: Record<string, string> = {};
        await Promise.all(
          limited
            .filter((f) => f.kind === 'image')
            .map(async (f) => {
              try {
                const url = await fileHandleToObjectUrl(f.handle);
                urls[f.path] = url;
                createdUrlsRef.current.push(url);
              } catch (err) {
                console.error(err);
              }
            })
        );
        if (!cancelled) setThumbUrls(urls);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setErrorMsg('미디어 폴더를 읽는 중 문제가 발생했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaDirHandle]);

  useEffect(() => {
    // 모달이 닫힐 때(언마운트 시) 그동안 생성해둔 objectURL 중, 실제로 장면에 적용되지 않고
    // 썸네일로만 쓰인 것들만 정리합니다 (적용된 URL을 지우면 방금 고른 사진/영상이 깨집니다).
    return () => {
      createdUrlsRef.current.forEach((url) => {
        if (!appliedUrlsRef.current.has(url)) URL.revokeObjectURL(url);
      });
      createdUrlsRef.current = [];
    };
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setErrorMsg(null);
    const res = await connectMediaFolder();
    setConnecting(false);
    if (!res.ok && res.message && res.message !== '폴더 선택이 취소되었습니다.') {
      setErrorMsg(res.message);
    }
  };

  const handleApply = async (entry: MediaFileEntry) => {
    if (multiSelect) {
      setSelectedPaths((prev) =>
        prev.includes(entry.path) ? prev.filter((p) => p !== entry.path) : [...prev, entry.path]
      );
      return;
    }
    if (!selectedScene) {
      setErrorMsg('먼저 편집기에서 장면을 선택해주세요.');
      return;
    }
    setApplyingPath(entry.path);
    try {
      if (entry.kind === 'image') {
        let url = thumbUrls[entry.path];
        if (!url) {
          url = await fileHandleToObjectUrl(entry.handle);
          createdUrlsRef.current.push(url);
        }
        appliedUrlsRef.current.add(url);
        applyImageToScene(selectedScene.id, url, {
          localImageName: entry.name,
          logMessage: `"${selectedScene.customTitle}" 장면에 로컬 이미지 적용: ${entry.name}`,
        });
      } else {
        await applyLocalVideoToScene(selectedScene.id, entry);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('미디어를 적용하는 중 문제가 발생했습니다.');
    } finally {
      setApplyingPath(null);
    }
  };

  const toggleMultiSelect = () => {
    setMultiSelect((v) => !v);
    setSelectedPaths([]);
    setErrorMsg(null);
  };

  /**
   * 사용자가 순서대로 고른 사진/영상으로 AI가 스토리보드를 만듭니다. 채팅으로 먼저
   * 컨셉을 정하는 방식과 달리, 선택한 미디어 "그대로" 순서를 유지한 채 한 장면씩
   * 나레이션/대사를 붙입니다. 결과는 새 프로젝트로 편집기에 바로 열립니다.
   */
  const handleBuildStoryboardFromMedia = async () => {
    if (building || selectedPaths.length === 0) return;
    if (llmStatus === 'offline') {
      setErrorMsg('AI(LM Studio)가 연결되어 있지 않습니다. 헤더의 "설정"에서 먼저 연결해주세요.');
      return;
    }
    setBuilding(true);
    setErrorMsg(null);
    try {
      const orderedEntries = selectedPaths
        .map((p) => items.find((i) => i.path === p))
        .filter((e): e is MediaFileEntry => Boolean(e));

      setBuildStage('선택한 사진/영상에 어울리는 나레이션을 작성하는 중...');
      const descriptors: MediaDescriptor[] = orderedEntries.map((entry) => ({
        label: entry.name,
        kind: entry.kind,
      }));
      const written = await generateStoryboardFromMedia({
        items: descriptors,
        settings: { baseUrl: llmBaseUrl, model: llmModel, mode: llmMode },
      });

      setBuildStage('사진·영상 파일을 장면에 연결하는 중...');
      const newScenes: Scene[] = await Promise.all(
        orderedEntries.map(async (entry, i) => {
          const base = written[i];
          if (entry.kind === 'video') {
            const url = await fileHandleToObjectUrl(entry.handle);
            createdUrlsRef.current.push(url);
            appliedUrlsRef.current.add(url);
            return {
              id: genId('scene'),
              ...base,
              photoRef: '',
              localVideoName: entry.name,
              localVideoUrl: url,
            } satisfies Scene;
          }
          let url = thumbUrls[entry.path];
          if (!url) {
            url = await fileHandleToObjectUrl(entry.handle);
            createdUrlsRef.current.push(url);
          }
          appliedUrlsRef.current.add(url);
          return {
            id: genId('scene'),
            ...base,
            photoRef: url,
            localImageName: entry.name,
          } satisfies Scene;
        })
      );

      setScenes(newScenes);
      setSelectedSceneId(newScenes[0]?.id ?? null);
      const now = new Date().toISOString();
      setCurrentProject({
        id: genId('proj'),
        name: newScenes[0]?.customTitle ? `${newScenes[0].customTitle} 외 ${newScenes.length - 1}개 장면` : '새 스토리보드',
        folderPath: '',
        createdAt: now,
        modifiedAt: now,
        scenes: newScenes,
      });
      pushEditLog('storyboard_generate', `미디어 라이브러리에서 선택한 사진·영상 ${newScenes.length}개로 스토리보드 생성`);
      setView('editor');
      onClose();
    } catch (err: any) {
      setErrorMsg(`스토리보드를 만드는 중 문제가 발생했습니다: ${err?.message ?? '알 수 없는 오류'}`);
    } finally {
      setBuilding(false);
      setBuildStage('');
    }
  };

  const filteredItems = items.filter((f) => filter === 'all' || f.kind === filter);
  const modalBg = darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200';

  return (
    <ModalBackdrop onClose={onClose}>
      <div className={cn('w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl', modalBg)}>
        <div className={cn('flex items-center justify-between px-6 py-4 border-b shrink-0', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-emerald-500" />
            <h2 className="font-bold text-base">미디어 라이브러리</h2>
          </div>
          <button onClick={onClose} className={cn('w-7 h-7 flex items-center justify-center rounded-lg', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-3 border-b shrink-0 flex flex-wrap items-center gap-2 text-xs" style={{ borderColor: darkMode ? '#262626' : '#e5e5e5' }}>
          {multiSelect ? (
            <span className={cn(darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
              고른 순서대로 <span className="font-semibold text-emerald-500">{selectedPaths.length}개</span> 선택됨 — AI가 순서 그대로 스토리보드를 만듭니다
            </span>
          ) : (
            <span className={cn(darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
              적용 대상:{' '}
              <span className="font-semibold text-indigo-500">{selectedScene ? selectedScene.customTitle : '선택된 장면 없음'}</span>
            </span>
          )}
          <button
            onClick={toggleMultiSelect}
            className={cn(
              'flex items-center gap-1.5 font-medium px-2.5 py-1 rounded-md transition-colors',
              multiSelect
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : darkMode
                ? 'bg-neutral-800 text-neutral-300 hover:text-white'
                : 'bg-neutral-100 text-neutral-600 hover:text-neutral-900'
            )}
            title="여러 개를 골라 한 번에 AI 스토리보드를 만듭니다"
          >
            {multiSelect ? <CheckSquare className="w-3.5 h-3.5" /> : <Images className="w-3.5 h-3.5" />}
            {multiSelect ? '여러 개 선택 중' : '여러 개 선택해서 AI로 만들기'}
          </button>
          <div className="flex-1" />
          {mediaDirHandle ? (
            <span className="flex items-center gap-1.5 text-emerald-500">
              <FolderCheck className="w-3.5 h-3.5" /> "{mediaDirName}" 연결됨
            </span>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-1.5 font-medium px-2.5 py-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10 transition-colors"
            >
              {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              미디어 폴더 연결
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hide p-6">
          {!mediaDirHandle ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <ImageIcon className={cn('w-12 h-12', darkMode ? 'text-neutral-700' : 'text-neutral-300')} />
              <p className={cn('text-sm', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
                이미지·영상이 들어있는 내 컴퓨터 폴더를 연결하면
                <br />
                여기서 바로 골라 장면에 적용할 수 있습니다.
              </p>
              <p className={cn('text-xs max-w-sm', darkMode ? 'text-neutral-600' : 'text-neutral-400')}>
                원본 파일은 저장 폴더로 복사되지 않고, 파일명만 기억해두었다가 같은 미디어 폴더를 다시 연결하면 자동으로 복원됩니다.
              </p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-400">
              <Loader2 className="w-4 h-4 animate-spin" /> 미디어를 불러오는 중...
            </div>
          ) : items.length === 0 ? (
            <p className={cn('text-sm text-center py-16', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
              이 폴더에서 이미지/영상 파일을 찾지 못했습니다.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-1.5 mb-4">
                {(['all', 'image', 'video'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                      filter === f
                        ? 'bg-indigo-600 text-white'
                        : darkMode
                        ? 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                        : 'bg-neutral-100 text-neutral-500 hover:text-neutral-800'
                    )}
                  >
                    {f === 'all' ? '전체' : f === 'image' ? '이미지' : '영상'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filteredItems.map((entry) => {
                  const selectionIndex = selectedPaths.indexOf(entry.path);
                  const isSelected = selectionIndex !== -1;
                  return (
                    <button
                      key={entry.path}
                      onClick={() => handleApply(entry)}
                      disabled={applyingPath === entry.path}
                      className={cn(
                        'group relative aspect-video rounded-xl overflow-hidden border transition-all disabled:opacity-60',
                        isSelected
                          ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                          : darkMode
                          ? 'border-neutral-800 hover:border-indigo-500'
                          : 'border-neutral-200 hover:border-indigo-400'
                      )}
                    >
                      {entry.kind === 'image' && thumbUrls[entry.path] ? (
                        <img src={thumbUrls[entry.path]} alt={entry.name} className="w-full h-full object-cover" />
                      ) : entry.kind === 'video' ? (
                        <div className={cn('w-full h-full flex flex-col items-center justify-center gap-1', darkMode ? 'bg-neutral-800' : 'bg-neutral-100')}>
                          <Video className={cn('w-6 h-6', darkMode ? 'text-neutral-500' : 'text-neutral-400')} />
                          <span className={cn('text-[10px]', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>영상</span>
                        </div>
                      ) : (
                        <div className={cn('w-full h-full flex flex-col items-center justify-center gap-1', darkMode ? 'bg-neutral-800' : 'bg-neutral-100')}>
                          <ImageOff className={cn('w-6 h-6', darkMode ? 'text-neutral-500' : 'text-neutral-400')} />
                          <span className={cn('text-[10px]', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>불러오는 중</span>
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-1">
                        <p className="text-[10px] text-white truncate">{entry.path}</p>
                      </div>
                      {multiSelect ? (
                        <div
                          className={cn(
                            'absolute top-1.5 left-1.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2',
                            isSelected ? 'bg-emerald-600 text-white border-white' : 'bg-black/40 text-white/80 border-white/60'
                          )}
                        >
                          {isSelected ? selectionIndex + 1 : ''}
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                          {applyingPath === entry.path ? (
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                          ) : (
                            <span className="text-white text-xs font-medium bg-indigo-600 px-2.5 py-1 rounded-full">
                              이 장면에 적용
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {errorMsg && (
            <div className="mt-4 flex items-start gap-2 text-xs text-rose-500 bg-rose-500/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {multiSelect && (
          <div
            className={cn(
              'shrink-0 flex items-center justify-between gap-3 px-6 py-3 border-t',
              darkMode ? 'border-neutral-800 bg-neutral-900/60' : 'border-neutral-200 bg-neutral-50'
            )}
          >
            <span className={cn('text-xs', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
              {building ? buildStage || 'AI가 스토리보드를 만드는 중...' : `${selectedPaths.length}개 선택됨`}
            </span>
            <button
              onClick={handleBuildStoryboardFromMedia}
              disabled={building || selectedPaths.length === 0 || llmStatus === 'offline'}
              title={llmStatus === 'offline' ? 'AI(LM Studio) 연결이 필요합니다' : undefined}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                building || selectedPaths.length === 0 || llmStatus === 'offline'
                  ? darkMode
                    ? 'bg-neutral-800 text-neutral-600 cursor-not-allowed'
                    : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              )}
            >
              {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              AI로 스토리보드 만들기
            </button>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
