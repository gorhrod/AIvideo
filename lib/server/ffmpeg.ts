// 서버(Node.js) 전용 모듈입니다. 클라이언트 컴포넌트에서 절대 import하지 마세요
// (child_process/fs를 사용하므로 브라우저 번들에 포함되면 빌드가 깨집니다).
//
// 이 프로젝트는 실제 로컬 FFmpeg 바이너리를 spawn해서 영상을 만듭니다 (ffmpeg.wasm 등
// 브라우저 내장 방식이 아닙니다). 사용자 컴퓨터에 FFmpeg이 설치되어 PATH에 있거나,
// 설정 화면에서 FFmpeg 실행 파일 경로를 직접 지정해야 합니다.

import { spawn } from 'node:child_process';
import path from 'node:path';

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

// ─── FFmpeg 자동 탐지 (2026-07-23 추가) ──────────────────────────────────────
//
// 예전에는 사용자가 설정 화면에서 FFmpeg 경로를 지정하지 않으면 무조건 PATH의
// "ffmpeg"만 시도했습니다. 실제로는 FFmpeg이 설치돼 있어도 앱을 실행한 셸의 PATH에
// 잡히지 않는 경우(특히 macOS Homebrew, Windows 수동 설치)가 흔합니다.
// 아래 resolveFfmpegPath는 여러 후보 경로를 순서대로 시도해 "실제로 실행되는" 첫
// 번째 경로를 찾아줍니다 — AIvideoprojectdocs의 바이너리 자동탐지 방식과 같은
// 아이디어를, 특정 바이너리를 번들하지 않고 후보 경로 탐색만으로 구현한 버전입니다.

export interface ResolvedFfmpeg {
  path: string;
  source: string;
  version: string;
}

function candidateFfmpegPaths(): { path: string; source: string }[] {
  const list: { path: string; source: string }[] = [];
  if (process.env.FFMPEG_PATH) list.push({ path: process.env.FFMPEG_PATH, source: '환경변수 FFMPEG_PATH' });

  // 2026-07-25: 설정 화면의 "FFmpeg 경로 직접 지정" UI를 없애고, 프로젝트에 동봉된 FFmpeg
  // 바이너리(<프로젝트 루트>/ffmpeg/bin/ffmpeg.exe)를 항상 최우선으로 사용합니다. 별도 설치나
  // PATH 설정 없이 바로 동작해야 한다는 요구사항 때문입니다. 그래도 다른 OS(비-Windows)나
  // 바이너리가 없는 환경을 위해 PATH/OS별 흔한 설치 위치는 폴백으로 계속 시도합니다.
  list.push({ path: path.join(process.cwd(), 'ffmpeg', 'bin', 'ffmpeg.exe'), source: '프로젝트 동봉 ffmpeg (ffmpeg/bin/ffmpeg.exe)' });
  list.push({ path: path.join(process.cwd(), 'ffmpeg', 'ffmpeg.exe'), source: '프로젝트 동봉 ffmpeg (ffmpeg/ffmpeg.exe)' });

  list.push({ path: 'ffmpeg', source: '시스템 PATH' });

  switch (process.platform) {
    case 'darwin':
      list.push({ path: '/opt/homebrew/bin/ffmpeg', source: 'Homebrew (Apple Silicon)' });
      list.push({ path: '/usr/local/bin/ffmpeg', source: 'Homebrew (Intel)' });
      break;
    case 'linux':
      list.push({ path: '/usr/bin/ffmpeg', source: '시스템 패키지 (apt/dnf 등)' });
      list.push({ path: '/usr/local/bin/ffmpeg', source: '/usr/local/bin' });
      list.push({ path: '/snap/bin/ffmpeg', source: 'Snap' });
      break;
    case 'win32':
      list.push({ path: 'C:\\ffmpeg\\bin\\ffmpeg.exe', source: 'C:\\ffmpeg\\bin' });
      list.push({ path: 'ffmpeg.exe', source: '시스템 PATH (.exe)' });
      break;
  }

  // 중복 경로 제거 (같은 경로를 여러 이유로 두 번 시도하지 않도록)
  const seen = new Set<string>();
  return list.filter((c) => {
    if (seen.has(c.path)) return false;
    seen.add(c.path);
    return true;
  });
}

/**
 * 프로젝트 동봉 바이너리 → 환경변수 → PATH → OS별 일반적인 설치 위치 순서로 실제 실행
 * 가능한 FFmpeg을 찾습니다. 아무 것도 찾지 못하면 null을 반환합니다.
 * (2026-07-25: 사용자가 경로를 직접 지정하는 설정 UI는 제거되었습니다 — 항상 프로젝트에
 *  동봉된 ffmpeg을 우선 사용합니다.)
 *
 * (참고: 예전에는 선택적 npm 패키지 'ffmpeg-static'을 동적 import로 마지막 후보에
 *  추가하려 했으나, package.json에 없는 상태에서도 Next.js/webpack이 빌드 시점에
 *  해당 모듈을 정적으로 분석해 "Module not found" 빌드 오류를 냈습니다. 이제는 실제
 *  ffmpeg 바이너리를 프로젝트에 직접 동봉하는 방식으로 대체했으므로 해당 코드는
 *  제거했습니다.)
 */
export async function resolveFfmpegPath(): Promise<ResolvedFfmpeg | null> {
  const candidates = candidateFfmpegPaths();

  for (const candidate of candidates) {
    const result = await checkFfmpeg(candidate.path);
    if (result.ok) {
      return { path: candidate.path, source: candidate.source, version: result.version ?? '' };
    }
  }
  return null;
}

// ─── 동시 인코딩 풀 (2026-07-23 속도 최적화) ─────────────────────────────────
//
// 예전에는 장면(세그먼트)을 하나씩 순서대로 인코딩했습니다 — 세그먼트가 10개면
// FFmpeg 프로세스를 10번 순차 실행하는 것과 같아, 장면 수에 비례해 그대로 느려졌습니다.
// 대부분의 세그먼트 인코딩은 서로 독립적이므로(각자 다른 임시 파일에 씀), 동시에 여러
// 개를 병렬로 돌리면 멀티코어 CPU를 활용해 전체 내보내기 시간을 크게 줄일 수 있습니다.
// 다만 무제한 병렬 실행은 메모리/CPU를 과도하게 점유할 수 있어, 동시 실행 개수를
// 제한하는 간단한 작업 풀(pool)을 사용합니다.

/**
 * items를 concurrency만큼 동시에 처리합니다. 각 작업의 결과는 입력과 같은 순서로 반환됩니다.
 * 하나라도 실패하면 나머지 진행 중인 작업은 계속 완료되도록 두되(자원 누수 방지),
 * 전체 결과에서 실패를 그대로 드러내 호출자가 어떤 항목이 실패했는지 알 수 있게 합니다.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await task(items[current], current);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
