import { resolveFfmpegPath } from '@/lib/server/ffmpeg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 2026-07-25: 설정 화면에서 사용자가 직접 FFmpeg 경로를 지정하는 UI를 없앴습니다.
// 항상 프로젝트에 동봉된 FFmpeg → 환경변수 → PATH → OS별 흔한 설치 위치 순서로
// 자동 탐색만 수행합니다.
export async function GET() {
  const auto = await resolveFfmpegPath();
  if (!auto) {
    return Response.json({
      ok: false,
      error: 'FFmpeg을 찾을 수 없습니다. 프로젝트에 동봉된 ffmpeg 실행 파일이 없거나 실행할 수 없는 상태입니다.',
    });
  }
  return Response.json({ ok: true, version: auto.version, path: auto.path, source: auto.source });
}
