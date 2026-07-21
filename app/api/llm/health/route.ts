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
    const res = await fetch(`${baseUrl}/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      return Response.json({ ok: false, models: [], error: `LM Studio 응답 오류 (${res.status})` }, { status: 200 });
    }
    const data = await res.json();
    const models: string[] = Array.isArray(data?.data) ? data.data.map((m: any) => m.id).filter(Boolean) : [];
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
