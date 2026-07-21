// LM Studio(OpenAI 호환 로컬 서버)의 /chat/completions 엔드포인트를 그대로 프록시합니다.
// 브라우저 → localhost:1234 직접 호출은 LM Studio 설정에 따라 CORS로 막힐 수 있어,
// 이 Next.js 서버(같은 컴퓨터에서 실행 중)를 경유해 서버-투-서버로 요청합니다.
//
// 이 프로젝트는 오직 LM Studio + 사용자가 설정한 모델 하나만 사용합니다. 다른 원격 AI API를
// 호출하지 않습니다.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:1234/v1';
  return trimmed;
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: '요청 본문이 올바른 JSON이 아닙니다.' }), { status: 400 });
  }

  const { baseUrl, model, messages, temperature, stream } = body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages가 비어 있습니다.' }), { status: 400 });
  }

  const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || undefined,
        messages,
        temperature: typeof temperature === 'number' ? temperature : 0.7,
        stream: Boolean(stream),
      }),
      // LM Studio는 로컬 서버라 응답이 느릴 수 있어 별도 timeout을 걸지 않습니다.
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: `LM Studio 서버(${normalizeBaseUrl(baseUrl)})에 연결할 수 없습니다. LM Studio가 실행 중이고 "Local Server"가 켜져 있는지 확인해주세요.`,
        detail: err?.message,
      }),
      { status: 502 }
    );
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
