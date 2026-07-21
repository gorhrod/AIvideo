// LM Studio 로컬 서버(OpenAI 호환 API, 기본 http://localhost:1234/v1)와 통신하는 클라이언트입니다.
//
// 브라우저에서 LM Studio(localhost:1234)로 직접 fetch하면 CORS 설정에 따라 막힐 수 있으므로,
// 항상 이 앱의 Next.js 서버(app/api/llm/*)를 경유합니다. 서버 → 서버(같은 컴퓨터 안의 localhost) 요청은
// CORS 제약이 없고, 스트리밍 응답도 그대로 클라이언트에 릴레이합니다.
//
// 이 프로젝트는 오직 LM Studio + 사용자가 지정한 하나의 모델(기본값: qwen3.5-9b)만 사용합니다.
// 다른 클라우드 LLM API는 호출하지 않습니다.

import type { BlogMediaMeta, BlogPost } from '@/lib/blogData';
import { stripHtml, resolveAuthorLabel } from '@/lib/blogData';
import type { ChatMessage, Scene } from '@/store/useStore';

export interface LlmSettings {
  baseUrl: string;
  model: string;
}

export interface LlmHealth {
  ok: boolean;
  models: string[];
  error?: string;
}

/** LM Studio 서버 상태 + 현재 로드된 모델 목록을 확인합니다. */
export async function checkLlmHealth(baseUrl: string): Promise<LlmHealth> {
  try {
    const res = await fetch(`/api/llm/health?baseUrl=${encodeURIComponent(baseUrl)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.ok) return { ok: false, models: [], error: data.error ?? 'LM Studio에 연결할 수 없습니다.' };
    return { ok: true, models: data.models ?? [] };
  } catch (err: any) {
    return { ok: false, models: [], error: err?.message ?? '연결 확인 중 오류가 발생했습니다.' };
  }
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 스트리밍 채팅 완료 요청. onToken이 토큰(부분 텍스트)마다 호출되고, 최종 전체 텍스트를 반환합니다. */
export async function streamChat(
  messages: OpenAiMessage[],
  opts: LlmSettings & { temperature?: number; onToken?: (chunk: string) => void; signal?: AbortSignal }
): Promise<string> {
  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: opts.baseUrl,
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0.7,
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`LM Studio 요청 실패 (${res.status}): ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta: string | undefined = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content;
        if (delta) {
          full += delta;
          opts.onToken?.(delta);
        }
      } catch {
        // 일부 서버는 청크 하나에 여러 JSON을 붙여 보내기도 하므로, 파싱 실패는 조용히 무시합니다.
      }
    }
  }
  return full;
}

/** 스트리밍 없이 완전한 응답 텍스트 하나만 필요할 때 사용합니다 (JSON 생성 등). */
export async function chatOnce(
  messages: OpenAiMessage[],
  opts: LlmSettings & { temperature?: number }
): Promise<string> {
  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: opts.baseUrl,
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0.5,
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LM Studio 요청 실패 (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LM Studio 응답 형식이 올바르지 않습니다.');
  return content;
}

// ─── 시스템 프롬프트 ─────────────────────────────────────────────────────────

export const CHAT_SYSTEM_PROMPT = `당신은 KWJMvideoAI의 영상 스토리보드 기획 어시스턴트입니다.
사용자가 만들고 싶은 영상(가족 브이로그, 여행 영상, 블로그 기반 다큐 등)을 함께 구체화하는 대화를 한국어로 나눕니다.
컨셉, 분위기, 등장인물, 장소, 장면 흐름, 나레이션 톤 등을 사용자와 상의하고 제안하세요.
사용자가 블로그 글/사진 데이터를 첨부하면 그 내용(제목, 사진 설명, 장소, 날짜)에 근거해서만 이야기하고,
정보가 없는 부분은 추측해서 지어내지 마세요.
답변은 3~6문장 정도로 간결하게 하고, 대화가 충분히 구체화되면 사용자가 화면 하단의
"스토리보드로 만들기" 버튼을 눌러 실제 장면을 생성할 수 있다는 점을 자연스럽게 안내해도 좋습니다.`;

export function buildBlogContextText(
  posts: BlogPost[],
  media: BlogMediaMeta[],
  authorLabels?: Record<string, string>
): string {
  if (posts.length === 0) return '';
  const lines: string[] = ['[연결된 블로그 데이터]'];
  for (const post of posts) {
    lines.push(
      `- 글 id=${post.id} / 제목: "${post.title}" / 작성자: ${resolveAuthorLabel(post.author, authorLabels)} / 날짜: ${post.createdAt.slice(0, 10)}${post.location ? ` / 장소: ${post.location}` : ''}`
    );
    const text = stripHtml(post.content).slice(0, 300);
    if (text) lines.push(`  본문 요약: ${text}`);
    const postMedia = media.filter((m) => m.postId === post.id).sort((a, b) => a.order - b.order);
    for (const m of postMedia) {
      lines.push(
        `  · media id=${m.id} (${m.type === 'video' ? '영상' : '사진'}) 캡션="${m.caption || '(없음)'}" 장소="${m.location || post.location || '(없음)'}" 날짜=${m.year}-${m.month}-${m.day}`
      );
    }
  }
  return lines.join('\n');
}

const STORYBOARD_JSON_INSTRUCTION = `지금까지의 대화 내용을 바탕으로 영상 스토리보드를 만들어주세요.
아래 형식의 JSON 배열만 출력하세요. 다른 설명, 코드블록 표시(백틱), 여는 말은 절대 포함하지 마세요. 오직 JSON 배열만 출력합니다.

[
  {
    "customTitle": "장면 제목 (짧게)",
    "narration": "나레이션 (2~4문장, 한국어)",
    "dialogue": "등장인물 대사 (없으면 빈 문자열)",
    "duration": 5,
    "tags": ["태그1", "태그2"],
    "mediaId": "블로그 미디어 목록에 있는 id 중 하나 또는 null"
  }
]

규칙:
- 장면은 4~8개 정도로 구성하세요.
- duration은 2~12 사이의 정수(초)로 하세요.
- [연결된 블로그 데이터]가 대화에 포함되어 있다면, mediaId는 반드시 거기 나열된 media id 값 중 하나를 그대로 사용하세요. 목록에 없는 값을 새로 만들지 마세요. 그 데이터가 없거나 어울리는 사진이 없으면 mediaId는 null로 두세요.
- 캡션/설명이 없는 사진의 내용을 추측해서 지어내지 마세요. 제공된 정보(제목, 캡션, 장소, 날짜)만 사용하세요.`;

export interface RawStoryboardScene {
  customTitle?: string;
  narration?: string;
  dialogue?: string;
  duration?: number;
  tags?: string[];
  mediaId?: string | null;
}

function extractJsonArray(text: string): RawStoryboardScene[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('LLM 응답에서 JSON 배열을 찾지 못했습니다.');
  }
  const jsonSlice = text.slice(start, end + 1);
  const parsed = JSON.parse(jsonSlice);
  if (!Array.isArray(parsed)) throw new Error('LLM 응답이 배열 형식이 아닙니다.');
  return parsed;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 채팅 기록(+선택적으로 연결된 블로그 컨텍스트)을 근거로 스토리보드 장면 배열을 생성합니다. */
export async function generateStoryboardFromChat(params: {
  chatHistory: ChatMessage[];
  blogPosts?: BlogPost[];
  blogMedia?: BlogMediaMeta[];
  blogAuthorLabels?: Record<string, string>;
  settings: LlmSettings;
}): Promise<{ scenes: Omit<Scene, 'id'>[]; rawMediaIds: (string | null)[] }> {
  const { chatHistory, blogPosts = [], blogMedia = [], blogAuthorLabels, settings } = params;

  const messages: OpenAiMessage[] = [{ role: 'system', content: CHAT_SYSTEM_PROMPT }];

  const blogContext = buildBlogContextText(blogPosts, blogMedia, blogAuthorLabels);
  if (blogContext) {
    messages.push({ role: 'system', content: blogContext });
  }

  for (const m of chatHistory) {
    messages.push({ role: m.role, content: m.text });
  }
  messages.push({ role: 'user', content: STORYBOARD_JSON_INSTRUCTION });

  const responseText = await chatOnce(messages, { ...settings, temperature: 0.4 });
  const raw = extractJsonArray(responseText);

  const validMediaIds = new Set(blogMedia.map((m) => m.id));

  const scenes: Omit<Scene, 'id'>[] = [];
  const rawMediaIds: (string | null)[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const duration = Math.min(20, Math.max(1, Math.round(Number(item.duration) || 5)));
    const mediaId = typeof item.mediaId === 'string' && validMediaIds.has(item.mediaId) ? item.mediaId : null;
    scenes.push({
      customTitle: typeof item.customTitle === 'string' && item.customTitle.trim() ? item.customTitle.trim() : `장면 ${scenes.length + 1}`,
      narration: typeof item.narration === 'string' ? item.narration.trim() : '',
      dialogue: typeof item.dialogue === 'string' ? item.dialogue.trim() : '',
      duration,
      tags: Array.isArray(item.tags) ? item.tags.filter((t: unknown) => typeof t === 'string').slice(0, 6) : [],
      photoRef: '',
    });
    rawMediaIds.push(mediaId);
  }

  if (scenes.length === 0) throw new Error('생성된 장면이 없습니다.');

  return { scenes, rawMediaIds };
}

/** 하나의 씬에 대해 나레이션을 다시 만들어달라고 LLM에 요청합니다. */
export async function regenerateSceneNarration(params: {
  scene: Scene;
  allScenes: Scene[];
  settings: LlmSettings;
}): Promise<{ narration: string; dialogue: string }> {
  const { scene, allScenes, settings } = params;
  const idx = allScenes.findIndex((s) => s.id === scene.id);
  const context = allScenes
    .map((s, i) => `${i + 1}. ${s.customTitle}${i === idx ? ' ← 이 장면을 다시 작성' : ''}`)
    .join('\n');

  const messages: OpenAiMessage[] = [
    {
      role: 'system',
      content:
        '당신은 영상 나레이션 작가입니다. 요청받은 한 장면의 나레이션과 대사를 한국어로 다시 작성합니다. ' +
        '다른 설명 없이 아래 JSON 형식 하나만 출력하세요: {"narration":"...","dialogue":"..."} (대사가 없으면 dialogue는 빈 문자열)',
    },
    {
      role: 'user',
      content: `전체 장면 순서:\n${context}\n\n다시 작성할 장면 정보:\n제목: ${scene.customTitle}\n기존 나레이션: ${scene.narration}\n기존 대사: ${scene.dialogue || '(없음)'}\n태그: ${(scene.tags ?? []).join(', ') || '(없음)'}\n재생시간: ${scene.duration}초\n\n같은 분위기를 유지하되 문장 표현을 새롭게 바꿔서 다시 작성해주세요.`,
    },
  ];

  const text = await chatOnce(messages, { ...settings, temperature: 0.8 });
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const parsed = JSON.parse(text.slice(start, end + 1));
    return {
      narration: typeof parsed.narration === 'string' ? parsed.narration.trim() : scene.narration,
      dialogue: typeof parsed.dialogue === 'string' ? parsed.dialogue.trim() : scene.dialogue,
    };
  } catch {
    // JSON 파싱에 실패하면 응답 텍스트 전체를 나레이션으로 사용합니다.
    return { narration: text.trim(), dialogue: scene.dialogue };
  }
}
