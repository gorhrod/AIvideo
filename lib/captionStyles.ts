// 자막(SRT) 번인(burn-in) 스타일 프리셋입니다.
// AIvideoprojectdocs의 captionStylePresets.ts 아이디어를 참고해, 이 프로젝트의
// force_style(libass ASS 스타일 오버라이드) 문자열 배열 형태로 단순화했습니다.
// 클라이언트(ExportModal 미리보기/선택 UI)와 서버(app/api/export/video/route.ts의
// 실제 FFmpeg force_style 적용) 양쪽에서 이 파일을 그대로 import해서 사용합니다.

export interface CaptionStylePreset {
  id: string;
  label: string;
  description: string;
  /** 미리보기용 CSS (실제 FFmpeg 결과와 완전히 동일하지는 않지만 느낌을 보여줍니다) */
  previewClassName: string;
  /** ffmpeg subtitles 필터의 force_style에 그대로 들어가는 "Key=Value" 항목들 */
  assStyle: string[];
}

export const CAPTION_STYLE_PRESETS: CaptionStylePreset[] = [
  {
    id: 'default',
    label: '기본 (화이트 + 아웃라인)',
    description: '깔끔한 흰 글자에 검은 아웃라인 — 대부분의 영상에 무난하게 어울립니다.',
    previewClassName: 'text-white [text-shadow:1px_1px_0_#000,-1px_-1px_0_#000,1px_-1px_0_#000,-1px_1px_0_#000]',
    assStyle: ['FontSize=26', 'PrimaryColour=&HFFFFFF&', 'OutlineColour=&H000000&', 'BorderStyle=1', 'Outline=2', 'Shadow=0', 'Bold=0', 'Alignment=2', 'MarginV=48'],
  },
  {
    id: 'bold-white',
    label: '굵은 화이트',
    description: '더 크고 두꺼운 흰 글씨 — 짧은 영상(쇼츠/릴스)에서 눈에 잘 띕니다.',
    previewClassName: 'text-white font-extrabold [text-shadow:1.5px_1.5px_0_#000,-1.5px_-1.5px_0_#000,1.5px_-1.5px_0_#000,-1.5px_1.5px_0_#000]',
    assStyle: ['FontSize=32', 'PrimaryColour=&HFFFFFF&', 'OutlineColour=&H000000&', 'BorderStyle=1', 'Outline=3', 'Shadow=0', 'Bold=1', 'Alignment=2', 'MarginV=54'],
  },
  {
    id: 'yellow-pop',
    label: '옐로우 강조',
    description: '노란 글자로 나레이션을 강조 — 예능/브이로그 느낌의 자막에 어울립니다.',
    previewClassName: 'text-yellow-300 font-bold [text-shadow:1.5px_1.5px_0_#000,-1.5px_-1.5px_0_#000,1.5px_-1.5px_0_#000,-1.5px_1.5px_0_#000]',
    assStyle: ['FontSize=30', 'PrimaryColour=&H00FFFF&', 'OutlineColour=&H000000&', 'BorderStyle=1', 'Outline=3', 'Shadow=0', 'Bold=1', 'Alignment=2', 'MarginV=50'],
  },
  {
    id: 'black-box',
    label: '블랙 박스',
    description: '반투명 검은 배경 박스 위에 흰 글자 — 배경이 밝고 복잡한 영상에서 가독성이 좋습니다.',
    previewClassName: 'text-white bg-black/70 px-1.5 py-0.5 rounded',
    assStyle: ['FontSize=26', 'PrimaryColour=&HFFFFFF&', 'BackColour=&H80000000&', 'BorderStyle=3', 'Outline=0', 'Shadow=0', 'Bold=0', 'Alignment=2', 'MarginV=40'],
  },
];

export const DEFAULT_CAPTION_STYLE_ID = 'default';

export function getCaptionStylePreset(id: string | undefined): CaptionStylePreset {
  return CAPTION_STYLE_PRESETS.find((p) => p.id === id) ?? CAPTION_STYLE_PRESETS.find((p) => p.id === DEFAULT_CAPTION_STYLE_ID)!;
}
