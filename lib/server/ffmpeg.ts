// 서버(Node.js) 전용 모듈입니다. 클라이언트 컴포넌트에서 절대 import하지 마세요
// (child_process/fs를 사용하므로 브라우저 번들에 포함되면 빌드가 깨집니다).
//
// 이 프로젝트는 실제 로컬 FFmpeg 바이너리를 spawn해서 영상을 만듭니다 (ffmpeg.wasm 등
// 브라우저 내장 방식이 아닙니다). 사용자 컴퓨터에 FFmpeg이 설치되어 PATH에 있거나,
// 설정 화면에서 FFmpeg 실행 파일 경로를 직접 지정해야 합니다.

import { spawn } from 'node:child_process';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** cwd를 지정해 상대 경로로 ffmpeg을 실행합니다 (Windows 드라이브 문자 콜론 이스케이프 문제를 피하기 위함). */
export function runFfmpeg(ffmpegPath: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(ffmpegPath, args, { cwd });
    } catch (err) {
      reject(err);
      return;
    }
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export async function checkFfmpeg(ffmpegPath: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const res = await runFfmpeg(ffmpegPath, ['-version'], process.cwd());
    if (res.code !== 0) return { ok: false, error: res.stderr.slice(0, 300) || 'ffmpeg -version 실행 실패' };
    const firstLine = res.stdout.split('\n')[0] ?? '';
    return { ok: true, version: firstLine.trim() };
  } catch (err: any) {
    return {
      ok: false,
      error:
        err?.code === 'ENOENT'
          ? `"${ffmpegPath}" 실행 파일을 찾을 수 없습니다. FFmpeg이 설치되어 있는지, 경로가 올바른지 확인해주세요.`
          : err?.message ?? String(err),
    };
  }
}

/** 표준 정규화 필터: 서로 다른 해상도의 사진/영상을 같은 캔버스 크기로 맞춥니다. */
export function normalizeVideoFilter(width: number, height: number, fps: number): string {
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p`;
}
