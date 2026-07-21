import { checkFfmpeg } from '@/lib/server/ffmpeg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ffmpegPath = searchParams.get('ffmpegPath')?.trim() || 'ffmpeg';
  const result = await checkFfmpeg(ffmpegPath);
  return Response.json(result);
}
