'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useStore, sanitizeScenesForSave } from '@/store/useStore';
import type { Scene, Project } from '@/store/useStore';
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
import { cn, getSceneImageSrc, formatShortDateTime } from '@/lib/utils';
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

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function AppRoot() {
  const { view, setView, modal, setModal, darkMode, setDarkMode } = useStore();

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  return (
    <div
      className={cn(
        'min-h-screen w-full flex flex-col font-sans transition-colors duration-300',
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
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* LLM Status — 참고: 실제 LM Studio 연결 여부를 확인하지 않는 데모용 표시입니다 */}
          <div
            className={cn(
              'hidden md:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border',
              darkMode
                ? 'border-neutral-800 bg-neutral-900 text-neutral-400'
                : 'border-neutral-200 bg-neutral-50 text-neutral-500'
            )}
            title="채팅의 AI 응답은 데모용 시뮬레이션입니다. 실제 LM Studio 연동은 별도 설정이 필요합니다."
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>LM Studio 연결됨 (데모)</span>
          </div>

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

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex">
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
      </AnimatePresence>
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
  const [busy, setBusy] = useState<'save' | 'media' | null>(null);
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
            {saveDirHandle ? (
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
  const { chatMessages: messages, addChatMessage } = useStore();
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isProcessing) return;
    const userMsg = input.trim();
    addChatMessage('user', userMsg);
    setInput('');
    setIsProcessing(true);

    // 참고: 아래 응답은 실제 LLM 연동 없이 흐름을 보여주는 데모 응답입니다.
    // 실제 LM Studio 연동 시 이 setTimeout 블록을 API 호출로 교체하면 됩니다.
    setTimeout(() => {
      addChatMessage('assistant', '블로그 데이터를 분석하고 키워드를 추출하는 중입니다...');

      setTimeout(() => {
        addChatMessage('assistant', '이미지를 분류하고 장면을 구성하는 중입니다. 잠시만 기다려주세요.');

        setTimeout(() => {
          addChatMessage(
            'assistant',
            `"${userMsg}" 요청을 바탕으로 5개 장면의 스토리보드를 생성했습니다!\n\n각 장면에는 나레이션, 대사, 추천 이미지가 포함되어 있습니다. 편집기에서 내용을 자유롭게 수정하실 수 있습니다.`
          );
          setIsProcessing(false);

          setTimeout(() => {
            onComplete();
          }, 1200);
        }, 1800);
      }, 1500);
    }, 1000);
  };

  const suggestions = [
    '제주도 가족 여행 감성 브이로그 만들어줘',
    '서울 한강 피크닉 일상 영상 만들어줘',
    '봄 꽃구경 여행 스토리보드 생성해줘',
  ];

  return (
    <div className="flex-1 flex">
      {/* Sidebar tips */}
      <div
        className={cn(
          'w-72 border-r p-6 shrink-0 hidden lg:flex flex-col gap-6',
          darkMode ? 'border-neutral-800 bg-neutral-900/30' : 'border-neutral-200 bg-neutral-50/50'
        )}
      >
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-indigo-500 mb-3">기능 안내</h3>
          <ul className="space-y-3">
            {[
              { icon: <Sparkles className="w-4 h-4 text-indigo-400" />, text: 'LLM이 블로그 글을 분석해 자동으로 장면을 구성합니다' },
              { icon: <ImageIcon className="w-4 h-4 text-emerald-400" />, text: '각 장면에 어울리는 이미지를 자동으로 추천합니다' },
              { icon: <RefreshCw className="w-4 h-4 text-amber-400" />, text: '마음에 들지 않는 이미지는 새로고침으로 교체합니다' },
              { icon: <Download className="w-4 h-4 text-rose-400" />, text: '완성된 스토리보드를 다양한 형식으로 내보냅니다' },
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
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full p-6">
        <div
          className={cn(
            'flex-1 rounded-2xl border flex flex-col overflow-hidden',
            darkMode ? 'border-neutral-800 bg-neutral-900/50' : 'border-neutral-200 bg-white shadow-sm'
          )}
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5 scrollbar-hide">
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
            {isProcessing && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mr-2.5 mt-0.5">
                  <Clapperboard className="w-3.5 h-3.5 text-white" />
                </div>
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
              </motion.div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className={cn('p-4 border-t', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="예: 제주도 가족 여행 감성 브이로그 만들어줘..."
                className={cn(
                  'flex-1 px-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all',
                  darkMode
                    ? 'bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500'
                    : 'bg-neutral-50 border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                )}
              />
              <button
                onClick={handleSend}
                disabled={isProcessing || !input.trim()}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
              >
                보내기
              </button>
            </div>
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
  const { updateScene, pushEditLog, setModal } = useStore();
  const [aiNotice, setAiNotice] = useState(false);
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

  const handleAiRegenerate = () => {
    setAiNotice(true);
    setTimeout(() => setAiNotice(false), 3000);
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
                className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-600 transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                AI 재생성
              </button>
              {aiNotice && (
                <div
                  className={cn(
                    'absolute right-0 top-6 z-10 w-56 text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg border',
                    darkMode ? 'bg-neutral-800 border-neutral-700 text-neutral-300' : 'bg-white border-neutral-200 text-neutral-600'
                  )}
                >
                  AI 재생성은 로컬 LLM(LM Studio 등) 연동이 필요한 준비 중 기능입니다. 지금은 나레이션을 직접 수정해주세요.
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

function ModalBackdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
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
  const { saveDirHandle, saveDirName, connectSaveFolder, saveNamedProject, setView } = useStore();
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
                    {proj.thumbnail && (
                      <img src={getSceneImageSrc(proj.thumbnail)} alt={proj.name} className="w-full h-full object-cover" />
                    )}
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
  const { scenes, currentProject, saveDirHandle, saveDirName, pushEditLog } = useStore();
  const projectName = currentProject?.name ?? '스토리보드';
  const [pathNote, setPathNote] = useState(currentProject ? `${currentProject.folderPath}/export` : '');
  const [format, setFormat] = useState<'pdf' | 'json' | 'txt' | 'mp4'>('pdf');
  const [alsoSaveToFolder, setAlsoSaveToFolder] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const formats = [
    { id: 'pdf', label: 'PDF 스토리보드', desc: '브라우저 인쇄창으로 저장' },
    { id: 'json', label: 'JSON 프로젝트', desc: '원본 데이터 백업 (다운로드)' },
    { id: 'txt', label: '텍스트 스크립트', desc: '나레이션/대사만 (다운로드)' },
    { id: 'mp4', label: 'MP4 영상 (예정)', desc: '자동 편집 영상 — 아직 지원되지 않음' },
  ] as const;

  const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');

  const writeExportToSaveFolder = async (fileName: string, content: string) => {
    if (!saveDirHandle) return;
    const dataDir = await getDataDir(saveDirHandle);
    const exportsDir = await getOrCreateSubDirectory(dataDir, 'exports');
    await writeTextFile(exportsDir, fileName, content);
  };

  const handleExport = async () => {
    if (isExporting || done || format === 'mp4') return;
    setIsExporting(true);
    setErrorMsg(null);
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
      }
      pushEditLog('export', `"${projectName}" ${format.toUpperCase()} 형식으로 내보내기`);
      setDone(true);
    } catch (err) {
      console.error(err);
      setErrorMsg('내보내는 중 문제가 발생했습니다.');
    } finally {
      setIsExporting(false);
    }
  };

  const modalBg = darkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-white border-neutral-200';

  return (
    <ModalBackdrop onClose={onClose}>
      <div className={cn('w-full max-w-lg rounded-2xl border shadow-2xl', modalBg)}>
        <div className={cn('flex items-center justify-between px-6 py-4 border-b', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-indigo-500" />
            <h2 className="font-bold text-base">내보내기</h2>
          </div>
          <button onClick={onClose} className={cn('w-7 h-7 flex items-center justify-center rounded-lg', darkMode ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100')}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Format selection */}
          <div>
            <label className="text-xs font-semibold mb-2 block text-indigo-500">내보내기 형식</label>
            <div className="grid grid-cols-2 gap-2">
              {formats.map((f) => (
                <button
                  key={f.id}
                  onClick={() => f.id !== 'mp4' && setFormat(f.id as typeof format)}
                  disabled={f.id === 'mp4'}
                  className={cn(
                    'p-3 rounded-xl border text-left transition-all',
                    format === f.id
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                      : darkMode
                      ? 'border-neutral-800 hover:border-neutral-700 disabled:opacity-40'
                      : 'border-neutral-200 hover:border-neutral-300 disabled:opacity-40',
                    f.id === 'mp4' && 'cursor-not-allowed'
                  )}
                >
                  <p className="text-sm font-medium">{f.label}</p>
                  <p className={cn('text-xs mt-0.5', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>{f.desc}</p>
                </button>
              ))}
            </div>
          </div>

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

          {/* Summary */}
          <div className={cn('rounded-xl p-4', darkMode ? 'bg-neutral-800/60' : 'bg-neutral-50 border border-neutral-200')}>
            <p className="text-xs font-semibold mb-2">내보내기 요약</p>
            <div className="space-y-1.5">
              <SummaryRow label="프로젝트" value={projectName} darkMode={darkMode} />
              <SummaryRow label="장면 수" value={`${scenes.length}개`} darkMode={darkMode} />
              <SummaryRow label="총 재생시간" value={`${scenes.reduce((s, sc) => s + sc.duration, 0)}초`} darkMode={darkMode} />
              <SummaryRow label="형식" value={format.toUpperCase()} darkMode={darkMode} />
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 text-xs text-rose-500 bg-rose-500/10 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div className={cn('px-6 py-4 border-t flex justify-end gap-2', darkMode ? 'border-neutral-800' : 'border-neutral-200')}>
          <button onClick={onClose} className={cn('px-4 py-2 text-sm rounded-lg transition-colors', darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-neutral-100 text-neutral-500')}>
            취소
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || format === 'mp4'}
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
  } = useStore();

  const [items, setItems] = useState<MediaFileEntry[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [applyingPath, setApplyingPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  // 생성한 objectURL을 모두 누적해두었다가, 모달이 닫힐 때 한 번에 정리합니다.
  // (state를 클로저로 참조하면 마지막 값이 아닌 최초 렌더 시점 값을 참조하게 되므로 ref를 사용합니다)
  const createdUrlsRef = useRef<string[]>([]);

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
    // 모달이 닫힐 때(언마운트 시) 그동안 생성해둔 objectURL을 모두 정리합니다.
    return () => {
      createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
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
          <span className={cn(darkMode ? 'text-neutral-400' : 'text-neutral-500')}>
            적용 대상:{' '}
            <span className="font-semibold text-indigo-500">{selectedScene ? selectedScene.customTitle : '선택된 장면 없음'}</span>
          </span>
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
                {filteredItems.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => handleApply(entry)}
                    disabled={applyingPath === entry.path}
                    className={cn(
                      'group relative aspect-video rounded-xl overflow-hidden border transition-all disabled:opacity-60',
                      darkMode ? 'border-neutral-800 hover:border-indigo-500' : 'border-neutral-200 hover:border-indigo-400'
                    )}
                  >
                    {entry.kind === 'image' && thumbUrls[entry.path] ? (
                      <img src={thumbUrls[entry.path]} alt={entry.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className={cn('w-full h-full flex flex-col items-center justify-center gap-1', darkMode ? 'bg-neutral-800' : 'bg-neutral-100')}>
                        <Video className={cn('w-6 h-6', darkMode ? 'text-neutral-500' : 'text-neutral-400')} />
                        <span className={cn('text-[10px]', darkMode ? 'text-neutral-500' : 'text-neutral-400')}>영상</span>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-1">
                      <p className="text-[10px] text-white truncate">{entry.path}</p>
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                      {applyingPath === entry.path ? (
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      ) : (
                        <span className="text-white text-xs font-medium bg-indigo-600 px-2.5 py-1 rounded-full">
                          이 장면에 적용
                        </span>
                      )}
                    </div>
                  </button>
                ))}
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
      </div>
    </ModalBackdrop>
  );
}
