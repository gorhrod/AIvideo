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

// ─── 2026-07-27 버그 수정: system 메시지 병합 ────────────────────────────────
//
// 증상: 블로그 가져오기 → 스토리보드 생성 시 "LM Studio 요청 실패 (400):
// ...Unable to generate parser for this temp..." 오류가 발생. 원인은 이 앱이
// (기본 시스템 프롬프트) + (블로그 컨텍스트), 대화가 길어지면 여기에 히스토리 생략
// 안내까지 총 2~3개의 system 역할 메시지를 함께 보냈기 때문입니다. 일부 로컬 모델
// (Qwen3.5/3.6 계열 GGUF 양자화 등)의 채팅 템플릿(Jinja)은 system 메시지가 2개
// 이상이면 템플릿 자체에서 raise_exception으로 강제 실패하는 알려진 상위(LM
// Studio/llama.cpp) 버그가 있습니다. 해결: 실제로 보내기 직전에 모든 system
// 메시지를 하나로 합쳐서, 항상 system 메시지가 정확히 1개(또는 0개)만 전송되도록
// 합니다. 순서는 유지한 채 빈 줄로 이어붙입니다.
function mergeSystemMessages(messages: OpenAiMessage[]): OpenAiMessage[] {
  const systemMsgs = messages.filter((m) => m.role === 'system' && m.content.trim());
  const rest = messages.filter((m) => m.role !== 'system');
  if (systemMsgs.length <= 1) return [...systemMsgs, ...rest];
  const merged: OpenAiMessage = { role: 'system', content: systemMsgs.map((m) => m.content).join('\n\n') };
  return [merged, ...rest];
}

/**
 * 2026-07-28 추가: "몇 자 안 써도" 답변이 통째로 비어버리는 문제 + 응답 속도 문제의 근본
 * 원인은 이 프로젝트 기본 모델(Qwen3 계열, agent.md 참고)이 매 답변마다 먼저 "생각
 * (thinking/reasoning)" 블록을 만들고 나서야 실제 답변을 내놓기 때문입니다. 사용자 메시지가
 * 짧다고 해서 생각 단계가 짧아지는 게 아니라서, 인사 한마디에도 수백~수천 토큰을 생각에
 * 쓰고 나면 max_tokens가 금방 바닥나 실제 답변이 한 글자도 안 나오는 경우가 흔합니다.
 *
 * Qwen3는 사용자 턴 끝에 "/no_think"를 붙이면 그 턴에서는 생각 단계를 건너뛰도록 공식적으로
 * 지원합니다. "빠른모드"/"보통모드"에서는 속도와 안정성을 위해 기본으로 생각을 끄고,
 * "전문가모드"에서만(더 자세한 결과를 원한다는 뜻이므로) 생각을 그대로 허용합니다.
 */
function applyThinkingDirective(messages: OpenAiMessage[], mode: LlmSettings['mode']): OpenAiMessage[] {
  if (mode === 'expert') return messages; // 전문가모드: 모델 기본 동작(생각 허용) 그대로 둠
  const directive = '/no_think';
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return messages;
  const target = messages[lastUserIdx];
  if (target.content.includes('/no_think') || target.content.includes('/think')) return messages;
  const updated = [...messages];
  updated[lastUserIdx] = { ...target, content: `${target.content}\n${directive}` };
  return updated;
}

/** 실제로 요청을 보내기 전 항상 거치는 마지막 단계: 히스토리를 자르고, system 메시지를 하나로
 *  합친 뒤, 모드에 따라 생각(thinking) 여부를 지시합니다. */
function prepareMessagesForRequest(messages: OpenAiMessage[], mode: LlmSettings['mode']): OpenAiMessage[] {
  return applyThinkingDirective(mergeSystemMessages(trimHistoryForPrompt(messages)), mode);
}

/** 실제 fetch + SSE 파싱 한 번을 수행합니다 (streamChat의 재시도 로직에서 사용). */
async function attemptStreamChat(
  messagesReq: OpenAiMessage[],
  opts: LlmSettings & { temperature?: number; onToken?: (chunk: string) => void; signal?: AbortSignal },
  maxTokens: number
): Promise<{ full: string; reasoningChars: number; sawLengthFinish: boolean }> {
  const res = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: opts.baseUrl,
      model: opts.model,
      messages: messagesReq,
      temperature: scaleTemperatureForMode(opts.temperature ?? 0.7, opts.mode),
      max_tokens: maxTokens,
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
  let reasoningChars = 0;
  let sawLengthFinish = false;

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
        const choice = json?.choices?.[0];
        const delta: string | undefined = choice?.delta?.content ?? choice?.message?.content;
        if (delta) {
          full += delta;
          opts.onToken?.(delta);
        }
        // 일부 추론(reasoning) 모델은 최종 답변과 별개로 "생각" 내용을 delta.reasoning_content
        // (또는 reasoning)로 스트리밍합니다. 이것만 오고 content가 끝까지 안 오는 경우를
        // 감지하기 위해 길이만 세어둡니다(내용 자체는 사용하지 않음).
        const reasoning: string | undefined = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
        if (reasoning) reasoningChars += reasoning.length;
        if (choice?.finish_reason === 'length') sawLengthFinish = true;
      } catch {
        // 일부 서버는 청크 하나에 여러 JSON을 붙여 보내기도 하므로, 파싱 실패는 조용히 무시합니다.
      }
    }
  }

  return { full, reasoningChars, sawLengthFinish };
}

/** 스트리밍 채팅 완료 요청. onToken이 토큰(부분 텍스트)마다 호출되고, 최종 전체 텍스트를 반환합니다. */
export async function streamChat(
  messages: OpenAiMessage[],
  opts: LlmSettings & { temperature?: number; maxTokens?: number; onToken?: (chunk: string) => void; signal?: AbortSignal }
): Promise<string> {
  const messagesReq = prepareMessagesForRequest(messages, opts.mode);
  // 2026-07-27: 700 → 1100. 추론(reasoning) 계열 모델은 "생각" 단계에서 토큰을 상당히
  // 소모하고 나서 최종 답변을 내놓기 때문에, 상한이 너무 낮으면 최종 답변을 한 글자도
  // 못 내놓고 잘려서 빈 응답처럼 보이는 경우가 있었습니다. 여유를 더 둡니다.
  const baseMaxTokens = scaleTokensForMode(opts.maxTokens ?? 1100, opts.mode);
  const first = await attemptStreamChat(messagesReq, opts, baseMaxTokens);

  // 2026-07-28 추가: "/no_think"를 지시했는데도(또는 전문가모드라) 모델이 계속 생각만 하다가
  // 예산을 다 써버려 답변을 한 글자도 못 내놓은 경우, 사용자에게 바로 오류를 보여주는 대신
  // 훨씬 넉넉한 예산으로 한 번 더 자동으로 시도합니다. (짧은 한마디 채팅도 실패하던 문제의
  // 핵심 원인 — 생각 단계 길이는 사용자 입력 길이와 무관하기 때문입니다.)
  if (!first.full.trim() && (first.sawLengthFinish || first.reasoningChars > 0)) {
    const retryMaxTokens = Math.min(8000, Math.max(baseMaxTokens * 3, 3000));
    const retry = await attemptStreamChat(messagesReq, opts, retryMaxTokens);
    if (retry.full.trim()) return retry.full;
    // 재시도도 실패하면 원래 안내 메시지를 보여줍니다.
    throw new Error(
      'LM Studio 모델이 "생각(reasoning)" 단계에서 토큰을 모두 써버려 최종 답변을 출력하지 못했습니다. 설정에서 "전문가 모드"로 바꾸면 토큰 여유가 늘어납니다. 계속 반복되면 추론 전용 모델 대신 일반 채팅 모델을 사용하는 것을 권장합니다.'
    );
  }

  // 2026-07-27 버그 수정: "(빈 응답을 받았습니다)"만 뜨고 원인을 알 수 없던 문제.
  if (!first.full.trim()) {
    throw new Error('LM Studio로부터 빈 응답을 받았습니다. LM Studio에서 모델이 정상적으로 로드되어 있는지 확인하고 다시 시도해주세요.');
  }
  return first.full;
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
      messages: prepareMessagesForRequest(messages, opts.mode),
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
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string') throw new Error('LM Studio 응답 형식이 올바르지 않습니다.');
  // 2026-07-27: 스트리밍과 동일하게, 추론 모델이 토큰을 다 써버려 content가 빈 문자열인
  // 경우를 구분해서 알려줍니다 (streamChat과 동일한 원인/해결책).
  if (!content.trim()) {
    const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
    if (choice?.finish_reason === 'length' || (typeof reasoning === 'string' && reasoning.trim())) {
      throw new Error(
        'LM Studio 모델이 "생각(reasoning)" 단계에서 토큰을 모두 써버려 최종 답변을 출력하지 못했습니다. 설정에서 "전문가 모드"로 바꾸면 토큰 여유가 늘어납니다. 계속 반복되면 추론 전용 모델 대신 일반 채팅 모델을 사용하는 것을 권장합니다.'
      );
    }
    throw new Error('LM Studio로부터 빈 응답을 받았습니다. LM Studio에서 모델이 정상적으로 로드되어 있는지 확인하고 다시 시도해주세요.');
  }
  return content;
}

function describeLlmError(status: number, rawText: string): string {
  if (status === 504) {
    return 'LM Studio가 응답을 시작하지 않아 시간이 초과되었습니다. LM Studio 앱이 켜져 있고 모델이 로드되어 있는지 확인해주세요.';
  }
  // 2026-07-27: "Unable to generate parser for this temp..." / chat template(Jinja) 관련 400
  // 오류는 대부분 system 메시지가 2개 이상 전송될 때 발생하는 특정 모델의 알려진 문제입니다.
  // 이 앱은 이제 항상 system 메시지를 1개로 합쳐 보내지만(mergeSystemMessages), 그래도 이
  // 오류가 남아있다면 모델의 채팅 템플릿 자체가 깨져 있는 경우이므로, 원인과 다음 행동을
  // 구체적으로 안내합니다.
  const lower = rawText.toLowerCase();
  if (
    status === 400 &&
    (lower.includes('unable to generate parser') || lower.includes('chat template') || lower.includes('jinja') || lower.includes('raise_exception'))
  ) {
    return 'LM Studio가 대화 형식(채팅 템플릿) 처리 중 오류를 반환했습니다. 이 앱은 system 메시지를 항상 1개로 합쳐 보내도록 수정했지만, 그래도 이 오류가 계속되면 현재 로드된 모델의 채팅 템플릿 자체에 문제가 있을 가능성이 큽니다. LM Studio에서 모델을 완전히 내렸다가 다시 로드하거나, 다른 모델(또는 다른 양자화 버전)을 사용해보세요.';
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

/**
 * 2026-07-28: 연결된 블로그 글들에서 태그/카테고리/장소를 모아 "핵심 키워드" 요약을
 * 만듭니다. LLM이 스토리보드 장면의 tags·narration을 지을 때 이 키워드들을 실제로
 * 참고하도록 프롬프트 맨 앞에 눈에 띄게 배치하기 위한 용도입니다(개별 글 목록만
 * 나열했을 때보다 "이 영상 전체를 관통하는 키워드가 무엇인지" LLM이 더 잘 인식합니다).
 */
function collectBlogKeywords(posts: BlogPost[], media: BlogMediaMeta[]): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  const push = (raw?: string | null) => {
    const v = (raw ?? '').trim();
    if (!v) return;
    const key = v.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    keywords.push(v);
  };
  for (const post of posts) {
    push(post.category);
    push(post.location);
    for (const t of post.tags ?? []) push(t);
  }
  for (const m of media) {
    push(m.location);
  }
  return keywords;
}

export function buildBlogContextText(
  posts: BlogPost[],
  media: BlogMediaMeta[],
  authorLabels?: Record<string, string>
): string {
  if (posts.length === 0) return '';
  const lines: string[] = ['[연결된 블로그 데이터]'];

  const keywords = collectBlogKeywords(posts, media);
  if (keywords.length > 0) {
    lines.push(`핵심 키워드(장소/카테고리/태그): ${keywords.slice(0, 20).join(', ')}`);
    lines.push('→ 아래 장면들의 tags·narration을 지을 때 위 키워드를 최대한 실제로 반영하세요(관련 없는 키워드를 억지로 넣지는 마세요).');
  }

  for (const post of posts) {
    const tagText = (post.tags ?? []).length > 0 ? ` / 태그: ${(post.tags ?? []).join(', ')}` : '';
    const categoryText = post.category ? ` / 카테고리: ${post.category}` : '';
    lines.push(
      `- 글 id=${post.id} / 제목: "${post.title}" / 작성자: ${resolveAuthorLabel(post.author, authorLabels)} / 날짜: ${post.createdAt.slice(0, 10)}${post.location ? ` / 장소: ${post.location}` : ''}${categoryText}${tagText}`
    );
    const text = stripHtml(post.content).slice(0, 400);
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

const STORYBOARD_JSON_INSTRUCTION = `지금까지의 대화 내용과(있다면) [연결된 블로그 데이터]를 "함께" 결합해서 하나의 완성도 높은
영상 스토리보드를 만들어주세요. 두 정보의 역할이 다릅니다:
- 대화 내용(채팅 기록): 영상의 컨셉, 분위기/톤, 등장인물, 원하는 장면 흐름·순서 등 "연출 방향"의 근거입니다.
- [연결된 블로그 데이터]: 실제 있었던 사실(글 제목/본문, 장소, 날짜, 사진 캡션, 태그·카테고리) 근거입니다.
채팅에서 정한 컨셉/분위기에 맞게, 블로그 데이터에 있는 실제 사실을 장면마다 최대한 구체적으로 녹여
나레이션을 쓰세요. 채팅만 있고 블로그 데이터가 없다면 채팅 내용만으로, 블로그 데이터만 있고 채팅이
짧다면 블로그 데이터를 중심으로 스토리보드를 구성하세요 — 어느 한쪽 정보도 무시하지 마세요.

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
- 장면 수는 대화에서 다룬 소재의 다양성과 [연결된 블로그 데이터]에 나온 글/사진 개수를 고려해
  4~8개 사이에서 정하세요. 블로그 사진이 여러 장 있다면, 서로 다른 장소/순간을 고르게 다루도록
  장면 수를 넉넉히(가능하면 6개 이상) 잡아 주요 사진들이 최대한 스토리보드에 포함되게 하세요.
- duration은 2~12 사이의 정수(초)로 하세요.
- tags 필드에는 위 "핵심 키워드"나 각 글의 태그·카테고리·장소 중, 그 장면의 실제 내용과 관련 있는
  것을 우선적으로 사용하세요. 관련 키워드가 없으면 장면 내용을 잘 나타내는 다른 짧은 단어를 쓰세요.
- [연결된 블로그 데이터]가 대화에 포함되어 있다면, mediaId는 반드시 거기 나열된 media id 값 중
  하나를 그대로 사용하세요. 목록에 없는 값을 새로 만들지 마세요. 그 데이터가 없거나 어울리는 사진이
  없으면 mediaId는 null로 두세요.
- 같은 mediaId를 여러 장면에서 중복 사용하지 마세요. 사용 가능한 사진 수가 장면 수보다 적어서
  불가피한 경우에만 예외로 허용합니다.
- 장면의 캡션/장소/날짜와 어울리지 않는 mediaId를 억지로 배정하지 마세요 — 차라리 null로 두는
  편이 낫습니다.
- 캡션/설명이 없는 사진의 내용을 추측해서 지어내지 마세요. 제공된 정보(제목, 캡션, 장소, 날짜)만 사용하세요.`;

export interface RawStoryboardScene {
  customTitle?: string;
  narration?: string;
  dialogue?: string;
  duration?: number;
  tags?: string[];
  mediaId?: string | null;
}

// ─── 2026-07-27(2) JSON 파싱 견고화 ────────────────────────────────────────────
//
// 증상: "Expected ',' or '}' after property value in JSON at position 812"
// 같은 오류로 스토리보드 생성이 실패. 원인은 일부 로컬 모델이 JSON 문자열 값
// 안에 이스케이프 없이 실제 줄바꿈을 그대로 넣거나(narration에 개행 문자),
// max_tokens에 걸려 배열이 중간에 잘리는 경우입니다. 아래 세 단계로 최대한
// 복구를 시도한 뒤에만 실패로 처리합니다.

/** 문자열 리터럴 "안"에서만 이스케이프되지 않은 제어문자(개행 등)를 이스케이프합니다. */
function escapeRawControlCharsInStrings(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    if (ch === '\n') { out += '\\n'; continue; }
    if (ch === '\r') { out += '\\r'; continue; }
    if (ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out;
}

/** `, }` / `, ]` 형태의 trailing comma를 제거합니다. */
function stripTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * JSON.parse가 끝까지 실패하면(배열이 토큰 부족으로 중간에 잘렸거나 구조가 깨진 경우),
 * 문자열 밖에서 중괄호 깊이를 직접 추적해 "온전히 닫힌" 객체만 순서대로 건져냅니다.
 * 덕분에 응답이 도중에 잘려도 이미 완성된 앞쪽 장면들은 살아남습니다.
 */
function salvageJsonObjects(arrayText: string): any[] {
  const results: any[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < arrayText.length; i++) {
    const ch = arrayText[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start !== -1) {
        const chunk = arrayText.slice(start, i + 1);
        try {
          results.push(JSON.parse(chunk));
        } catch {
          try {
            results.push(JSON.parse(stripTrailingCommas(chunk)));
          } catch {
            // 이 객체 하나만 포기하고 다음으로 계속 진행합니다.
          }
        }
        start = -1;
      }
    }
  }
  return results;
}

function extractJsonArray(text: string): RawStoryboardScene[] {
  const start = text.indexOf('[');
  if (start === -1) {
    const salvaged = salvageJsonObjects(text);
    if (salvaged.length > 0) return salvaged;
    throw new Error('LLM 응답에서 JSON 배열을 찾지 못했습니다.');
  }
  const end = text.lastIndexOf(']');
  const jsonSlice = end !== -1 && end > start ? text.slice(start, end + 1) : text.slice(start);

  try {
    const parsed = JSON.parse(jsonSlice);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* 아래 복구 단계로 진행 */
  }

  const cleaned = stripTrailingCommas(escapeRawControlCharsInStrings(jsonSlice));
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* 아래 복구 단계로 진행 */
  }

  const salvaged = salvageJsonObjects(cleaned);
  if (salvaged.length > 0) return salvaged;

  throw new Error('LLM 응답이 올바른 JSON 배열 형식이 아닙니다.');
}

/**
 * 스토리보드 생성 공통 재시도 로직 — "용량(토큰)이 부족해서 실패"하거나 JSON이
 * 깨진 경우에도 사용자에게는 항상 결과를 돌려주기 위한 안전판입니다.
 *  1차: 원래 입력 그대로 정상 호출 (대부분 여기서 성공 — 정상 경로는 이전과 동일한
 *       속도이며 추가 호출이 전혀 없습니다).
 *  2차(1차 실패 시에만): 입력 텍스트를 압축(캡션/본문을 더 짧게 자름)하고, 토큰
 *       예산을 전문가 모드 수준으로 늘려서 재시도합니다.
 *  3차(2차도 실패 시): 절대 예외를 던지지 않는 로컬 폴백으로 마무리해 "무조건 성공"을 보장합니다.
 */
async function generateJsonWithGuaranteedFallback(opts: {
  settings: LlmSettings;
  temperature: number;
  buildMessages: (compressed: boolean) => OpenAiMessage[];
  baseMaxTokens: number;
  fallback: () => RawStoryboardScene[];
}): Promise<RawStoryboardScene[]> {
  const { settings, temperature, buildMessages, baseMaxTokens, fallback } = opts;
  try {
    const text = await chatOnce(buildMessages(false), { ...settings, temperature, maxTokens: baseMaxTokens });
    return extractJsonArray(text);
  } catch {
    try {
      const text2 = await chatOnce(buildMessages(true), {
        ...settings,
        mode: 'expert',
        temperature: Math.max(0.2, temperature - 0.15),
        maxTokens: Math.round(baseMaxTokens * 1.8),
      });
      return extractJsonArray(text2);
    } catch {
      return fallback();
    }
  }
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

  // 2026-07-27(2): 실패(토큰 소진/JSON 깨짐) 시에도 항상 결과를 돌려주기 위해,
  // 압축된 버전(블로그 본문 요약을 더 짧게, 대화 기록을 더 적게, 장면 수를 더 적게
  // 요청 + "각 문자열은 줄바꿈 없이 한 줄로" 지침 추가)의 메시지도 함께 준비해둡니다.
  const buildMessages = (compressed: boolean): OpenAiMessage[] => {
    const messages: OpenAiMessage[] = [{ role: 'system', content: CHAT_SYSTEM_PROMPT }];
    const blogContext = buildBlogContextText(
      compressed ? blogPosts.slice(0, 6) : blogPosts,
      blogMedia,
      blogAuthorLabels
    );
    if (blogContext) messages.push({ role: 'system', content: blogContext });

    const historySlice = compressed ? chatHistory.slice(-8) : chatHistory;
    for (const m of historySlice) {
      messages.push({ role: m.role, content: compressed ? m.text.slice(0, 400) : m.text });
    }
    messages.push({
      role: 'user',
      content: compressed
        ? `${STORYBOARD_JSON_INSTRUCTION}\n\n(중요: 응답 용량이 부족했으니 장면은 3~5개로 줄이고, 각 문자열 값 안에는 절대 줄바꿈을 넣지 말고 한 줄로만 작성하세요.)`
        : STORYBOARD_JSON_INSTRUCTION,
    });
    return messages;
  };

  const validMediaIds = new Set(blogMedia.map((m) => m.id));

  // 3차 폴백(절대 실패하지 않음): 대화의 사용자 메시지들을 그대로 장면으로 변환합니다.
  const fallback = (): RawStoryboardScene[] => {
    const userMsgs = chatHistory.filter((m) => m.role === 'user').slice(-6);
    const base = userMsgs.length > 0 ? userMsgs : [{ text: '새로운 영상 스토리보드' } as ChatMessage];
    return base.map((m, i) => ({
      customTitle: `장면 ${i + 1}`,
      narration: m.text.slice(0, 200) || `장면 ${i + 1}`,
      dialogue: '',
      duration: 5,
      tags: [],
      mediaId: null,
    }));
  };

  const raw = await generateJsonWithGuaranteedFallback({
    settings,
    temperature: 0.4,
    buildMessages,
    baseMaxTokens: estimateStoryboardMaxTokens(8),
    fallback,
  });

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

  // 압축 버전: 캡션/장소 텍스트를 더 짧게 잘라 프롬프트 용량을 줄입니다.
  const compressItem = (item: MediaDescriptor): MediaDescriptor => ({
    ...item,
    caption: item.caption ? item.caption.slice(0, 40) : item.caption,
  });

  const buildMessages = (compressed: boolean): OpenAiMessage[] => [
    { role: 'system', content: MEDIA_STORYBOARD_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        buildMediaStoryboardInstruction(compressed ? items.map(compressItem) : items) +
        (compressed ? '\n\n(중요: 각 문자열 값 안에는 절대 줄바꿈을 넣지 말고 한 줄로만 작성하세요.)' : ''),
    },
  ];

  // 3차 폴백(절대 실패하지 않음): item.map 아래에서 항상 기본값을 채우므로, 여기서는
  // 빈 배열만 돌려줘도 안전합니다 — 즉 최종 매핑이 자연스러운 폴백 역할을 합니다.
  const raw = await generateJsonWithGuaranteedFallback({
    settings,
    temperature: 0.5,
    buildMessages,
    baseMaxTokens: estimateStoryboardMaxTokens(items.length),
    fallback: () => [],
  });

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

  const compressItem = (item: PostTextDescriptor): PostTextDescriptor => ({
    ...item,
    content: item.content.slice(0, 250),
  });

  const buildMessages = (compressed: boolean): OpenAiMessage[] => [
    { role: 'system', content: TEXT_STORYBOARD_SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        buildTextStoryboardInstruction(compressed ? items.map(compressItem) : items) +
        (compressed ? '\n\n(중요: 각 문자열 값 안에는 절대 줄바꿈을 넣지 말고 한 줄로만 작성하세요.)' : ''),
    },
  ];

  // 3차 폴백은 아래 최종 매핑에서 본문 요약으로 자연스럽게 처리되므로 빈 배열이면 충분합니다.
  const raw = await generateJsonWithGuaranteedFallback({
    settings,
    temperature: 0.6,
    buildMessages,
    baseMaxTokens: estimateStoryboardMaxTokens(items.length),
    fallback: () => [],
  });

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
