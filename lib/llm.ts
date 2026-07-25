// LM Studio 로컬 서버(OpenAI 호환 API, 기본 http://localhost:1234/v1)와 통신하는 클라이언트입니다.
//
// 브라우저에서 LM Studio(localhost:1234)로 직접 fetch하면 CORS 설정에 따라 막힐 수 있으므로,
// 항상 이 앱의 Next.js 서버(app/api/llm/*)를 경유합니다. 서버 → 서버(같은 컴퓨터 안의 localhost) 요청은
// CORS 제약이 없고, 스트리밍 응답도 그대로 클라이언트에 릴레이합니다.
//
// 이 프로젝트는 오직 LM Studio + 사용자가 지정한 하나의 모델(기본값: qwen3.5-9b)만 사용합니다.
// 다른 클라우드 LLM API는 호출하지 않습니다.
//
// ─── 2026-07-23 속도 최적화 ───────────────────────────────────────────────────
// 로컬 LLM(특히 9B급 모델)은 "프롬프트 길이"와 "생성 토큰 수 제한 여부"에 응답 속도가
// 크게 좌우됩니다. 기존 코드는 (1) max_tokens을 전혀 지정하지 않아 모델이 필요 이상으로
// 길게 생성될 수 있었고 (2) 채팅이 길어질수록 전체 대화 기록을 매번 그대로 다시 보내
// 프롬프트가 계속 커지는 문제가 있었습니다. 아래 두 가지로 개선합니다:
//  - 용도별로 적절한 max_tokens 상한을 지정 (짧은 채팅 답변 vs JSON 스토리보드 생성 등)
//  - 대화 기록은 최근 N개 메시지만 모델에 전달 (trimHistoryForPrompt)
// 서버가 아예 응답하지 않는 경우를 위한 연결 타임아웃은 app/api/llm/chat/route.ts에서
// "첫 응답(헤더)을 받을 때까지"만 적용합니다 (스트리밍 도중 긴 생성이 중간에 끊기지 않도록).

import type { BlogMediaMeta, BlogPost } from '@/lib/blogData';
import { stripHtml, resolveAuthorLabel } from '@/lib/blogData';
import { ensureReadableDuration } from '@/lib/subtitles';
import type { ChatMessage, Scene } from '@/store/useStore';

export interface LlmSettings {
  baseUrl: string;
  model: string;
  /** 2026-07-25 추가: 빠른모드(속도 위주) · 보통모드(가성비, 기본값) · 전문가모드(토큰을 많이
   *  써서 더 자세한 결과). 지정하지 않으면 'normal'과 동일하게 동작합니다. */
  mode?: 'fast' | 'normal' | 'expert';
}

/**
 * 응답 모드에 따라 max_tokens 기준값(보통모드 기준으로 호출부에서 계산한 값)을 조정합니다.
 *  - fast: 절반 정도로 줄여 응답 속도를 최우선으로 합니다 (너무 짧아지지 않게 최소값 보장).
 *  - normal: 그대로 사용합니다.
 *  - expert: 더 길고 자세한 결과가 나오도록 넉넉히 늘립니다 (토큰을 더 씁니다).
 */
function scaleTokensForMode(base: number, mode: LlmSettings['mode']): number {
  if (mode === 'fast') return Math.max(200, Math.round(base * 0.55));
  if (mode === 'expert') return Math.round(base * 1.8);
  return base;
}

/** 응답 모드에 따라 temperature도 살짝 조정합니다 (전문가모드는 더 다채롭고 자세하게). */
function scaleTemperatureForMode(base: number, mode: LlmSettings['mode']): number {
  if (mode === 'fast') return Math.max(0.2, base - 0.1);
  if (mode === 'expert') return Math.min(1, base + 0.1);
  return base;
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

/**
 * 대화가 길어져도 프롬프트가 무한정 커지지 않도록, system 메시지는 모두 보존하고
 * 나머지(user/assistant)는 최근 N개만 남깁니다. 로컬 LLM은 프롬프트가 길수록
 * (특히 컨텍스트가 작은 모델일수록) 첫 토큰이 나오기까지 훨씬 오래 걸리므로,
 * 이 트리밍이 체감 속도에 가장 큰 영향을 줍니다.
 */
const MAX_HISTORY_MESSAGES = 16;

function trimHistoryForPrompt(messages: OpenAiMessage[]): OpenAiMessage[] {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  if (rest.length <= MAX_HISTORY_MESSAGES) return messages;
  const trimmed = rest.slice(-MAX_HISTORY_MESSAGES);
  const notice: OpenAiMessage = {
    role: 'system',
    content: `(참고: 대화가 길어져 이전 메시지 ${rest.length - trimmed.length}개는 생략되었습니다. 가장 최근 대화 내용을 기준으로 답하세요.)`,
  };
  return [...systemMsgs, notice, ...trimmed];
}

/** 스트리밍 채팅 완료 요청. onToken이 토큰(부분 텍스트)마다 호출되고, 최종 전체 텍스트를 반환합니다. */
export async function streamChat(
  messages: OpenAiMessage[],
  opts: LlmSettings & { temperature?: number; maxTokens?: number; onToken?: (chunk: string) => void; signal?: AbortSignal }
): Promise<string> {
  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: opts.baseUrl,
      model: opts.model,
      messages: trimHistoryForPrompt(messages),
      temperature: scaleTemperatureForMode(opts.temperature ?? 0.7, opts.mode),
      max_tokens: scaleTokensForMode(opts.maxTokens ?? 700, opts.mode),
      stream: true,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(describeLlmError(res.status, text));
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
  opts: LlmSettings & { temperature?: number; maxTokens?: number }
): Promise<string> {
  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: opts.baseUrl,
      model: opts.model,
      messages: trimHistoryForPrompt(messages),
      temperature: scaleTemperatureForMode(opts.temperature ?? 0.5, opts.mode),
      max_tokens: scaleTokensForMode(opts.maxTokens ?? 1200, opts.mode),
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(describeLlmError(res.status, text));
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LM Studio 응답 형식이 올바르지 않습니다.');
  return content;
}

function describeLlmError(status: number, rawText: string): string {
  if (status === 504) {
    return 'LM Studio가 응답을 시작하지 않아 시간이 초과되었습니다. LM Studio 앱이 켜져 있고 모델이 로드되어 있는지 확인해주세요.';
  }
  return `LM Studio 요청 실패 (${status}): ${rawText.slice(0, 200)}`;
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

/** 예상 장면 수를 바탕으로 JSON 스토리보드 생성에 필요한 max_tokens을 대략 추정합니다. */
function estimateStoryboardMaxTokens(sceneCountHint: number): number {
  // 장면 하나당 title+narration+dialogue+tags 대략 130~180 토큰 정도로 가정하고 여유를 둡니다.
  const perScene = 200;
  const overhead = 200;
  return Math.min(3200, Math.max(900, sceneCountHint * perScene + overhead));
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

  const responseText = await chatOnce(messages, {
    ...settings,
    temperature: 0.4,
    maxTokens: estimateStoryboardMaxTokens(8),
  });
  const raw = extractJsonArray(responseText);

  const validMediaIds = new Set(blogMedia.map((m) => m.id));

  const scenes: Omit<Scene, 'id'>[] = [];
  const rawMediaIds: (string | null)[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const mediaId = typeof item.mediaId === 'string' && validMediaIds.has(item.mediaId) ? item.mediaId : null;
    const narration = typeof item.narration === 'string' ? item.narration.trim() : '';
    const dialogue = typeof item.dialogue === 'string' ? item.dialogue.trim() : '';
    const duration = ensureReadableDuration(Math.round(Number(item.duration) || 5), narration, dialogue);
    scenes.push({
      customTitle: typeof item.customTitle === 'string' && item.customTitle.trim() ? item.customTitle.trim() : `장면 ${scenes.length + 1}`,
      narration,
      dialogue,
      duration,
      tags: Array.isArray(item.tags) ? item.tags.filter((t: unknown) => typeof t === 'string').slice(0, 6) : [],
      photoRef: '',
    });
    rawMediaIds.push(mediaId);
  }

  if (scenes.length === 0) throw new Error('생성된 장면이 없습니다.');

  return { scenes, rawMediaIds };
}

// ─── 미디어 우선 스토리보드 생성 (미디어 라이브러리 / 블로그에서 사진·영상을 먼저 고른 경우) ──
//
// 채팅으로 컨셉을 먼저 정하는 방식과 반대로, 사용자가 미디어 라이브러리나 블로그 가져오기에서
// 사진/영상을 먼저 선택하면, 그 선택한 미디어 "그대로", 같은 순서로 한 장면씩 나레이션을
// 붙여 스토리보드를 만듭니다. LLM이 장면을 새로 짓거나 순서를 바꾸거나 개수를 늘리고
// 줄이는 것을 절대 허용하지 않습니다(입력 개수 = 출력 개수를 서버가 아니라 이 함수가 직접 보장합니다).

export interface MediaDescriptor {
  /** 화면에 보여줄 파일명 또는 짧은 이름 */
  label: string;
  kind: 'image' | 'video';
  /** 블로그 데이터에서 온 경우의 실제 캡션/장소/날짜 (있으면 그대로 사용, 없으면 지어내지 않도록 안내) */
  caption?: string;
  location?: string;
  date?: string;
}

const MEDIA_STORYBOARD_SYSTEM_PROMPT = `당신은 KWJMvideoAI의 영상 스토리보드 작가입니다.
사용자가 이미 사진/영상 파일을 순서대로 선택했습니다. 그 순서와 개수를 그대로 유지하면서
각 사진/영상에 어울리는 장면 제목, 나레이션, 대사, 태그, 재생시간을 한국어로 작성하세요.
캡션이나 장소 정보가 주어진 항목은 그 사실에 근거해 작성하고 지어내지 마세요.
캡션 정보가 없는 항목은 파일명과 전체 흐름(앞뒤 장면)을 참고해 자연스러운 여행/일상 영상
분위기로 짧게 작성하되, 구체적인 장소명이나 날짜처럼 확인할 수 없는 "사실"을 단정적으로
지어내지 마세요(예: 없는 지명을 만들어내지 말 것).`;

function buildMediaStoryboardInstruction(items: MediaDescriptor[]): string {
  const lines = items.map((item, i) => {
    const parts = [`${i + 1}. [${item.kind === 'video' ? '영상' : '사진'}] 파일명: ${item.label}`];
    if (item.caption) parts.push(`캡션: "${item.caption}"`);
    if (item.location) parts.push(`장소: ${item.location}`);
    if (item.date) parts.push(`날짜: ${item.date}`);
    return parts.join(' / ');
  });

  return `다음은 사용자가 선택한 사진/영상 목록입니다 (이 순서와 개수를 그대로 유지해 한 장면씩 작성하세요):
${lines.join('\n')}

아래 형식의 JSON 배열만 출력하세요. 다른 설명, 코드블록 표시(백틱), 여는 말은 절대 포함하지 마세요.
배열의 길이는 반드시 위 목록과 정확히 같은 ${items.length}개여야 하고, 순서도 동일해야 합니다.

[
  {
    "customTitle": "장면 제목 (짧게)",
    "narration": "나레이션 (2~4문장, 한국어)",
    "dialogue": "등장인물 대사 (없으면 빈 문자열)",
    "duration": 5,
    "tags": ["태그1", "태그2"]
  }
]

규칙:
- duration은 2~15 사이의 정수(초)로 하세요.
- 캡션/장소/날짜가 주어지지 않은 항목의 사실 정보를 지어내지 마세요.`;
}

/**
 * 사용자가 미디어 라이브러리 또는 블로그에서 직접 고른 사진/영상 목록으로 스토리보드를
 * 만듭니다. 반환되는 배열은 항상 입력과 같은 길이/순서를 유지합니다 (LLM이 개수를
 * 틀리게 반환하면 부족한 부분은 안전한 기본값으로 채우고, 넘치는 부분은 잘라냅니다 —
 * 즉 사용자가 고른 미디어가 누락되는 일은 없습니다).
 */
export async function generateStoryboardFromMedia(params: {
  items: MediaDescriptor[];
  settings: LlmSettings;
}): Promise<Omit<Scene, 'id' | 'photoRef'>[]> {
  const { items, settings } = params;
  if (items.length === 0) throw new Error('선택된 사진/영상이 없습니다.');

  const messages: OpenAiMessage[] = [
    { role: 'system', content: MEDIA_STORYBOARD_SYSTEM_PROMPT },
    { role: 'user', content: buildMediaStoryboardInstruction(items) },
  ];

  const responseText = await chatOnce(messages, {
    ...settings,
    temperature: 0.5,
    maxTokens: estimateStoryboardMaxTokens(items.length),
  });

  let raw: RawStoryboardScene[] = [];
  try {
    raw = extractJsonArray(responseText);
  } catch {
    raw = [];
  }

  return items.map((item, i) => {
    const entry = raw[i] ?? {};
    const narration =
      typeof entry.narration === 'string' && entry.narration.trim()
        ? entry.narration.trim()
        : `${item.label} 장면.`;
    const dialogue = typeof entry.dialogue === 'string' ? entry.dialogue.trim() : '';
    const duration = ensureReadableDuration(Math.round(Number(entry.duration) || 5), narration, dialogue);
    return {
      customTitle:
        typeof entry.customTitle === 'string' && entry.customTitle.trim() ? entry.customTitle.trim() : `장면 ${i + 1}`,
      narration,
      dialogue,
      duration,
      tags: Array.isArray(entry.tags) ? entry.tags.filter((t: unknown) => typeof t === 'string').slice(0, 6) : [],
    };
  });
}

// ─── 텍스트(글)만으로 스토리보드 생성 (2026-07-25 추가) ────────────────────────
//
// "선택한 글에 사진/영상이 없습니다" 오류를 없애기 위한 기능입니다. 사진/영상이 없는
// 블로그 글도, 글 본문 내용을 근거로 나레이션을 지어 장면 하나씩 만들 수 있게 합니다.
// (사진/영상이 있는 글은 계속 generateStoryboardFromMedia로 처리하고, 이 함수는 사진/영상이
//  전혀 없는 글에만 사용합니다 — "글이나 사진이 있으면 스토리보드에 모두 사용" 요구사항.)

export interface PostTextDescriptor {
  id: string;
  title: string;
  content: string;
  location?: string;
  date?: string;
}

const TEXT_STORYBOARD_SYSTEM_PROMPT = `당신은 KWJMvideoAI의 영상 스토리보드 작가입니다.
사용자가 사진/영상 없이 글(텍스트)만 선택했습니다. 각 글의 제목과 본문 내용을 근거로,
글 하나당 장면 하나씩 어울리는 장면 제목과 나레이션, 대사, 태그, 재생시간을 한국어로
작성하세요. 글에 없는 사실(장소, 날짜, 이름 등)을 지어내지 말고, 본문에 실제로 있는
내용을 요약하거나 자연스럽게 풀어써서 나레이션으로 만드세요.`;

function buildTextStoryboardInstruction(items: PostTextDescriptor[]): string {
  const lines = items.map((item, i) => {
    const parts = [`${i + 1}. 제목: "${item.title}"`];
    if (item.location) parts.push(`장소: ${item.location}`);
    if (item.date) parts.push(`날짜: ${item.date}`);
    const body = item.content.slice(0, 600);
    parts.push(`본문: "${body}${item.content.length > 600 ? '...' : ''}"`);
    return parts.join(' / ');
  });

  return `다음은 사진/영상 없이 선택된 글 목록입니다 (이 순서와 개수를 그대로 유지해 글 하나당 장면 하나씩 작성하세요):
${lines.join('\n')}

아래 형식의 JSON 배열만 출력하세요. 다른 설명, 코드블록 표시(백틱), 여는 말은 절대 포함하지 마세요.
배열의 길이는 반드시 위 목록과 정확히 같은 ${items.length}개여야 하고, 순서도 동일해야 합니다.

[
  {
    "customTitle": "장면 제목 (짧게)",
    "narration": "나레이션 (2~4문장, 한국어, 본문 내용 근거)",
    "dialogue": "등장인물 대사 (없으면 빈 문자열)",
    "duration": 6,
    "tags": ["태그1", "태그2"]
  }
]

규칙:
- duration은 3~20 사이의 정수(초)로 하세요 (사진/영상이 없으므로 나레이션 길이에 맞게 조금 더 길어도 됩니다).
- 본문에 없는 사실을 지어내지 마세요.`;
}

/**
 * 사진/영상이 전혀 없는 블로그 글들로 스토리보드 장면을 만듭니다. (텍스트만으로 생성 —
 * 반환된 장면들은 photoRef/localImageName/localVideoName이 모두 비어 있고, 화면에는
 * 아이콘 기반 "이미지 없음" 표시가 나타납니다.)
 */
export async function generateStoryboardFromPosts(params: {
  items: PostTextDescriptor[];
  settings: LlmSettings;
}): Promise<Omit<Scene, 'id' | 'photoRef'>[]> {
  const { items, settings } = params;
  if (items.length === 0) return [];

  const messages: OpenAiMessage[] = [
    { role: 'system', content: TEXT_STORYBOARD_SYSTEM_PROMPT },
    { role: 'user', content: buildTextStoryboardInstruction(items) },
  ];

  const responseText = await chatOnce(messages, {
    ...settings,
    temperature: 0.6,
    maxTokens: estimateStoryboardMaxTokens(items.length),
  });

  let raw: RawStoryboardScene[] = [];
  try {
    raw = extractJsonArray(responseText);
  } catch {
    raw = [];
  }

  return items.map((item, i) => {
    const entry = raw[i] ?? {};
    const narration =
      typeof entry.narration === 'string' && entry.narration.trim()
        ? entry.narration.trim()
        : stripHtml(item.content).slice(0, 200) || `${item.title} 장면.`;
    const dialogue = typeof entry.dialogue === 'string' ? entry.dialogue.trim() : '';
    const duration = ensureReadableDuration(Math.round(Number(entry.duration) || 6), narration, dialogue);
    return {
      customTitle:
        typeof entry.customTitle === 'string' && entry.customTitle.trim() ? entry.customTitle.trim() : item.title || `장면 ${i + 1}`,
      narration,
      dialogue,
      duration,
      tags: Array.isArray(entry.tags) ? entry.tags.filter((t: unknown) => typeof t === 'string').slice(0, 6) : [],
    };
  });
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

  const text = await chatOnce(messages, { ...settings, temperature: 0.8, maxTokens: 400 });
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
