// LM Studio 로컬 서버가 켜져 있는지, 어떤 모델이 로드되어 있는지 확인합니다.
// GET /api/llm/health?baseUrl=http://localhost:1234/v1

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeBaseUrl(baseUrl: string | null): string {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:1234/v1';
  return trimmed;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const baseUrl = normalizeBaseUrl(searchParams.get('baseUrl'));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    // 2026-07-27(4) 버그 수정: "LM Studio가 꺼져 있는데 연결 확인을 누르면 연결 성공이라고
    // 나온다"는 문제의 원인 — 이 fetch에 캐시 옵션을 지정하지 않으면 Next.js의 Route Handler가
    // 이전에 성공했던 응답을 데이터 캐시에서 그대로 재사용할 수 있습니다(라우트 자체는
    // dynamic = 'force-dynamic'이어도, 내부 fetch 하나하나는 별도로 no-store를 지정해야
    // 확실히 매번 새로 요청합니다). 절대 캐시되지 않도록 명시적으로 no-store를 지정합니다.
    const res = await fetch(`${baseUrl}/models`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);
    if (!res.ok) {
      return Response.json({ ok: false, models: [], error: `LM Studio 응답 오류 (${res.status})` }, { status: 200 });
    }
    const data = await res.json();
    // 2026-07-27(4): 응답이 200이어도 실제로는 LM Studio가 아닌 다른 서버(또는 프록시)가
    // 우연히 그 포트에 응답한 것일 수 있으므로, "OpenAI 호환 모델 목록" 형태(data.data가
    // 배열)인지 최소한으로 검증합니다. 이 형태가 아니면 연결 실패로 취급합니다.
    if (!Array.isArray(data?.data)) {
      return Response.json(
        { ok: false, models: [], error: 'LM Studio(OpenAI 호환 서버) 응답 형식이 아닙니다. 서버 주소를 확인해주세요.' },
        { status: 200 }
      );
    }
    const models: string[] = data.data.map((m: any) => m.id).filter(Boolean);
    return Response.json({ ok: true, models });
  } catch (err: any) {
    clearTimeout(timeout);
    const timedOut = err?.name === 'AbortError';
    return Response.json(
      {
        ok: false,
        models: [],
        error: timedOut
          ? 'LM Studio 응답 시간이 초과되었습니다.'
          : `LM Studio(${baseUrl})에 연결할 수 없습니다. LM Studio의 "Local Server"가 켜져 있는지 확인해주세요.`,
      },
      { status: 200 }
    );
  }
}
