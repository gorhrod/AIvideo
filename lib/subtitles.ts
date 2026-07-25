// 씬(Scene) 목록의 duration을 누적해 타임코드를 계산하고, SRT/TXT 두 형식의 자막을 만듭니다.
// - SRT: 영상에 자막을 구울 때(ffmpeg subtitles 필터)도 이 파일을 그대로 사용하고,
//        내보내기에서 별도 .srt 파일로도 다운로드합니다.
// - TXT: 사람이 읽기 편한 순수 텍스트 대본 (타임코드 없이 장면 순서대로).
//
// 한 장면에 나레이션과 대사가 모두 있으면 같은 자막 구간에 두 줄로 표시합니다
// (대사는 따옴표로 구분). 나레이션/대사가 모두 비어있는 장면은 자막을 만들지 않지만
// 영상 길이(duration)에는 그대로 반영됩니다.

export interface SubtitleScene {
  id: string;
  customTitle: string;
  narration: string;
  dialogue: string;
  duration: number;
}

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}
function pad3(n: number): string {
  return String(Math.floor(n)).padStart(3, '0');
}

/** 초(소수 가능) → SRT 타임코드 "HH:MM:SS,mmm" */
export function secondsToSrtTimestamp(totalSeconds: number): string {
  const ms = Math.round(totalSeconds * 1000);
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
}

export interface SceneTiming {
  scene: SubtitleScene;
  start: number;
  end: number;
}

export function computeSceneTimings(scenes: SubtitleScene[]): SceneTiming[] {
  let cursor = 0;
  return scenes.map((scene) => {
    const start = cursor;
    const dur = Math.max(0.1, scene.duration || 0);
    cursor += dur;
    return { scene, start, end: cursor };
  });
}

function subtitleBlockText(scene: SubtitleScene): string {
  const lines: string[] = [];
  if (scene.narration?.trim()) lines.push(scene.narration.trim());
  if (scene.dialogue?.trim()) lines.push(`"${scene.dialogue.trim()}"`);
  return lines.join('\n');
}

/** SRT 자막 문자열을 만듭니다. */
export function buildSrt(scenes: SubtitleScene[]): string {
  const timings = computeSceneTimings(scenes);
  let idx = 1;
  const blocks: string[] = [];
  for (const t of timings) {
    const text = subtitleBlockText(t.scene);
    if (!text) continue;
    blocks.push(
      `${idx}\n${secondsToSrtTimestamp(t.start)} --> ${secondsToSrtTimestamp(t.end)}\n${text}\n`
    );
    idx++;
  }
  return blocks.join('\n');
}

/** 사람이 읽기 편한 순수 텍스트(.txt) 대본을 만듭니다. */
export function buildPlainTextScript(projectName: string, scenes: SubtitleScene[]): string {
  const timings = computeSceneTimings(scenes);
  const header = `${projectName} — 자막/대본 (텍스트)\n생성 시각: ${new Date().toLocaleString('ko-KR')}\n${'='.repeat(
    44
  )}\n\n`;
  const body = timings
    .map((t, i) => {
      const mm = (s: number) => `${pad2(Math.floor(s / 60))}:${pad2(Math.floor(s % 60))}`;
      const lines = [`${i + 1}. [${mm(t.start)} - ${mm(t.end)}] ${t.scene.customTitle}`];
      if (t.scene.narration?.trim()) lines.push(`   나레이션: ${t.scene.narration.trim()}`);
      if (t.scene.dialogue?.trim()) lines.push(`   대사: "${t.scene.dialogue.trim()}"`);
      return lines.join('\n');
    })
    .join('\n\n');
  return header + body + '\n';
}

export function totalDuration(scenes: SubtitleScene[]): number {
  return scenes.reduce((sum, s) => sum + Math.max(0.1, s.duration || 0), 0);
}

// ─── 자막 가독 시간 추정 ──────────────────────────────────────────────────────
//
// AI가 스토리보드를 새로 만들 때, LLM이 제시하는 duration은 종종 나레이션 길이와
// 무관하게 대충 정해집니다(예: 긴 나레이션인데 duration=3). 그러면 자막이 화면에서
// 채 다 읽히기도 전에 다음 장면으로 넘어가버립니다. 이를 방지하기 위해 나레이션+대사
// 글자 수 기준으로 "최소 재생시간"을 추정하고, LLM이 준 duration과 비교해 더 큰 값을
// 사용합니다 (짧게 지정된 것만 늘리고, 사용자가 이미 충분히 길게 잡은 값은 건드리지 않음).

/** 한국어 자막 기준 대략적인 초당 읽기 글자 수 (평균적인 시청 속도 가정). */
const READING_CHARS_PER_SECOND = 6.5;
const MIN_SCENE_SECONDS = 2;
const MAX_AUTO_SCENE_SECONDS = 20;

/** 나레이션+대사 텍스트 길이로부터 자막을 편안히 읽을 수 있는 최소 재생시간(초)을 추정합니다. */
export function estimateReadingDurationSeconds(narration: string, dialogue?: string): number {
  const text = `${narration ?? ''} ${dialogue ?? ''}`.trim();
  if (!text) return MIN_SCENE_SECONDS;
  // 공백을 제외한 글자 수 기준으로 계산 (한글/영문 혼용 대본에서 대략적인 근사치로 충분합니다).
  const charCount = text.replace(/\s+/g, '').length;
  const estimated = charCount / READING_CHARS_PER_SECOND + 0.6; // 시작 여유시간
  return Math.min(MAX_AUTO_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, Math.round(estimated)));
}

/**
 * LLM이 제시한 duration과 자막 읽기 시간 추정치 중 더 큰 값을 사용해, 새로 생성되는
 * 장면의 재생시간을 보정합니다. 이미 충분히 긴 duration은 그대로 두고, 자막이 잘릴 만큼
 * 짧은 경우에만 늘립니다.
 */
export function ensureReadableDuration(duration: number, narration: string, dialogue?: string): number {
  const minReadable = estimateReadingDurationSeconds(narration, dialogue);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : minReadable;
  return Math.min(MAX_AUTO_SCENE_SECONDS, Math.max(safeDuration, minReadable));
}
