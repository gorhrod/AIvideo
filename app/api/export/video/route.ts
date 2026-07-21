// 스토리보드 장면들을 실제 FFmpeg으로 렌더링해 MP4로 만듭니다.
//
// 흐름:
//  1) 각 장면의 이미지/영상 원본 파일을 받아 요청한 재생시간만큼의 개별 세그먼트(mp4)로 인코딩
//     (이미지: -loop 1, 영상: -stream_loop -1 로 짧으면 반복해서 채우고 길면 잘라냅니다)
//  2) 모든 세그먼트를 같은 코덱/해상도로 만들었기 때문에 concat demuxer로 이어붙입니다
//  3) 클라이언트가 만든 SRT 자막을 libass 기반 subtitles 필터로 영상에 "굽습니다"(burn-in)
//  4) 결과 mp4 + srt + txt 세 파일을 임시 작업 폴더에 저장하고, 다운로드용 jobId를 반환합니다
//     (실제 다운로드는 GET /api/export/video/[jobId]/[filename])
//
// Windows 드라이브 문자(C:\...)의 콜론 이스케이프 문제를 피하기 위해, ffmpeg 실행 시 항상
// cwd를 작업 폴더로 지정하고 파일명은 상대경로(예: "seg_00.mp4")만 사용합니다.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { runFfmpeg, normalizeVideoFilter } from '@/lib/server/ffmpeg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPORT_ROOT = path.join(os.tmpdir(), 'kwjmvideoai-export');
const MAX_SCENES = 80;
const CLEANUP_DELAY_MS = 30 * 60 * 1000; // 30분 뒤 임시 파일 정리

interface ManifestScene {
  fileField: string;
  kind: 'image' | 'video';
  duration: number;
}

interface ExportManifest {
  projectName: string;
  width: number;
  height: number;
  fps: number;
  ffmpegPath?: string;
  subtitleFontName?: string;
  scenes: ManifestScene[];
  srtContent: string;
  txtContent: string;
}

function guessExt(file: File): string {
  const nameExt = path.extname(file.name || '').toLowerCase();
  if (nameExt) return nameExt;
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
  };
  return map[file.type] || (file.type.startsWith('video/') ? '.mp4' : '.jpg');
}

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status });
}

export async function POST(req: Request) {
  let jobDir = '';
  try {
    const formData = await req.formData();
    const manifestRaw = formData.get('manifest');
    if (typeof manifestRaw !== 'string') return jsonError(400, 'manifest 필드가 없습니다.');

    let manifest: ExportManifest;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      return jsonError(400, 'manifest JSON 파싱에 실패했습니다.');
    }

    if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
      return jsonError(400, '내보낼 장면이 없습니다.');
    }
    if (manifest.scenes.length > MAX_SCENES) {
      return jsonError(400, `장면이 너무 많습니다 (최대 ${MAX_SCENES}개).`);
    }

    const width = Number(manifest.width) || 1280;
    const height = Number(manifest.height) || 720;
    const fps = Number(manifest.fps) || 30;
    const ffmpegPath = manifest.ffmpegPath?.trim() || 'ffmpeg';
    const fontName = manifest.subtitleFontName?.trim();

    const jobId = crypto.randomUUID();
    jobDir = path.join(EXPORT_ROOT, jobId);
    await mkdir(jobDir, { recursive: true });

    // 1) 원본 파일 저장 + 씬별 세그먼트 인코딩
    const vf = normalizeVideoFilter(width, height, fps);
    const segmentFiles: string[] = [];

    for (let i = 0; i < manifest.scenes.length; i++) {
      const scene = manifest.scenes[i];
      const file = formData.get(scene.fileField);
      if (!(file instanceof File)) {
        return jsonError(400, `${i + 1}번째 장면의 파일(${scene.fileField})을 받지 못했습니다.`);
      }
      const ext = guessExt(file);
      const rawName = `raw_${String(i).padStart(3, '0')}${ext}`;
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(jobDir, rawName), buf);

      const duration = Math.max(0.5, Number(scene.duration) || 3);
      const segName = `seg_${String(i).padStart(3, '0')}.mp4`;

      const args =
        scene.kind === 'image'
          ? ['-y', '-loop', '1', '-i', rawName, '-t', String(duration), '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', segName]
          : ['-y', '-stream_loop', '-1', '-i', rawName, '-t', String(duration), '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', segName];

      const result = await runFfmpeg(ffmpegPath, args, jobDir);
      if (result.code !== 0) {
        return jsonError(500, `${i + 1}번째 장면을 인코딩하는 중 FFmpeg 오류가 발생했습니다.`, {
          stage: 'segment_encode',
          ffmpegStderr: result.stderr.slice(-3000),
        });
      }
      segmentFiles.push(segName);
    }

    // 2) concat
    const listContent = segmentFiles.map((f) => `file '${f}'`).join('\n') + '\n';
    await writeFile(path.join(jobDir, 'segments.txt'), listContent);
    const concatResult = await runFfmpeg(
      ffmpegPath,
      ['-y', '-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-c', 'copy', 'concat.mp4'],
      jobDir
    );
    if (concatResult.code !== 0) {
      return jsonError(500, '장면을 이어붙이는 중 FFmpeg 오류가 발생했습니다.', {
        stage: 'concat',
        ffmpegStderr: concatResult.stderr.slice(-3000),
      });
    }

    // 3) 자막 굽기 (SRT 내용이 있을 때만)
    const srtContent = manifest.srtContent || '';
    await writeFile(path.join(jobDir, 'subtitles.srt'), srtContent, 'utf-8');

    if (srtContent.trim()) {
      const styleParts = [
        'FontSize=26',
        'PrimaryColour=&HFFFFFF&',
        'OutlineColour=&H000000&',
        'BorderStyle=1',
        'Outline=2',
        'Shadow=0',
        'Alignment=2',
        'MarginV=48',
      ];
      if (fontName) styleParts.unshift(`FontName=${fontName}`);
      const subtitleFilter = `subtitles=subtitles.srt:force_style='${styleParts.join(',')}'`;

      const burnResult = await runFfmpeg(
        ffmpegPath,
        ['-y', '-i', 'concat.mp4', '-vf', subtitleFilter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', 'output.mp4'],
        jobDir
      );
      if (burnResult.code !== 0) {
        return jsonError(500, '자막을 영상에 입히는 중 FFmpeg 오류가 발생했습니다. (FFmpeg이 libass를 지원하는 빌드인지 확인해주세요)', {
          stage: 'subtitle_burn',
          ffmpegStderr: burnResult.stderr.slice(-3000),
        });
      }
    } else {
      // 자막이 아예 없으면 굽기 단계를 건너뛰고 concat 결과를 그대로 사용합니다.
      const { copyFile } = await import('node:fs/promises');
      await copyFile(path.join(jobDir, 'concat.mp4'), path.join(jobDir, 'output.mp4'));
    }

    // 4) srt/txt 결과 파일 저장
    await writeFile(path.join(jobDir, 'output.srt'), srtContent, 'utf-8');
    await writeFile(path.join(jobDir, 'output.txt'), manifest.txtContent || '', 'utf-8');
    await writeFile(
      path.join(jobDir, 'meta.json'),
      JSON.stringify({ projectName: manifest.projectName || '스토리보드', createdAt: new Date().toISOString() }),
      'utf-8'
    );

    // 임시 파일 정리 예약 (베스트 에포트 — 서버 프로세스가 계속 떠 있는 로컬 개발 서버 환경 기준)
    setTimeout(() => {
      rm(jobDir, { recursive: true, force: true }).catch(() => {});
    }, CLEANUP_DELAY_MS);

    return Response.json({
      ok: true,
      jobId,
      files: { mp4: 'output.mp4', srt: 'output.srt', txt: 'output.txt' },
    });
  } catch (err: any) {
    console.error(err);
    if (jobDir) await rm(jobDir, { recursive: true, force: true }).catch(() => {});
    return jsonError(500, err?.message ?? '영상을 만드는 중 알 수 없는 오류가 발생했습니다.');
  }
}
