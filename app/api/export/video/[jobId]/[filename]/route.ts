import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPORT_ROOT = path.join(os.tmpdir(), 'kwjmvideoai-export');
const JOB_ID_RE = /^[a-f0-9-]{36}$/i;
const ALLOWED_FILES: Record<string, { mime: string; ext: string }> = {
  'output.mp4': { mime: 'video/mp4', ext: 'mp4' },
  'output.srt': { mime: 'application/x-subrip; charset=utf-8', ext: 'srt' },
  'output.txt': { mime: 'text/plain; charset=utf-8', ext: 'txt' },
};

export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string; filename: string }> }) {
  const { jobId, filename } = await ctx.params;

  if (!JOB_ID_RE.test(jobId) || !ALLOWED_FILES[filename]) {
    return new Response('Not found', { status: 404 });
  }

  const jobDir = path.join(EXPORT_ROOT, jobId);
  const filePath = path.join(jobDir, filename);
  const { mime, ext } = ALLOWED_FILES[filename];

  try {
    const info = await stat(filePath);

    let downloadName = filename;
    try {
      const meta = JSON.parse(await readFile(path.join(jobDir, 'meta.json'), 'utf-8'));
      const safe = String(meta.projectName || '스토리보드').replace(/[\\/:*?"<>|]/g, '_');
      downloadName = `${safe}.${ext}`;
    } catch {
      // meta.json이 없으면 기본 파일명을 사용합니다.
    }

    const nodeStream = createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(info.size),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(downloadName)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
