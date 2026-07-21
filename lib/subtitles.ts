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
