'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useStore, sanitizeScenesForSave } from '@/store/useStore';
import type { Scene, Project, LlmMode, MediaAnalysisEntry } from '@/store/useStore';
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
  type BlogPost,
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
  Lock,
  ArrowLeft,
  Pin,
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

/**
 * 2026-07-27(2): "비슷한 이미지 추천" 패널이 인터넷 스톡 사진 대신, 실제로 가져온 블로그
 * 사진 중에서 이 장면과 어울릴 만한 것을 찾아 추천하도록 하는 점수 계산 함수입니다.
 *  - 같은 블로그 글에서 나온 사진이면 가장 높은 점수를 줍니다(이미 문맥이 같으므로).
 *  - 장면의 태그가 사진 캡션/위치나 글 제목/태그와 겹치면 점수를 더합니다.
 *  - 이미 이 장면에 적용되어 있는 바로 그 사진은 추천 목록에서 제외합니다.
 */
function scoreBlogMediaForScene(item: BlogMediaMeta, scene: Scene, postsById: Map<string, BlogPost>): number {
  if (scene.sourceMediaId && item.id === scene.sourceMediaId) return -Infinity;
  let score = 0;
  if (scene.sourcePostId && item.postId === scene.sourcePostId) score += 10;
  const post = postsById.get(item.postId);
  const haystack = `${item.caption} ${item.location} ${post?.title ?? ''} ${(post?.tags ?? []).join(' ')} ${post?.category ?? ''}`.toLowerCase();
  for (const tag of scene.tags ?? []) {
    if (tag && haystack.includes(tag.toLowerCase())) score += 3;
  }
  return score;
}

/** 장면과 어울릴 만한 블로그 사진을 최대 `limit`개 골라 반환합니다(사진이 없으면 빈 배열). */
function getBlogRecommendationsForScene(
  scene: Scene,
  blogPosts: BlogPost[],
  blogMedia: BlogMediaMeta[],
  limit = 4
): BlogMediaMeta[] {
  const images = blogMedia.filter((m) => m.type === 'image');
  if (images.length === 0) return [];
  const postsById = new Map(blogPosts.map((p) => [p.id, p]));
  return images
    .map((item) => ({ item, score: scoreBlogMediaForScene(item, scene, postsById) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}

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
 *
 * 2026-07-28 개선: 예전에는 mediaId가 없거나(LLM이 null로 두거나 잘못된 값을 준 경우) 곧바로
 * 인터넷 스톡 사진(RECOMMEND_POOLS, 블로그와 무관한 임의 이미지)으로 대체해서, "블로그 데이터를
 * 가져왔는데 스토리보드에는 관련 없는 사진이 붙는" 문제가 있었습니다. 이제는 그 전에 먼저 실제로
 * 가져온 블로그 사진들 중 이 장면의 태그/키워드와 가장 잘 맞는 것을 `scoreBlogMediaForScene`로
 * 찾아 배정합니다(이미 다른 장면에 쓰인 사진은 제외해 중복을 최대한 피합니다). 블로그 사진이
 * 전혀 없을 때만 최후 수단으로 스톡 이미지를 씁니다.
 */
async function resolveScenesWithBlogMedia(
  scenes: Omit<Scene, 'id'>[],
  mediaIds: (string | null)[],
  blogDirHandle: any,
  blogMedia: BlogMediaMeta[],
  blogPosts: BlogPost[] = []
): Promise<Scene[]> {
  const postsById = new Map(blogPosts.map((p) => [p.id, p]));
  const usedMediaIds = new Set<string>();

  // 1단계: LLM이 명시적으로 지정한 mediaId부터 먼저 확정해서(순서대로 처리해야 "먼저 쓴
  // 사진은 다른 장면이 다시 쓰지 않는다"는 중복 방지가 정확히 동작합니다) usedMediaIds를 채웁니다.
  const resolved: Scene[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const base = scenes[i];
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
            usedMediaIds.add(item.id);
          }
        } catch (err) {
          console.error('블로그 미디어를 불러오지 못했습니다:', err);
        }
      }
    }

    // 2단계: mediaId가 없거나(null) LLM이 지정한 값을 불러오지 못했다면, 실제로 가져온
    // 블로그 사진 중 이 장면과 가장 잘 맞는 것을 키워드 기반으로 찾아 대신 배정합니다.
    if (!photoRef && !localVideoUrl && blogDirHandle && blogMedia.length > 0) {
      const sceneLike = { tags: base.tags, sourceMediaId: undefined, sourcePostId: undefined } as Scene;
      const candidates = blogMedia
        .filter((m) => m.type === 'image' && !usedMediaIds.has(m.id))
        .map((item) => ({ item, score: scoreBlogMediaForScene(item, sceneLike, postsById) }))
        .filter((s) => Number.isFinite(s.score))
        .sort((a, b) => b.score - a.score);

      for (const candidate of candidates) {
        try {
          const url = await blogMediaPreviewUrl(blogDirHandle, candidate.item);
          if (url) {
            photoRef = url;
            localImageName = blogMediaFileName(candidate.item.url);
            sourceMediaId = candidate.item.id;
            sourcePostId = candidate.item.postId;
            usedMediaIds.add(candidate.item.id);
            break;
          }
        } catch (err) {
          console.error('블로그 추천 사진을 불러오지 못했습니다:', err);
        }
      }
    }

    // 3단계(최후 수단): 블로그 사진이 아예 없거나 위 두 단계 모두 실패한 경우에만
    // 태그 기반의 일반 스톡 이미지로 대체합니다.
    if (!photoRef && !localVideoUrl) {
      photoRef = getRecommendations({ tags: base.tags } as Scene)[0] ?? RECOMMEND_POOLS.beach[0];
    }

    resolved.push({
      id: genId('scene'),
      ...base,
      photoRef,
      localImageName,
      localVideoName,
      localVideoUrl,
      sourceMediaId,
      sourcePostId,
    });
  }

  return resolved;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function AppRoot() {
  const { view, setView, modal, setModal, darkMode, setDarkMode, initStorage, saveDirSource, saveDirHandle } = useStore();
  // 2026-07-27(4): "폴더 지정 안 되어있으면 스토리보드 편집기 화면이 안 보여야 한다"는
  // 요청 — 실제 사용자 폴더(saveDirSource === 'external')가 연결되기 전에는 편집기 화면을
  // 잠금 안내 화면으로 대체합니다. 연결되는 즉시(store가 반응형이므로 새로고침 없이) 채팅
  // 화면과 편집기 화면 모두 정상적으로 나타납니다.
  const hasRealFolder = saveDirSource === 'external' && !!saveDirHandle;

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
          {/* Logo — 2026-07-27(2): 클릭하면 바로 채팅 화면으로 이동합니다. */}
          <button
            type="button"
            onClick={() => setView('chat')}
            title="채팅으로 이동"
            className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 shrink-0 hover:opacity-80 transition-opacity"
          >
            <Clapperboard className="w-5 h-5" />
            <span className="font-bold text-base tracking-tight">KWJMvideoAI</span>
          </button>

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
              icon={hasRealFolder ? <Clapperboard className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
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
              icon={<Upload className="w-3.5 h-3.5" />}
              label="가져오기"
              onClick={() => setModal('import')}
              darkMode={darkMode}
            />
            <HeaderNavBtn
              icon={<Download className="w-3.5 h-3.5" />}
              label="내보내기"
              onClick={() => setModal('export')}
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
              <EditorInterface darkMode={darkMode} hasRealFolder={hasRealFolder} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {modal === 'new-project' && (
          <NewProjectModal darkMode={darkMode} onClose={() => setModal(null)} />
        )}
        {modal === 'import' && (
          <ImportHubModal
            darkMode={darkMode}
            onClose={() => setModal(null)}
            onPick={(target) => setModal(target)}
          />
        )}
        {modal === 'load' && (
          <LoadModal darkMode={darkMode} onClose={() => setModal(null)} onBack={() => setModal('import')} />
        )}
        {modal === 'export' && (
          <ExportModal darkMode={darkMode} onClose={() => setModal(null)} />
        )}
        {modal === 'media' && (
          <MediaLibraryModal darkMode={darkMode} onClose={() => setModal(null)} onBack={() => setModal('import')} />
        )}
        {modal === 'settings' && (
          <SettingsModal darkMode={darkMode} onClose={() => setModal(null)} />
        )}
        {modal === 'blog-import' && (
          <BlogImportModal darkMode={darkMode} onClose={() => setModal(null)} onBack={() => setModal('import')} />
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
    let isFirstCheck = true;
    const check = async () => {
      // 2026-07-27(3): 첫 확인에서만 "확인 중..." 표시를 보여주고, 이후 백그라운드
      // 재확인에서는 결과가 나올 때까지 이전 상태를 그대로 유지합니다(깜빡임 방지).
      if (isFirstCheck) setLlmStatus('checking');
      const health = await checkLlmHealth(llmBaseUrl);
      if (cancelled) return;
      isFirstCheck = false;
      setLlmStatus(health.ok ? 'online' : 'offline');
      // 연결이 끊긴 상태에서도 이전에 있던 모델 목록이 남아있으면 "여전히 연결된 것처럼"
      // 보일 수 있어, 오프라인이면 모델 목록도 함께 비웁니다.
      setLlmAvailableModels(health.ok ? health.models : []);
    };
    check();
    // 헤더의 상태가 실제와 최대한 가깝게 맞도록 주기를 짧게 두고(8초), 사용자가 다른 탭/
    // 창에서 LM Studio를 켜고 다시 이 탭으로 돌아왔을 때도 기다리지 않고 즉시 재확인합니다.
    const interval = setInterval(check, 8000);
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'hidden') return;
      check();
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
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
    saveStatus,
    saveError,
    lastSavedAt,
    autoSaveEnabled,
    setAutoSaveEnabled,
    connectSaveFolder,
    disconnectSaveFolder,
    saveAllToFolder,
  } = useStore();

  const [fsSupported, setFsSupported] = useState(true);
  const [busy, setBusy] = useState<'save' | 'reconnect' | null>(null);
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
    try {
      const res = await connectSaveFolder();
      if (res.message) setNotice({ tone: res.ok ? 'ok' : 'error', text: res.message });
    } catch (err) {
      console.error(err);
      setNotice({ tone: 'error', text: '폴더를 연결하는 중 예기치 못한 오류가 발생했습니다.' });
    } finally {
      setBusy(null);
    }
  };

  const handleReconnect = async () => {
    setBusy('reconnect');
    try {
      const res = await reconnectRememberedSaveFolder();
      if (res.message) setNotice({ tone: res.ok ? 'ok' : 'error', text: res.message });
    } catch (err) {
      console.error(err);
      setNotice({ tone: 'error', text: '폴더를 다시 연결하는 중 예기치 못한 오류가 발생했습니다.' });
    } finally {
      setBusy(null);
    }
  };

  const handleManualSave = async () => {
    setBusy('save');
    try {
      const res = await saveAllToFolder();
      if (!res.ok && res.message) setNotice({ tone: 'error', text: res.message });
    } catch (err) {
      console.error(err);
      setNotice({ tone: 'error', text: '저장하는 중 예기치 못한 오류가 발생했습니다.' });
    } finally {
      setBusy(null);
    }
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

          {/* 2026-07-27(2): "미디어 폴더"를 별도로 연결하던 개념을 없애고 저장 폴더(자동
              저장소 포함)와 완전히 합쳤습니다. 사진/영상도 항상 이 저장 폴더 안에 저장되므로,
              여기서는 실제 폴더가 연결되어 있는지에 따른 안내만 보여줍니다. */}
          <div className="flex items-center gap-1.5">
            {saveDirSource === 'external' ? (
              <>
                <ImageIcon className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className={cn(darkMode ? 'text-neutral-400' : 'text-neutral-500')}>사진·영상도 저장 폴더에 함께 저장됩니다</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className={cn(darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
                  사진/영상 등록 기능을 쓰려면 먼저 저장 폴더를 등록하세요
                </span>
              </>
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
    saveDirSource,
    saveDirHandle,
  } = useStore();
  // 2026-07-28: 채팅도 스토리보드 편집기와 동일하게, 실제 저장 폴더가 연결되기 전에는
  // 화면 자체를 숨기고 폴더 연결 안내만 보여줍니다 — 채팅 내용이 저장 폴더 안에 JSON으로
  // 저장되려면 실제 폴더 연결이 먼저 필요하기 때문입니다.
  const hasRealFolder = saveDirSource === 'external' && !!saveDirHandle;
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
    } catch (err: any) {
      // 2026-07-27: 예전에는 원인이 무엇이든(빈 응답, 400 오류, 연결 안 됨 등) 항상 같은
      // "연결하지 못했습니다" 메시지만 보여줘서 실제 원인(예: 추론 모델이 토큰을 다 써버림,
      // 채팅 템플릿 400 오류 등)을 알 수 없었습니다. lib/llm.ts가 던지는 구체적인 오류
      // 메시지를 그대로 보여주고, 메시지가 없을 때만 기존의 일반적인 안내를 사용합니다.
      addChatMessage(
        'assistant',
        `⚠️ ${err?.message || `LM Studio 서버(${llmBaseUrl})에 연결하지 못했습니다. LM Studio 앱에서 "Local Server"가 켜져 있고, 모델(${llmModel})이 로드되어 있는지 확인한 뒤 다시 시도해주세요. 헤더의 "설정"에서 주소/모델을 바꿀 수 있습니다.`}`
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
      const resolved = await resolveScenesWithBlogMedia(rawScenes, rawMediaIds, blogDirHandle, selectedMedia, selectedPosts);

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

  // 2026-07-28: 실제 저장 폴더가 연결되어 있지 않으면 채팅 화면 자체를 숨기고, 스토리보드
  // 편집기와 동일한 폴더 연결 안내 화면을 보여줍니다. store가 반응형이라 연결에 성공하는
  // 순간 이 화면이 사라지고 채팅 화면이 바로 나타납니다.
  if (!hasRealFolder) {
    return (
      <FolderConnectGate
        darkMode={darkMode}
        title="채팅을 시작하려면 저장 폴더를 먼저 연결하세요"
        description="폴더를 연결해야 채팅 내용과 스토리보드가 실제 저장 폴더 안에 JSON 파일로 저장됩니다. 폴더를 연결하면 이 화면이 즉시 사라지고 채팅이 시작됩니다."
      />
    );
  }

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

// ─── 저장 폴더 연결 잠금 화면 (2026-07-27(4) 신설, 2026-07-28 채팅 화면에도 재사용) ──────
//
// 요청사항: "스토리보드 편집기도 폴더 지정 안 되어있으면 화면 안 보이게 만들고, 폴더
// 지정되면 시작할 수 있게, 연결 즉시 채팅 화면 및 스토리보드 편집기 화면이 나와야 함."
// → 이후 "채팅도 편집기처럼 폴더 연결 화면이 나와야 한다"는 후속 요청으로, 채팅/편집기
// 두 화면 모두 이 컴포넌트를 그대로 재사용합니다. store가 반응형이라 연결에 성공하는
// 순간(같은 렌더 사이클 안에서) 이 화면이 사라지고 실제 화면이 즉시 나타납니다 —
// 새로고침이나 재진입이 필요 없습니다.
function FolderConnectGate({
  darkMode,
  title,
  description,
}: {
  darkMode: boolean;
  title: string;
  description: string;
}) {
  const { rememberedSaveDirName, connectSaveFolder, reconnectRememberedSaveFolder } = useStore();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleConnect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = rememberedSaveDirName ? await reconnectRememberedSaveFolder() : await connectSaveFolder();
      if (!res.ok && res.message) setNotice(res.message);
    } catch (err) {
      console.error(err);
      setNotice('폴더를 연결하는 중 예기치 못한 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center', darkMode ? 'bg-neutral-800' : 'bg-neutral-100')}>
        <Lock className={cn('w-7 h-7', darkMode ? 'text-neutral-500' : 'text-neutral-400')} />
      </div>
      <p className="text-base font-semibold">{title}</p>
      <p className={cn('text-sm max-w-md leading-relaxed', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>{description}</p>
      <button
        onClick={handleConnect}
        disabled={busy}
        className="mt-1 flex items-center gap-1.5 font-medium px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
        {rememberedSaveDirName ? '이전 저장 폴더 다시 연결' : '저장 폴더 연결하기'}
      </button>
      {notice && <p className="text-xs text-rose-500 max-w-sm">{notice}</p>}
    </div>
  );
}

function EditorInterface({ darkMode, hasRealFolder }: { darkMode: boolean; hasRealFolder: boolean }) {
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

  // 2026-07-27(4): 실제 저장 폴더가 연결되어 있지 않으면 스토리보드 편집기 화면 자체를
  // 보여주지 않고, 폴더를 연결하라는 잠금 화면으로 대체합니다. store가 반응형이라 폴더
  // 연결이 성공하는 순간 이 조건이 바뀌어 별도 새로고침 없이 바로 편집기가 나타납니다.
  if (!hasRealFolder) {
    return (
      <FolderConnectGate
        darkMode={darkMode}
        title="스토리보드 편집기를 시작하려면 저장 폴더를 먼저 연결하세요"
        description="사진/영상 등록, 프로젝트 저장, 비슷한 이미지 추천이 모두 실제 저장 폴더 안에 파일로 보관됩니다. 폴더를 연결하면 이 화면이 즉시 사라지고 편집기가 시작됩니다."
      />
    );
  }

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

        {/* 로컬 미디어 참조 표시 — 2026-07-27(4): "사진 등록"/"영상 등록" 버튼은 이제
            우측 "비슷한 이미지 추천" 패널의 새로고침 버튼 왼쪽으로 옮겼습니다(RecommendPanel 참고). */}
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

// 2026-07-27(4): 프로젝트 media 폴더의 파일들을 이미지 분석 캐시(MediaAnalysisEntry)와
// 비교해 이 장면과 가장 어울리는 순서로 정렬합니다. 태그/캡션에 장면의 태그·제목 단어가
// 많이 겹칠수록 점수가 높습니다. 이미 이 장면에 적용된 파일은 후보에서 제외합니다.
function scoreProjectMediaForScene(entry: MediaAnalysisEntry, scene: Scene): number {
  const haystack = `${entry.caption} ${entry.tags.join(' ')}`.toLowerCase();
  let score = 0;
  for (const tag of scene.tags ?? []) {
    if (tag && haystack.includes(tag.toLowerCase())) score += 3;
  }
  for (const w of (scene.customTitle || '').split(/\s+/).filter((w) => w.length >= 2)) {
    if (haystack.includes(w.toLowerCase())) score += 1;
  }
  return score;
}

function getProjectMediaRecommendationsForScene(
  entries: MediaAnalysisEntry[],
  scene: Scene,
  excludePaths: Set<string>,
  limit = 4
): MediaAnalysisEntry[] {
  return entries
    .filter((e) => !excludePaths.has(e.path))
    .map((e) => ({ e, score: scoreProjectMediaForScene(e, scene) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.e);
}

function RecommendPanel({ scene, darkMode }: { scene: Scene; darkMode: boolean }) {
  const {
    applyImageToScene,
    applyLocalVideoToScene,
    updateScene,
    blogDirHandle,
    blogMedia,
    blogPosts,
    saveDirSource,
    saveDirHandle,
    ensureProjectMediaAnalysis,
    listProjectMediaFiles,
    addFilesToProjectMedia,
  } = useStore();

  // "AI 추천 4칸" — 프로젝트 media 분석 데이터가 있으면 그것을, 없으면(폴더 미연결 등)
  // 기존 블로그 추천으로 대체합니다.
  const [source, setSource] = useState<'project' | 'blog' | 'none'>('none');
  const [candidates, setCandidates] = useState<(BlogMediaMeta | MediaAnalysisEntry)[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  // "이 장면 전용 등록" — scene.pinnedMediaPaths에 있는 파일들의 미리보기 URL.
  const [pinnedUrls, setPinnedUrls] = useState<Record<string, string>>({});
  const [registerBusy, setRegisterBusy] = useState<'photo' | 'video' | null>(null);
  const [registerNotice, setRegisterNotice] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const mediaFilesRef = useRef<MediaFileEntry[]>([]);

  // 생성한 objectURL 중 실제로 장면에 적용된 것은 revoke하지 않도록 구분해서 관리합니다
  // (MediaLibraryModal과 동일한 이유입니다).
  const createdUrlsRef = useRef<string[]>([]);
  const appliedUrlsRef = useRef<Set<string>>(new Set());

  const hasRealFolder = saveDirSource === 'external' && !!saveDirHandle;
  const pinnedPaths = scene.pinnedMediaPaths ?? [];

  // ── 새로고침 대상: 4칸 추천만 다시 불러옵니다 (등록된/고정된 미디어는 그대로 둡니다) ──
  const loadRecommendations = React.useCallback(async () => {
    setLoading(true);
    const usedPaths = new Set([scene.localImageName, scene.localVideoName, ...pinnedPaths].filter(Boolean) as string[]);

    if (hasRealFolder) {
      const entries = await ensureProjectMediaAnalysis();
      const files = await listProjectMediaFiles();
      mediaFilesRef.current = files;
      if (entries.length > 0) {
        const picked = getProjectMediaRecommendationsForScene(entries, scene, usedPaths, 4);
        setSource('project');
        setCandidates(picked);
        const urlPairs = await Promise.all(
          picked.map(async (entry) => {
            const fileEntry = files.find((f) => f.path === entry.path);
            if (!fileEntry) return [entry.path, null] as const;
            try {
              const url = await fileHandleToObjectUrl(fileEntry.handle);
              createdUrlsRef.current.push(url);
              return [entry.path, url] as const;
            } catch {
              return [entry.path, null] as const;
            }
          })
        );
        const map: Record<string, string> = {};
        for (const [id, url] of urlPairs) if (url) map[id] = url;
        setPreviewUrls(map);
        setLoading(false);
        return;
      }
    }

    if (blogDirHandle && blogMedia.length > 0) {
      const picked = getBlogRecommendationsForScene(scene, blogPosts, blogMedia, 4);
      setSource('blog');
      setCandidates(picked);
      const pairs = await Promise.all(
        picked.map(async (item) => {
          try {
            const url = await blogMediaPreviewUrl(blogDirHandle, item);
            if (url) createdUrlsRef.current.push(url);
            return [item.id, url] as const;
          } catch {
            return [item.id, null] as const;
          }
        })
      );
      const map: Record<string, string> = {};
      for (const [id, url] of pairs) if (url) map[id] = url;
      setPreviewUrls(map);
      setLoading(false);
      return;
    }

    setSource('none');
    setCandidates([]);
    setPreviewUrls({});
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id, scene.localImageName, scene.localVideoName, pinnedPaths.join(','), hasRealFolder, blogDirHandle, blogMedia, blogPosts]);

  useEffect(() => {
    setAppliedId(null);
    loadRecommendations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id, hasRealFolder, blogDirHandle, blogMedia]);

  // "이 장면 전용 등록" 썸네일의 미리보기 URL을 준비합니다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasRealFolder || pinnedPaths.length === 0) {
        setPinnedUrls({});
        return;
      }
      const files = mediaFilesRef.current.length > 0 ? mediaFilesRef.current : await listProjectMediaFiles();
      mediaFilesRef.current = files;
      const pairs = await Promise.all(
        pinnedPaths.map(async (path) => {
          const fileEntry = files.find((f) => f.path === path);
          if (!fileEntry) return [path, null] as const;
          try {
            const url = await fileHandleToObjectUrl(fileEntry.handle);
            createdUrlsRef.current.push(url);
            appliedUrlsRef.current.add(url);
            return [path, url] as const;
          } catch {
            return [path, null] as const;
          }
        })
      );
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [id, url] of pairs) if (url) map[id] = url;
      setPinnedUrls(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id, pinnedPaths.join(','), hasRealFolder]);

  useEffect(() => {
    // 장면이 바뀌거나 패널이 사라질 때, 적용되지 않고 미리보기로만 쓰인 URL만 정리합니다.
    return () => {
      createdUrlsRef.current.forEach((url) => {
        if (!appliedUrlsRef.current.has(url)) URL.revokeObjectURL(url);
      });
      createdUrlsRef.current = [];
    };
  }, [scene.id]);

  const handleRefresh = () => {
    loadRecommendations();
  };

  const handleApplyBlog = (item: BlogMediaMeta, url: string) => {
    appliedUrlsRef.current.add(url);
    applyImageToScene(scene.id, url, {
      localImageName: blogMediaFileName(item.url),
      sourcePostId: item.postId,
      sourceMediaId: item.id,
      logMessage: `"${scene.customTitle}" 장면에 블로그 추천 이미지 적용`,
    });
    setAppliedId(item.id);
  };

  const handleApplyProjectMedia = async (entry: MediaAnalysisEntry, url: string) => {
    appliedUrlsRef.current.add(url);
    const fileEntry = mediaFilesRef.current.find((f) => f.path === entry.path);
    if (!fileEntry) return;
    if (entry.kind === 'video') {
      await applyLocalVideoToScene(scene.id, fileEntry);
    } else {
      applyImageToScene(scene.id, url, {
        localImageName: entry.path,
        logMessage: `"${scene.customTitle}" 장면에 추천 이미지 적용: ${entry.path}`,
      });
    }
    setAppliedId(entry.path);
  };

  // ── "사진 등록"/"영상 등록" — 새로고침 버튼 왼쪽에 위치, 이 장면 전용으로 고정됩니다 ──
  const handleRegisterFile = async (file: File, kind: 'photo' | 'video') => {
    setRegisterBusy(kind);
    setRegisterNotice(null);
    const res = await addFilesToProjectMedia([file]);
    setRegisterBusy(null);
    if (!res.ok || !res.added || res.added.length === 0) {
      setRegisterNotice(res.message ?? '등록에 실패했습니다.');
      setTimeout(() => setRegisterNotice(null), 5000);
      return;
    }
    const added = res.added[0];
    mediaFilesRef.current = [...mediaFilesRef.current, added];
    // 이 장면에만 표시되도록 scene.pinnedMediaPaths에 기록합니다(다른 장면에는 나타나지 않음).
    updateScene(scene.id, { pinnedMediaPaths: [...pinnedPaths, added.path] });
    setRegisterNotice('등록되었습니다. 아래 썸네일을 눌러 스토리보드에 넣어보세요.');
    setTimeout(() => setRegisterNotice(null), 5000);
  };

  const slots = [0, 1, 2, 3];

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
          'px-4 py-3 border-b flex items-center justify-between shrink-0 gap-2',
          darkMode ? 'border-neutral-800' : 'border-neutral-200'
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ImageIcon className="w-4 h-4 text-emerald-500 shrink-0" />
          <span className="font-semibold text-sm truncate">비슷한 이미지 추천</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) handleRegisterFile(file, 'photo');
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) handleRegisterFile(file, 'video');
            }}
          />
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={registerBusy !== null}
            title="사진 등록 (이 장면 전용)"
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded-lg transition-colors disabled:opacity-50',
              darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-200 text-neutral-500'
            )}
          >
            {registerBusy === 'photo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => videoInputRef.current?.click()}
            disabled={registerBusy !== null}
            title="영상 등록 (이 장면 전용)"
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded-lg transition-colors disabled:opacity-50',
              darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-200 text-neutral-500'
            )}
          >
            {registerBusy === 'video' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Video className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading}
            title="추천 이미지 4개 새로고침"
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded-lg transition-colors disabled:opacity-50',
              darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-200 text-neutral-500'
            )}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>
      {registerNotice && (
        <p className={cn('px-4 pt-2 text-[11px] leading-relaxed', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
          {registerNotice}
        </p>
      )}

      {/* 이 장면 전용으로 등록한 사진/영상 — 다른 장면의 추천 패널에는 나타나지 않습니다.
          새로고침을 눌러도 이 영역은 그대로 유지됩니다. */}
      {pinnedPaths.length > 0 && (
        <div className="px-4 pt-3 grid grid-cols-2 gap-2">
          {pinnedPaths.map((path) => {
            const url = pinnedUrls[path];
            const entry = mediaFilesRef.current.find((f) => f.path === path);
            const isApplied = appliedId === path || scene.localImageName === path || scene.localVideoName === path;
            if (!url) return null;
            return (
              <button
                key={path}
                onClick={() =>
                  handleApplyProjectMedia(
                    { path, kind: entry?.kind ?? 'image', tags: [], caption: '', size: 0, lastModified: 0, analyzedAt: '' },
                    url
                  )
                }
                className={cn(
                  'aspect-square rounded-xl overflow-hidden relative group ring-2 transition-all duration-150',
                  isApplied ? 'ring-indigo-500' : 'ring-transparent hover:ring-indigo-400'
                )}
              >
                {entry?.kind === 'video' ? (
                  <video src={url} className="w-full h-full object-cover bg-neutral-800" muted />
                ) : (
                  <img src={url} alt={path} className="w-full h-full object-cover bg-neutral-200" />
                )}
                <div className="absolute top-1 left-1 flex items-center gap-0.5 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                  <Pin className="w-2.5 h-2.5" /> 등록됨
                </div>
                <div
                  className={cn(
                    'absolute inset-0 flex items-center justify-center transition-opacity',
                    isApplied ? 'bg-indigo-500/30 opacity-100' : 'bg-black/30 opacity-0 group-hover:opacity-100'
                  )}
                >
                  {isApplied ? (
                    <Check className="w-5 h-5 text-white drop-shadow" />
                  ) : (
                    <span className="text-white text-xs font-medium bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-sm">
                      넣기
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* AI 추천 4칸 — 프로젝트 media 분석 데이터(media_analysis.json) 기반, 없으면 블로그 기반 */}
      <div className="p-4 grid grid-cols-2 gap-2">
        {slots.map((i) => {
          const item = candidates[i];
          const id = item ? ('id' in item ? item.id : item.path) : undefined;
          const url = id ? previewUrls[id] : undefined;
          if (!item || !url) {
            return (
              <div
                key={i}
                className={cn(
                  'aspect-square rounded-xl flex flex-col items-center justify-center gap-1 border border-dashed',
                  darkMode ? 'border-neutral-700 text-neutral-600' : 'border-neutral-300 text-neutral-400'
                )}
              >
                <ImageOff className="w-5 h-5" />
                <span className="text-[10px] text-center px-1">{loading ? '불러오는 중...' : '추천 이미지 없음'}</span>
              </div>
            );
          }
          const isApplied = appliedId === id;
          const isProjectMedia = 'analyzedAt' in item;
          return (
            <button
              key={id}
              onClick={() => (isProjectMedia ? handleApplyProjectMedia(item as MediaAnalysisEntry, url) : handleApplyBlog(item as BlogMediaMeta, url))}
              className={cn(
                'aspect-square rounded-xl overflow-hidden relative group ring-2 transition-all duration-150',
                isApplied ? 'ring-indigo-500' : 'ring-transparent hover:ring-indigo-400'
              )}
            >
              {isProjectMedia && (item as MediaAnalysisEntry).kind === 'video' ? (
                <video src={url} className="w-full h-full object-cover bg-neutral-800" muted />
              ) : (
                <img src={url} alt="추천 이미지" className="w-full h-full object-cover bg-neutral-200" />
              )}
              <div
                className={cn(
                  'absolute inset-0 flex items-center justify-center transition-opacity',
                  isApplied ? 'bg-indigo-500/30 opacity-100' : 'bg-black/30 opacity-0 group-hover:opacity-100'
                )}
              >
                {isApplied ? (
                  <Check className="w-5 h-5 text-white drop-shadow" />
                ) : (
                  <span className="text-white text-xs font-medium bg-black/50 px-2 py-0.5 rounded-full backdrop-blur-sm">
                    교체
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {source === 'none' && (
        <p className={cn('px-4 -mt-2 pb-2 text-[11px] leading-relaxed', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
          저장 폴더에 사진/영상을 등록하거나 블로그 폴더를 연결하면 이 장면과 어울리는 것을 추천해드려요.
        </p>
      )}

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
    try {
      const res = await connectSaveFolder();
      if (!res.ok && res.message && res.message !== '폴더 선택이 취소되었습니다.') {
        setErrorMsg(res.message);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('폴더를 연결하는 중 예기치 못한 오류가 발생했습니다.');
    } finally {
      setConnecting(false);
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

// ─── 가져오기 허브 모달 (2026-07-27(3) 신설) ───────────────────────────────────
//
// 요청사항: "불러오기와 미디어라이브러리와 블로그에서 가져오기는 같은 버튼 하나로
// 진행가능하게 하자." 헤더를 깔끔하게 유지하기 위해, 세 기능을 각각 별도 버튼으로
// 두지 않고 이 허브 모달에서 카드 형태로 골라 들어가도록 통합했습니다. 각 기능이
// 실제로 무엇을 필요로 하는지(저장 폴더 연결 여부 등)도 카드에 바로 보여줘서,
// 들어가서야 "폴더를 연결하세요"를 보고 다시 나오는 일을 줄입니다.
function ImportHubModal({
  darkMode,
  onClose,
  onPick,
}: {
  darkMode: boolean;
  onClose: () => void;
  onPick: (target: 'load' | 'media' | 'blog-import') => void;
}) {
  const { saveDirHandle, saveDirName, saveDirSource, blogDirHandle, blogDirName } = useStore();
  const hasRealFolder = saveDirSource === 'external' && !!saveDirHandle;
  const modalBg = darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200';

  const cards: {
    target: 'load' | 'media' | 'blog-import';
    icon: React.ReactNode;
    title: string;
    desc: string;
    status: { ok: boolean; text: string };
  }[] = [
    {
      target: 'load',
      icon: <FolderOpen className="w-5 h-5 text-indigo-500" />,
      title: '프로젝트 불러오기',
      desc: '저장 폴더(또는 다른 폴더)에 저장해둔 프로젝트를 불러옵니다.',
      status: hasRealFolder
        ? { ok: true, text: `"${saveDirName}" 폴더의 프로젝트를 바로 불러올 수 있습니다` }
        : { ok: true, text: '저장 폴더가 없어도 "다른 폴더에서 불러오기"로 바로 사용 가능' },
    },
    {
      target: 'media',
      icon: <ImageIcon className="w-5 h-5 text-emerald-500" />,
      title: '미디어 라이브러리',
      desc: '등록해둔 사진·영상을 골라 장면에 적용하거나, 새 파일을 등록합니다.',
      status: hasRealFolder
        ? { ok: true, text: '실제 저장 폴더가 연결되어 있어 바로 사용 가능' }
        : { ok: false, text: '실제 저장 폴더를 먼저 연결해야 사용할 수 있습니다' },
    },
    {
      target: 'blog-import',
      icon: <Newspaper className="w-5 h-5 text-amber-500" />,
      title: '블로그에서 가져오기',
      desc: '블로그 데이터 폴더(posts.json 등)를 연결해 글을 스토리보드로 만듭니다.',
      status: blogDirHandle
        ? { ok: true, text: `"${blogDirName}" 폴더에 연결되어 있습니다` }
        : { ok: true, text: '눌러서 블로그 데이터 폴더를 먼저 연결하세요' },
    },
  ];

  return (
    <ModalBackdrop onClose={onClose}>
      <div className={cn('w-full max-w-xl rounded-2xl border shadow-2xl', modalBg)}>
        <div className={cn('flex items-center justify-between px-6 py-4 border-b', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-500" />
            <h2 className="font-bold text-base">가져오기</h2>
          </div>
          <button onClick={onClose} className={cn('w-7 h-7 flex items-center justify-center rounded-lg', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {cards.map((c) => (
            <button
              key={c.target}
              onClick={() => onPick(c.target)}
              className={cn(
                'w-full text-left flex items-start gap-3 p-4 rounded-xl border transition-colors',
                darkMode
                  ? 'border-neutral-800 hover:border-neutral-700 hover:bg-neutral-800/60'
                  : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
              )}
            >
              <div className="shrink-0 mt-0.5">{c.icon}</div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm">{c.title}</p>
                <p className={cn('text-xs mt-0.5', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>{c.desc}</p>
                <p className={cn('text-xs mt-1.5 flex items-center gap-1', c.status.ok ? 'text-emerald-500' : 'text-amber-500')}>
                  {c.status.ok ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                  {c.status.text}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── Load Modal ───────────────────────────────────────────────────────────────

/** "다른 폴더에서 불러오기"용 JSON 파일 미리보기 — 파일명/원문 JSON을 그대로 보여주지 않고
 *  프로젝트 카드(썸네일/이름/장면 수/수정일)로 예쁘게 파싱해서 보여주기 위한 타입입니다. */
interface FolderProjectPreview {
  name: string;
  handle: any;
  title: string;
  sceneCount: number | null;
  modifiedAt: string | null;
  thumbnail?: string;
  valid: boolean;
}

function LoadModal({ darkMode, onClose, onBack }: { darkMode: boolean; onClose: () => void; onBack?: () => void }) {
  const { saveDirHandle, saveDirName, listNamedProjects, loadNamedProject, deleteNamedProject, setCurrentProject, setView } = useStore();
  const [fsSupported, setFsSupported] = useState(false);

  // 연결된 저장 폴더의 projects/ 목록
  const [namedProjects, setNamedProjects] = useState<{ name: string; handle: any; modifiedAt?: string; sceneCount?: number }[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingNamed, setLoadingNamed] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  // 임의 폴더에서 불러오기 (저장 폴더 연결 없이도 사용 가능한 보조 기능)
  const [folderName, setFolderName] = useState<string | null>(null);
  const [folderProjects, setFolderProjects] = useState<FolderProjectPreview[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [browsingFolder, setBrowsingFolder] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setFsSupported(isFileSystemAccessSupported());
  }, []);

  const refreshNamedProjects = () => {
    if (!saveDirHandle) {
      setNamedProjects([]);
      return;
    }
    setLoadingList(true);
    listNamedProjects()
      .then(setNamedProjects)
      .finally(() => setLoadingList(false));
  };

  useEffect(() => {
    refreshNamedProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleDeleteNamed = async (name: string) => {
    setDeletingName(name);
    setErrorMsg(null);
    const res = await deleteNamedProject(name);
    setDeletingName(null);
    setConfirmDelete(null);
    if (!res.ok) {
      setErrorMsg(res.message ?? '프로젝트를 삭제하는 중 문제가 발생했습니다.');
      return;
    }
    refreshNamedProjects();
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
      if (files.length === 0) {
        setFolderProjects([]);
        setErrorMsg('선택한 폴더에서 프로젝트 JSON 파일을 찾지 못했습니다.');
        return;
      }
      // 2026-07-27(2): 파일명/원문 JSON을 그대로 보여주지 않고, 각 파일을 미리 읽어
      // 이름/장면 수/썸네일/수정일이 있는 예쁜 카드로 보여줍니다.
      const previews = await Promise.all(
        files.map(async (f): Promise<FolderProjectPreview> => {
          try {
            const data = await readJsonFile(f.handle);
            if (!data || !Array.isArray(data.scenes)) {
              return { name: f.name, handle: f.handle, title: f.name.replace(/\.json$/i, ''), sceneCount: null, modifiedAt: null, valid: false };
            }
            return {
              name: f.name,
              handle: f.handle,
              title: typeof data.name === 'string' && data.name.trim() ? data.name : f.name.replace(/\.json$/i, ''),
              sceneCount: data.scenes.length,
              modifiedAt: typeof data.modifiedAt === 'string' ? data.modifiedAt : null,
              thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : data.scenes[0]?.photoRef,
              valid: true,
            };
          } catch {
            return { name: f.name, handle: f.handle, title: f.name.replace(/\.json$/i, ''), sceneCount: null, modifiedAt: null, valid: false };
          }
        })
      );
      setFolderProjects(previews);
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
        setErrorMsg('올바른 프로젝트 파일 형식이 아닙니다 (장면 목록이 없습니다).');
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
      setErrorMsg('파일을 읽는 중 문제가 발생했습니다. 올바른 프로젝트 파일인지 확인해주세요.');
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
            {onBack && (
              <button
                onClick={onBack}
                title="가져오기 목록으로"
                className={cn('w-7 h-7 -ml-1 flex items-center justify-center rounded-lg shrink-0', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
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
                  <div
                    key={proj.name}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left text-xs transition-colors',
                      darkMode ? 'border-neutral-700 bg-neutral-900/60' : 'border-neutral-200 bg-white'
                    )}
                  >
                    <button
                      onClick={() => handleLoadNamed(proj)}
                      disabled={loadingNamed === proj.name}
                      className="flex items-center gap-2.5 flex-1 min-w-0 disabled:opacity-50"
                    >
                      {loadingNamed === proj.name ? (
                        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-indigo-500" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                      )}
                      <span className="truncate font-mono flex-1 text-left">{proj.name.replace(/\.json$/i, '')}</span>
                      {typeof proj.sceneCount === 'number' && (
                        <span className={cn('shrink-0', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>{proj.sceneCount}개 장면</span>
                      )}
                      {proj.modifiedAt && (
                        <span className={cn('shrink-0', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                          {formatShortDateTime(proj.modifiedAt)}
                        </span>
                      )}
                    </button>
                    {confirmDelete === proj.name ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleDeleteNamed(proj.name)}
                          disabled={deletingName === proj.name}
                          className="px-2 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 text-[11px] font-semibold"
                        >
                          {deletingName === proj.name ? <Loader2 className="w-3 h-3 animate-spin" /> : '삭제 확정'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className={cn('px-2 py-1 rounded-md text-[11px]', darkMode ? 'text-neutral-400 hover:bg-neutral-800' : 'text-neutral-500 hover:bg-neutral-100')}
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(proj.name)}
                        title="이 프로젝트 삭제"
                        className={cn(
                          'shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors',
                          darkMode ? 'text-neutral-500 hover:bg-rose-500/10 hover:text-rose-400' : 'text-neutral-400 hover:bg-rose-50 hover:text-rose-500'
                        )}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
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
                이 브라우저는 폴더 선택을 지원하지 않아요(Chrome/Edge 권장).
              </p>
            )}

            {folderName && (
              <div className={cn('mt-2 rounded-xl border p-3', darkMode ? 'border-neutral-800 bg-neutral-800/40' : 'border-neutral-200 bg-neutral-50')}>
                <p className={cn('text-xs mb-2 flex items-center gap-1.5', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
                  <Folder className="w-3.5 h-3.5" />
                  "{folderName}" 폴더 — 프로젝트 {folderProjects.length}개
                </p>
                {folderProjects.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-hide">
                    {folderProjects.map((proj) => (
                      <button
                        key={proj.name}
                        onClick={() => {
                          if (!proj.valid) return;
                          setSelectedFile(proj.name);
                          handleLoadFromFolderFile(proj);
                        }}
                        disabled={loadingFile || !proj.valid}
                        className={cn(
                          'w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors disabled:opacity-50',
                          selectedFile === proj.name
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                            : darkMode
                            ? 'border-neutral-700 hover:border-neutral-600 bg-neutral-900/60'
                            : 'border-neutral-200 hover:border-neutral-300 bg-white'
                        )}
                      >
                        <div className="w-16 h-10 rounded-md overflow-hidden shrink-0 bg-neutral-200">
                          {proj.valid ? (
                            <img src={getSceneImageSrc(proj.thumbnail)} alt={proj.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ImageOff className="w-4 h-4 text-neutral-400" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate flex items-center gap-1.5">
                            {loadingFile && selectedFile === proj.name && <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />}
                            {proj.title}
                          </p>
                          {proj.valid ? (
                            <div className={cn('flex gap-2 mt-0.5 text-[11px]', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                              <span>{proj.sceneCount}개 장면</span>
                              {proj.modifiedAt && (
                                <>
                                  <span>·</span>
                                  <span>수정: {formatShortDateTime(proj.modifiedAt)}</span>
                                </>
                              )}
                            </div>
                          ) : (
                            <p className="text-[11px] text-rose-400 mt-0.5">프로젝트 형식이 아닌 파일입니다</p>
                          )}
                        </div>
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
        </div>

        <div className={cn('px-6 py-4 border-t flex justify-end gap-2 sticky bottom-0', modalBg, darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <button onClick={onClose} className={cn('px-4 py-2 text-sm rounded-lg transition-colors', darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-100 text-neutral-500')}>
            닫기
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

function BlogImportModal({ darkMode, onClose, onBack }: { darkMode: boolean; onClose: () => void; onBack?: () => void }) {
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
    try {
      const res = await connectBlogDataFolder();
      setNotice({ tone: res.ok ? 'ok' : 'error', text: res.message ?? '' });
    } catch (err) {
      console.error(err);
      setNotice({ tone: 'error', text: '폴더를 연결하는 중 예기치 못한 오류가 발생했습니다.' });
    } finally {
      setBusy(false);
    }
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
    // 2026-07-27: "채팅으로 가져오기"를 누르면 메시지만 채팅 기록에 추가되고 화면은 그대로
    // 블로그 가져오기 모달/편집기에 머물러 있어 사용자가 방금 보낸 메시지를 못 보는 문제가 있었습니다.
    // 채팅 화면으로 자동 전환하도록 수정.
    setView('chat');
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
            {onBack && (
              <button
                onClick={onBack}
                title="가져오기 목록으로"
                className={cn('w-7 h-7 -ml-1 flex items-center justify-center rounded-lg shrink-0', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
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

function MediaLibraryModal({ darkMode, onClose, onBack }: { darkMode: boolean; onClose: () => void; onBack?: () => void }) {
  const {
    saveDirHandle,
    saveDirSource,
    currentProject,
    connectSaveFolder,
    listProjectMediaFiles,
    addFilesToProjectMedia,
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

  const hasRealFolder = saveDirSource === 'external' && !!saveDirHandle;

  const [items, setItems] = useState<MediaFileEntry[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [applyingPath, setApplyingPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  // 여러 개 선택 모드: 선택한 순서대로 AI가 한 번에 스토리보드를 만들어줍니다.
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [building, setBuilding] = useState(false);
  const [buildStage, setBuildStage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const reloadItems = React.useCallback(() => {
    if (!hasRealFolder) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    listProjectMediaFiles()
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
        if (!cancelled) setErrorMsg('미디어를 불러오는 중 문제가 발생했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRealFolder, currentProject?.name]);

  useEffect(() => {
    const cleanup = reloadItems();
    return cleanup;
  }, [reloadItems]);

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
    try {
      const res = await connectSaveFolder();
      if (!res.ok && res.message && res.message !== '폴더 선택이 취소되었습니다.') {
        setErrorMsg(res.message);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('폴더를 연결하는 중 예기치 못한 오류가 발생했습니다.');
    } finally {
      setConnecting(false);
    }
  };

  const handleRegisterFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setRegistering(true);
    setErrorMsg(null);
    const res = await addFilesToProjectMedia(Array.from(fileList));
    setRegistering(false);
    if (!res.ok) {
      setErrorMsg(res.message ?? '파일을 등록하는 중 문제가 발생했습니다.');
      return;
    }
    reloadItems();
    if (fileInputRef.current) fileInputRef.current.value = '';
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
            {onBack && (
              <button
                onClick={onBack}
                title="가져오기 목록으로"
                className={cn('w-7 h-7 -ml-1 flex items-center justify-center rounded-lg shrink-0', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => handleRegisterFiles(e.target.files)}
          />
          {hasRealFolder ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={registering}
              className="flex items-center gap-1.5 font-medium px-2.5 py-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10 transition-colors"
            >
              {registering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
              사진/영상 등록
            </button>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-1.5 font-medium px-2.5 py-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10 transition-colors"
            >
              {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              저장 폴더 연결
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hide p-6">
          {!hasRealFolder ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <ImageIcon className={cn('w-12 h-12', darkMode ? 'text-neutral-700' : 'text-neutral-300')} />
              <p className={cn('text-sm', darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
                실제 저장 폴더를 등록하면 사진/영상을 등록하고
                <br />
                여기서 바로 골라 장면에 적용할 수 있습니다.
              </p>
              <p className={cn('text-xs max-w-sm', darkMode ? 'text-neutral-600' : 'text-neutral-400')}>
                등록한 사진/영상은 브라우저가 아닌, 사용자가 고른 저장 폴더 안에 실제 파일로 저장됩니다.
              </p>
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="mt-1 flex items-center gap-1.5 font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                저장 폴더 연결하기
              </button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-400">
              <Loader2 className="w-4 h-4 animate-spin" /> 미디어를 불러오는 중...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <ImageOff className={cn('w-10 h-10', darkMode ? 'text-neutral-700' : 'text-neutral-300')} />
              <p className={cn('text-sm', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>
                아직 등록된 사진/영상이 없습니다.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={registering}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                {registering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderPlus className="w-3.5 h-3.5" />}
                사진/영상 등록하기
              </button>
            </div>
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
