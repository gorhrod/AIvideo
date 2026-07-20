import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 로컬 이미지가 아직 (미디어 폴더 미연결 등으로) 로드되지 않았을 때 보여줄 자리표시자입니다. */
export const LOCAL_MEDIA_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">' +
      '<rect width="100%" height="100%" fill="#e5e5e5"/>' +
      '<text x="50%" y="50%" font-family="sans-serif" font-size="15" fill="#8a8a8a" text-anchor="middle" dominant-baseline="middle">로컬 이미지 — 미디어 폴더를 연결하면 표시됩니다</text>' +
      '</svg>'
  );

/** 씬의 photoRef가 비어있으면(재연결 전 상태) 자리표시자 이미지를 반환합니다. */
export function getSceneImageSrc(photoRef?: string | null): string {
  return photoRef && photoRef.trim() ? photoRef : LOCAL_MEDIA_PLACEHOLDER;
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
