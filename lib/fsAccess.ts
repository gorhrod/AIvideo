// 브라우저의 File System Access API를 사용해 실제 로컬 폴더를 선택하고
// 그 안의 파일을 읽고 쓰기 위한 얇은 래퍼입니다.
//
// 이 API는 Chrome / Edge 등 크로미움 기반 브라우저에서만 지원되며,
// 보안상 브라우저는 선택한 폴더의 "전체 절대 경로"는 알려주지 않고
// 폴더 이름(handle.name)만 제공합니다. 미지원 브라우저(Firefox, Safari 등)에서는
// 이 모듈의 함수들이 null을 반환하므로, 호출부에서 기존 수동 입력 방식으로
// 자연스럽게 대체(fallback)되도록 구성돼 있습니다.
//
// 중요: 이 프로젝트는 폴더 핸들을 IndexedDB/localStorage 등 브라우저 저장소에
// 남겨두지 않습니다. 실제 데이터(채팅, 씬 텍스트, 수정 기록)는 전부 사용자가
// 선택한 폴더 안의 실제 파일로만 저장되고, 브라우저를 새로고침하면 폴더 연결은
// 끊어지며 사용자가 같은 폴더를 다시 선택하면 그 안의 파일에서 이전 내용을
// 그대로 복원합니다. (자세한 설계 배경은 프로젝트 루트의 agent.md 참고)
//
// TypeScript 표준 DOM 타입 정의가 버전에 따라 File System Access API를
// 포함하지 않을 수 있어, 여기서는 의도적으로 `any`를 사용해 타입 충돌/누락으로
// 인한 빌드 실패를 방지합니다.

/** 저장 폴더 안에 앱 데이터를 모아두는 하위 폴더 이름 */
export const DATA_DIR_NAME = 'KWJMvideoAI_data';
/** 데이터 폴더 안에서 "새 프로젝트"로 저장한 개별 프로젝트 JSON들이 모이는 하위 폴더 */
export const PROJECTS_DIR_NAME = 'projects';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif'];
const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).showDirectoryPicker === 'function';
}

/**
 * 폴더 선택 다이얼로그를 엽니다.
 * - 사용자가 취소하면 null 반환 (에러로 취급하지 않음)
 * - 브라우저가 지원하지 않으면 null 반환
 */
export async function pickDirectory(mode: 'read' | 'readwrite' = 'readwrite'): Promise<any | null> {
  if (!isFileSystemAccessSupported()) return null;
  try {
    const handle = await (window as any).showDirectoryPicker({ mode });
    return handle;
  } catch (err: any) {
    if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
      // 사용자가 다이얼로그를 취소했거나 권한을 거부한 경우
      return null;
    }
    throw err;
  }
}

/** 핸들에 대한 읽기/쓰기 권한을 확인하고, 없으면 다시 요청합니다. */
export async function verifyPermission(handle: any, mode: 'read' | 'readwrite' = 'readwrite'): Promise<boolean> {
  if (!handle) return false;
  if (typeof handle.queryPermission !== 'function') return true; // 권한 API 자체가 없으면 통과
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (typeof handle.requestPermission !== 'function') return false;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

/** 디렉토리 핸들 하위에 이름이 일치하는 폴더를 가져오거나(없으면) 새로 만듭니다. */
export async function getOrCreateSubDirectory(dirHandle: any, name: string): Promise<any> {
  return dirHandle.getDirectoryHandle(name, { create: true });
}

/** 저장 폴더 안의 앱 전용 데이터 폴더(KWJMvideoAI_data)를 가져오거나 만듭니다. */
export async function getDataDir(rootHandle: any): Promise<any> {
  return getOrCreateSubDirectory(rootHandle, DATA_DIR_NAME);
}

/** 데이터 폴더 안의 projects 하위 폴더를 가져오거나 만듭니다. */
export async function getProjectsDir(dataDirHandle: any): Promise<any> {
  return getOrCreateSubDirectory(dataDirHandle, PROJECTS_DIR_NAME);
}

/** 디렉토리 핸들 안의 .json 파일 목록을 반환합니다. */
export async function listJsonFiles(dirHandle: any): Promise<{ name: string; handle: any }[]> {
  const files: { name: string; handle: any }[] = [];
  if (!dirHandle?.entries) return files;
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle?.kind === 'file' && name.toLowerCase().endsWith('.json')) {
      files.push({ name, handle });
    }
  }
  return files;
}

/** 파일 핸들의 내용을 JSON으로 파싱해 반환합니다. */
export async function readJsonFile(fileHandle: any): Promise<any> {
  const file = await fileHandle.getFile();
  const text = await file.text();
  return JSON.parse(text);
}

/** 디렉토리 핸들 안에 JSON 파일을 새로 만들거나 덮어씁니다. */
export async function writeJsonFile(dirHandle: any, fileName: string, data: unknown): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/** 디렉토리 핸들 안에 일반 텍스트 파일을 새로 만들거나 덮어씁니다. */
export async function writeTextFile(dirHandle: any, fileName: string, content: string): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** 파일이 없으면 null을, 있으면 텍스트 내용을 반환합니다 (에러를 던지지 않음). */
export async function readTextFileIfExists(dirHandle: any, fileName: string): Promise<string | null> {
  try {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: false });
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (err: any) {
    if (err && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')) return null;
    throw err;
  }
}

/** 파일이 없거나 JSON 파싱에 실패하면 null을 반환합니다 (에러를 던지지 않음). */
export async function readJsonFileIfExists(dirHandle: any, fileName: string): Promise<any | null> {
  const text = await readTextFileIfExists(dirHandle, fileName);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 파일 하나를 삭제합니다 (없어도 에러를 던지지 않음). */
export async function removeFileIfExists(dirHandle: any, fileName: string): Promise<void> {
  try {
    await dirHandle.removeEntry(fileName);
  } catch {
    // 이미 없으면 조용히 무시
  }
}

export interface MediaFileEntry {
  /** 파일명 (확장자 포함) */
  name: string;
  /** 선택한 미디어 폴더 기준 상대 경로 (하위 폴더 표시용) */
  path: string;
  handle: any;
  kind: 'image' | 'video';
}

/** 선택한 폴더(및 하위 2단계까지) 안의 이미지/영상 파일 목록을 스캔합니다. */
export async function listMediaFiles(dirHandle: any, maxDepth = 2): Promise<MediaFileEntry[]> {
  const results: MediaFileEntry[] = [];
  if (!dirHandle?.entries) return results;

  async function walk(handle: any, prefix: string, depth: number) {
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'file') {
        const lower = name.toLowerCase();
        const dot = lower.lastIndexOf('.');
        const ext = dot >= 0 ? lower.slice(dot) : '';
        if (IMAGE_EXTS.includes(ext)) {
          results.push({ name, path: `${prefix}${name}`, handle: entry, kind: 'image' });
        } else if (VIDEO_EXTS.includes(ext)) {
          results.push({ name, path: `${prefix}${name}`, handle: entry, kind: 'video' });
        }
      } else if (entry.kind === 'directory' && depth < maxDepth) {
        await walk(entry, `${prefix}${name}/`, depth + 1);
      }
    }
  }

  await walk(dirHandle, '', 0);
  return results;
}

/** 미디어 폴더 안에서 파일명이 일치하는 파일 핸들을 찾습니다 (재연결 시 참조 복원용). */
export async function findMediaFileByName(dirHandle: any, name: string, maxDepth = 2): Promise<any | null> {
  const files = await listMediaFiles(dirHandle, maxDepth);
  const found = files.find((f) => f.name === name);
  return found ? found.handle : null;
}

/** 파일 핸들에서 브라우저 미리보기용 objectURL을 만듭니다. 사용이 끝나면 URL.revokeObjectURL로 해제해야 합니다. */
export async function fileHandleToObjectUrl(fileHandle: any): Promise<string> {
  const file = await fileHandle.getFile();
  return URL.createObjectURL(file);
}
