// 블로그 프로젝트(경우정민 블로그)가 생성하는 데이터 폴더를 읽어옵니다.
// posts.json / media-meta.json / categories.json 은 텍스트라서 그대로 파싱하고,
// uploads/YYYY/MM/파일명 은 File System Access API로 실제 파일을 찾아 미리보기를 만듭니다.
//
// 이 모듈은 블로그 앱의 서버(API Route)를 거치지 않습니다 — 사용자가 블로그 데이터 폴더를
// (블로그를 실행하지 않은 상태에서도) 직접 폴더 선택으로 연결하면, 그 폴더 안의 JSON/이미지
// 파일을 브라우저에서 바로 읽습니다.
//
// ⚠️ 중요: 블로그의 실제 소스코드(lib/mediaMeta.ts, lib/extractMedia.ts)를 확인한 결과,
// "원본"은 항상 글 본문(content)의 <img>/<video> 태그이고, media-meta.json은 그 태그 중
// data-media-id가 붙은 것만 골라 캡션/장소를 보조로 저장하는 색인일 뿐입니다. 즉:
//  - media-meta.json이 아예 없는 폴더도 있을 수 있습니다 (아직 한 번도 "글 저장"이 안 되었거나
//    구버전 데이터).
//  - data-media-id가 없는 <img> (붙여넣기로 들어간 사진 등)는 media-meta.json에 아예 안 잡힙니다.
// 그래서 이 모듈은 media-meta.json만 믿지 않고, 항상 본문(content)을 직접 파싱해 미디어를
// 찾아낸 뒤, media-meta.json에 매칭되는 항목이 있으면 캡션/장소로 보강합니다. 이렇게 해야
// 실제 사용자 데이터(캡션이 없는 사진 포함)에서도 사진을 빠짐없이 찾아 스토리보드에 쓸 수 있습니다.
// id/postId 값을 임의로 새로 만들거나 캡션이 없는데 지어내지 않는다는 원칙은 그대로 지킵니다
// (없으면 빈 문자열로 둘 뿐, 절대 지어내지 않습니다).

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
  mediaUrls?: string[];
  location?: string;
}

export interface BlogMediaMeta {
  id: string;
  postId: string;
  url: string;
  // 2026-08-01 추가: 블로그(KWJMTORY)는 <audio> 태그와 media-meta.json의 type: 'audio'도
  // 실제로 사용합니다(src/app/lib/audioExtension.ts, mediaMeta.ts 참고). 이전 구현은
  // 'image' | 'video'만 인식해 오디오 캡션/날짜 데이터가 통째로 누락되었습니다 — 반드시
  // 'audio'도 포함해야 "정확하게 모든 관련 데이터"를 불러온다는 요구사항을 만족합니다.
  type: 'image' | 'video' | 'audio';
  order: number;
  caption: string;
  location: string;
  year: number;
  month: string;
  day: string;
  isThumbnail?: boolean;
  /** media-meta.json에 있는 "정식" 항목인지, 본문에서 직접 뽑아낸 보조 항목인지 (디버그/표시용) */
  derivedFromContent?: boolean;
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
  /** 작성자 코드(gyeongwoo/jungmin/other) → 사람이 보는 실제 이름. settings.json이 없으면 기본값. */
  authorLabels: Record<string, string>;
  /** media-meta.json 파일 자체가 존재했는지 (없어도 본문에서 사진을 찾으므로 기능은 정상 동작합니다) */
  hasMediaMetaFile: boolean;
}

const DEFAULT_AUTHOR_LABELS: Record<string, string> = { gyeongwoo: '경우', jungmin: '정민', other: '기타' };

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function splitDateParts(iso: string): { year: number; month: string; day: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { year: 0, month: '01', day: '01' };
  return {
    year: d.getFullYear(),
    month: String(d.getMonth() + 1).padStart(2, '0'),
    day: String(d.getDate()).padStart(2, '0'),
  };
}

interface ParsedMediaTag {
  type: 'image' | 'video' | 'audio';
  src: string;
  mediaId: string | null;
  caption: string;
  location: string;
  isThumbnail: boolean;
}

/**
 * 블로그의 parseMediaTags()와 동일한 규칙으로 본문 HTML에서 <img>/<video>/<audio> 태그를
 * 추출합니다. (2026-08-01: <audio> 추가 — 블로그의 src/app/lib/mediaMeta.ts가 쓰는
 * `/<(img|video|audio)\b([^>]*)>/gi`와 동일한 태그 집합을 그대로 따라야, 오디오가 첨부된
 * 글에서도 오디오 캡션/장소/날짜 정보를 놓치지 않습니다.)
 */
function parseMediaTagsFromContent(html: string): ParsedMediaTag[] {
  if (!html) return [];
  const results: ParsedMediaTag[] = [];
  const tagRegex = /<(img|video|audio)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(html)) !== null) {
    const tagName = m[1].toLowerCase();
    const attrs = m[2];
    const srcMatch = /\ssrc="([^"]*)"/i.exec(attrs);
    if (!srcMatch || !srcMatch[1]) continue;
    if (srcMatch[1].startsWith('data:')) continue; // base64 임베드는 실제 파일이 아니므로 건너뜀
    const mediaIdMatch = /\sdata-media-id="([^"]*)"/i.exec(attrs);
    const titleMatch = /\stitle="([^"]*)"/i.exec(attrs);
    const locationMatch = /\sdata-location="([^"]*)"/i.exec(attrs);
    const isThumbnail = /\sdata-thumbnail="true"/i.test(attrs);
    results.push({
      type: tagName === 'video' ? 'video' : tagName === 'audio' ? 'audio' : 'image',
      src: srcMatch[1],
      mediaId: mediaIdMatch ? decodeHtmlEntities(mediaIdMatch[1]) : null,
      caption: titleMatch ? decodeHtmlEntities(titleMatch[1]) : '',
      location: locationMatch ? decodeHtmlEntities(locationMatch[1]) : '',
      isThumbnail,
    });
  }
  return results;
}

/**
 * 글 하나의 미디어 목록을 만듭니다: 본문(content)에서 등장 순서 그대로 추출하고,
 * media-meta.json에 같은 mediaId의 항목이 있으면 그 캡션/장소/날짜로 보강합니다
 * (media-meta.json 쪽 정보가 더 정확하다고 보고 우선합니다). 매칭이 없으면 본문 태그 자체의
 * title/data-location 속성과 글의 createdAt/location으로 채우고, 그마저 없으면 빈 문자열로 둡니다.
 * 마지막으로 예전 버전 호환용 mediaUrls 중 본문에 없는 것만 추가로 붙입니다.
 */
function buildMediaForPost(post: BlogPost, mediaMetaByPostId: Map<string, BlogMediaMeta[]>): BlogMediaMeta[] {
  const parsedTags = parseMediaTagsFromContent(post.content);
  const metaList = mediaMetaByPostId.get(post.id) ?? [];
  const metaByMediaId = new Map(metaList.map((m) => [m.id, m]));
  const { year, month, day } = splitDateParts(post.createdAt);

  const result: BlogMediaMeta[] = [];
  const seenUrls = new Set<string>();

  parsedTags.forEach((tag, index) => {
    const metaMatch = tag.mediaId ? metaByMediaId.get(tag.mediaId) : undefined;
    if (metaMatch) {
      result.push({ ...metaMatch, derivedFromContent: false });
    } else {
      result.push({
        id: tag.mediaId || `content_${post.id}_${index}`,
        postId: post.id,
        url: tag.src,
        type: tag.type,
        order: index,
        caption: tag.caption,
        location: tag.location || post.location || '',
        year,
        month,
        day,
        isThumbnail: tag.isThumbnail,
        derivedFromContent: true,
      });
    }
    seenUrls.add(tag.src);
  });

  // 예전 버전 호환: mediaUrls에는 있지만 본문(content)에는 없는 것들
  (post.mediaUrls ?? []).forEach((url, i) => {
    if (seenUrls.has(url)) return;
    result.push({
      id: `legacy_${post.id}_${i}`,
      postId: post.id,
      url,
      type: 'image',
      order: result.length,
      caption: '',
      location: post.location || '',
      year,
      month,
      day,
      derivedFromContent: true,
    });
    seenUrls.add(url);
  });

  return result;
}

/** 블로그 데이터 폴더(연결된 dirHandle)에서 posts.json / media-meta.json / categories.json / settings.json을 읽습니다. */
export async function readBlogData(dirHandle: any): Promise<BlogData> {
  const [postsRaw, mediaMetaRaw, categoriesRaw, settingsRaw] = await Promise.all([
    readJsonFileIfExists(dirHandle, 'posts.json'),
    readJsonFileIfExists(dirHandle, 'media-meta.json'),
    readJsonFileIfExists(dirHandle, 'categories.json'),
    readJsonFileIfExists(dirHandle, 'settings.json'),
  ]);

  const posts: BlogPost[] = Array.isArray(postsRaw) ? postsRaw : [];
  const rawMediaMeta: BlogMediaMeta[] = Array.isArray(mediaMetaRaw) ? mediaMetaRaw : [];

  const mediaMetaByPostId = new Map<string, BlogMediaMeta[]>();
  for (const m of rawMediaMeta) {
    const list = mediaMetaByPostId.get(m.postId) ?? [];
    list.push(m);
    mediaMetaByPostId.set(m.postId, list);
  }

  const media: BlogMediaMeta[] = [];
  for (const post of posts) {
    media.push(...buildMediaForPost(post, mediaMetaByPostId));
  }

  const customLabels =
    settingsRaw && typeof settingsRaw === 'object' && settingsRaw.authorLabels ? settingsRaw.authorLabels : {};
  const authorLabels: Record<string, string> = { ...DEFAULT_AUTHOR_LABELS };
  for (const key of Object.keys(DEFAULT_AUTHOR_LABELS)) {
    const custom = customLabels[key];
    if (typeof custom === 'string' && custom.trim()) authorLabels[key] = custom.trim();
  }

  return {
    posts,
    media,
    categories: Array.isArray(categoriesRaw) ? categoriesRaw : [],
    authorLabels,
    hasMediaMetaFile: Array.isArray(mediaMetaRaw),
  };
}

/**
 * media-meta의 url (예: "/api/uploads/2026/07/20260719_231644_8d8912_photo.jpg")을
 * 데이터 폴더 기준 실제 파일 핸들로 변환합니다. ("/api/" 접두사만 제거하면 실제 폴더 구조와 일치합니다.)
 */
export async function resolveUploadFileHandle(dirHandle: any, url: string): Promise<any | null> {
  try {
    const cleaned = url.replace(/^\/?api\//, '').replace(/^\/+/, '');
    const parts = cleaned
      .split('/')
      .filter(Boolean)
      .map((p) => {
        try {
          return decodeURIComponent(p);
        } catch {
          return p;
        }
      });
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

/** media 항목의 실제 이미지/영상 파일을 찾아 브라우저 미리보기용 objectURL을 만듭니다. */
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
  const last = parts[parts.length - 1] ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** 작성자 코드를 사람이 보는 실제 이름으로 바꿉니다 (settings.json에 지정이 없으면 기본값 사용). */
export function resolveAuthorLabel(author: string, authorLabels?: Record<string, string>): string {
  return authorLabels?.[author]?.trim() || DEFAULT_AUTHOR_LABELS[author] || author;
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
