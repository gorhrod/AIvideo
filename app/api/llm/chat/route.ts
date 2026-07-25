// LM Studio(OpenAI 호환 로컬 서버)의 /chat/completions 엔드포인트를 그대로 프록시합니다.
// 브라우저 → localhost:1234 직접 호출은 LM Studio 설정에 따라 CORS로 막힐 수 있어,
// 이 Next.js 서버(같은 컴퓨터에서 실행 중)를 경유해 서버-투-서버로 요청합니다.
//
// 이 프로젝트는 오직 LM Studio + 사용자가 설정한 모델 하나만 사용합니다. 다른 원격 AI API를
// 호출하지 않습니다.
//
// ─── 2026-07-23 연결 타임아웃 추가 ───────────────────────────────────────────
// LM Studio 앱이 꺼져 있거나 "Local Server"가 시작되지 않은 상태에서 요청을 보내면,
// 예전에는 fetch가 응답 없이 계속 대기해 화면이 무한 로딩처럼 보였습니다.
// 아래에서는 "첫 응답(헤더)을 받기까지"만 타임아웃을 걸어, 서버가 아예 응답하지 않는
// 경우 빠르게 명확한 오류를 반환합니다. 일단 응답이 시작되면(스트리밍 포함) 그 이후
// 생성이 오래 걸리는 것은 정상이므로 추가로 끊지 않습니다.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:1234/v1';
  return trimmed;
}

/**
 * 스트리밍(stream:true) 요청은 SSE 헤더가 생성 시작과 거의 동시에 도착하므로,
 * "서버가 아예 응답하지 않는 경우"만 짧게 감지하면 됩니다.
 * 반면 스트리밍이 아닌 요청(JSON 스토리보드 생성 등)은 LM Studio가 전체 생성이
 * 끝난 뒤에야 응답(헤더+본문)을 한 번에 보내므로, 여기서 너무 짧은 타임아웃을 걸면
 * 정상적으로 느린 로컬 모델의 응답을 "시간 초과"로 잘못 끊어버리게 됩니다.
 * 그래서 요청 종류에 따라 타임아웃 길이를 다르게 둡니다.
 */
const STREAM_CONNECT_TIMEOUT_MS = 20_000;
const NON_STREAM_TIMEOUT_MS = 5 * 60_000; // 로컬 9B 모델이 긴 스토리보드를 생성해도 충분한 여유

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: '요청 본문이 올바른 JSON이 아닙니다.' }), { status: 400 });
  }

  const { baseUrl, model, messages, temperature, stream, max_tokens: maxTokensRaw } = body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages가 비어 있습니다.' }), { status: 400 });
  }

  const maxTokens = typeof maxTokensRaw === 'number' && maxTokensRaw > 0 ? Math.round(maxTokensRaw) : undefined;
  const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

  const CONNECT_TIMEOUT_MS = stream ? STREAM_CONNECT_TIMEOUT_MS : NON_STREAM_TIMEOUT_MS;
  const connectController = new AbortController();
  const connectTimer = setTimeout(() => connectController.abort(), CONNECT_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || undefined,
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        max_tokens: maxTokens,
        stream: Boolean(stream),
      }),
      signal: connectController.signal,
    });
  } catch (err: any) {
    const timedOut = err?.name === 'AbortError';
    return new Response(
      JSON.stringify({
        error: timedOut
          ? `LM Studio 서버(${normalizeBaseUrl(baseUrl)})가 ${CONNECT_TIMEOUT_MS / 1000}초 동안 응답을 시작하지 않았습니다. LM Studio 앱이 실행 중이고 "Local Server"가 켜져 있는지, 모델이 로드되어 있는지 확인해주세요.`
          : `LM Studio 서버(${normalizeBaseUrl(baseUrl)})에 연결할 수 없습니다. LM Studio가 실행 중이고 "Local Server"가 켜져 있는지 확인해주세요.`,
        detail: err?.message,
      }),
      { status: timedOut ? 504 : 502 }
    );
  } finally {
    clearTimeout(connectTimer);
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return new Response(
      JSON.stringify({ error: `LM Studio가 오류를 반환했습니다 (${upstream.status})`, detail: text.slice(0, 500) }),
      { status: upstream.status }
    );
  }

  if (stream) {
    // 스트리밍 응답(text/event-stream)을 그대로 클라이언트에 릴레이합니다.
    // 이 시점부터는 타임아웃을 걸지 않습니다 — 긴 스토리보드/나레이션 생성이 중간에 끊기지 않도록 합니다.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
