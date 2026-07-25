import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 로컬 이미지가 아직 (미디어 폴더 미연결 등으로) 로드되지 않았거나, 애초에 사진/영상이
 * 없는 장면(예: 텍스트만으로 만든 스토리보드 장면)일 때 보여줄 자리표시자입니다.
 * 2026-07-25: 글자 위주의 회색 박스 대신, 어디서든 일관되게 알아볼 수 있는 "이미지 없음"
 * 아이콘(사진 프레임 + 사선) 기반 UI로 바꿨습니다.
 */
export const LOCAL_MEDIA_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">' +
      '<rect width="100%" height="100%" fill="#e9e9ec"/>' +
      '<g transform="translate(240,118)" stroke="#a3a3ad" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="-42" y="-32" width="84" height="64" rx="10"/>' +
        '<circle cx="-16" cy="-12" r="7" fill="#a3a3ad" stroke="none"/>' +
        '<path d="M -30 20 L -6 -2 L 10 12 L 24 0 L 42 20" />' +
        '<line x1="-54" y1="-46" x2="54" y2="46" stroke="#ef4444" stroke-width="7"/>' +
      '</g>' +
      '<text x="50%" y="178" font-family="sans-serif" font-size="14" fill="#9a9aa2" text-anchor="middle">이미지 없음</text>' +
      '</svg>'
  );

/** 씬의 photoRef가 비어있으면(재연결 전 상태이거나, 애초에 사진/영상이 없는 텍스트 장면) 아이콘 기반 자리표시자 이미지를 반환합니다. */
export function getSceneImageSrc(photoRef?: string | null): string {
  return photoRef && photoRef.trim() ? photoRef : LOCAL_MEDIA_PLACEHOLDER;
}

/**
 * 내보내기 화면비율(가로 16:9 / 세로 9:16)과 화질(720p/1080p)을 실제 픽셀 해상도로 변환합니다.
 * 세로 비율은 숏폼(쇼츠/릴스/틱톡) 내보내기를 위한 것으로, 가로/세로 값만 서로 바뀝니다.
 */
export function getExportResolution(aspect: '16:9' | '9:16', quality: '720' | '1080'): { width: number; height: number } {
  const landscape = quality === '1080' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  return aspect === '9:16' ? { width: landscape.height, height: landscape.width } : landscape;
}

/** ISO 날짜 문자열을 "YYYY-MM-DD HH:mm" 형식으로 짧게 표시합니다. */
export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}`;
  } catch {
    return iso;
  }
}
