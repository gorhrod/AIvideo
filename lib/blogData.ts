// 블로그 프로젝트(경우정민 블로그, aiagent.md 스펙)가 생성하는 데이터 폴더를 읽어옵니다.
// posts.json / media-meta.json / categories.json 은 텍스트라서 그대로 파싱하고,
// uploads/YYYY/MM/파일명 은 File System Access API로 실제 파일을 찾아 미리보기를 만듭니다.
//
// 이 모듈은 블로그 앱의 서버(API Route)를 거치지 않습니다 — 사용자가 블로그 데이터 폴더를
// (블로그를 실행하지 않은 상태에서도) 직접 폴더 선택으로 연결하면, 그 폴더 안의 JSON/이미지
// 파일을 브라우저에서 바로 읽습니다. aiagent.md의 "하지 말 것" 원칙을 그대로 따릅니다:
// id/postId 값을 임의로 새로 만들거나 캡션이 없는데 지어내지 않습니다.

import { readJsonFileIfExists, fileHandleToObjectUrl } from '@/lib/fsAccess';

export interface BlogPost {
  id: string;
  title: string;
  content: string;
  author: string;
  createdAt: string;
  updatedAt?: string;
  category?: string;
  tags?: string[];
  location?: string;
}

export interface BlogMediaMeta {
  id: string;
  postId: string;
  url: string;
  type: 'image' | 'video';
  order: number;
  caption: string;
  location: string;
  year: number;
  month: string;
  day: string;
}

export interface BlogCategory {
  id: string;
  name: string;
  color?: string;
}

export interface BlogData {
  posts: BlogPost[];
  media: BlogMediaMeta[];
  categories: BlogCategory[];
  /** media-meta.json이 아예 없던 구버전 데이터 폴더인지 (사진 검색을 못 합니다) */
  hasMediaMeta: boolean;
}

/** 블로그 데이터 폴더(연결된 dirHandle)에서 posts.json / media-meta.json / categories.json을 읽습니다. */
export async function readBlogData(dirHandle: any): Promise<BlogData> {
  const [posts, media, categories] = await Promise.all([
    readJsonFileIfExists(dirHandle, 'posts.json'),
    readJsonFileIfExists(dirHandle, 'media-meta.json'),
    readJsonFileIfExists(dirHandle, 'categories.json'),
  ]);

  return {
    posts: Array.isArray(posts) ? posts : [],
    media: Array.isArray(media) ? media : [],
    categories: Array.isArray(categories) ? categories : [],
    hasMediaMeta: Array.isArray(media),
  };
}

/**
 * media-meta.json의 url (예: "/api/uploads/2026/07/20260719_231644_8d8912_photo.jpg")을
 * 데이터 폴더 기준 실제 파일 핸들로 변환합니다. ("/api/" 접두사만 제거하면 실제 폴더 구조와 일치합니다.)
 */
export async function resolveUploadFileHandle(dirHandle: any, url: string): Promise<any | null> {
  try {
    const cleaned = url.replace(/^\/?api\//, '').replace(/^\/+/, '');
    const parts = cleaned.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    let cur = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = await cur.getDirectoryHandle(parts[i], { create: false });
    }
    const fileName = parts[parts.length - 1];
    return await cur.getFileHandle(fileName, { create: false });
  } catch (err) {
    console.error('블로그 업로드 파일을 찾지 못했습니다:', url, err);
    return null;
  }
}

/** media-meta 항목의 실제 이미지/영상 파일을 찾아 브라우저 미리보기용 objectURL을 만듭니다. */
export async function blogMediaPreviewUrl(dirHandle: any, item: BlogMediaMeta): Promise<string | null> {
  const fh = await resolveUploadFileHandle(dirHandle, item.url);
  if (!fh) return null;
  try {
    return await fileHandleToObjectUrl(fh);
  } catch (err) {
    console.error(err);
    return null;
  }
}

/** 파일명만 뽑습니다 (미디어 라이브러리의 localImageName/localVideoName 규칙과 맞추기 위함). */
export function blogMediaFileName(url: string): string {
  const parts = url.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? url;
}

export function filterPostsByDateRange(posts: BlogPost[], from?: string, to?: string): BlogPost[] {
  return posts.filter((p) => {
    const d = p.createdAt?.slice(0, 10);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

/** 선택한 글 id들에 속한 미디어를 postId → order 순으로 정렬해 모읍니다. */
export function getMediaForPosts(media: BlogMediaMeta[], postIds: string[]): BlogMediaMeta[] {
  const idSet = new Set(postIds);
  return media
    .filter((m) => idSet.has(m.postId))
    .sort((a, b) => {
      if (a.postId !== b.postId) return postIds.indexOf(a.postId) - postIds.indexOf(b.postId);
      return a.order - b.order;
    });
}

/** 글 본문 HTML에서 태그를 걷어내고 순수 텍스트만 남깁니다 (LLM 프롬프트용, 대략적 처리). */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
