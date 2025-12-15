import { MediaFile } from '../types';
import { isMediaFile, parseQuality, parseLibraryName } from '../src/utils/mediaUtils';

const generateId = () => Math.random().toString(36).substr(2, 9);

/**
 * Scans a directory handle (Client-side)
 */
export async function scanDirectory(
  dirHandle: FileSystemDirectoryHandle, 
  onProgress?: (count: number) => void
): Promise<MediaFile[]> {
  const mediaFiles: MediaFile[] = [];
  let count = 0;

  async function traverse(handle: FileSystemDirectoryHandle, pathSegments: string[]) {
    for await (const entry of handle.values()) {
      if (entry.kind === 'file') {
        if (isMediaFile(entry.name)) {
          const library = parseLibraryName(pathSegments);
          const quality = parseQuality(entry.name);
          
          mediaFiles.push({
            id: generateId(),
            rawFilename: entry.name,
            path: [...pathSegments, entry.name].join('/'),
            library,
            quality,
            owner: 'Local Browser', // Temp, will be overwritten by sync
            handle: entry as FileSystemFileHandle,
          });
          
          count++;
          if (onProgress && count % 50 === 0) {
            onProgress(count);
          }
        }
      } else if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.')) {
          await traverse(entry as FileSystemDirectoryHandle, [...pathSegments, entry.name]);
        }
      }
    }
  }

  await traverse(dirHandle, []);
  return mediaFiles;
}

/**
 * Trigger a server-side scan on the configured host
 */
export async function triggerServerScan(baseUrl: string): Promise<void> {
  const url = `${baseUrl}/api/scan`.replace('//api', '/api'); // Safety cleanup
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) {
    throw new Error('Failed to trigger server scan.');
  }
}

/**
 * Fetch all files from the shared database
 */
export async function fetchAllFiles(baseUrl: string): Promise<MediaFile[]> {
  const url = `${baseUrl}/api/files`.replace('//api', '/api');
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch files from server.');
  const data = await response.json();
  return data.files || [];
}

/**
 * Sync local files to the server
 */
export async function syncFiles(baseUrl: string, owner: string, files: MediaFile[]): Promise<void> {
  const url = `${baseUrl}/api/sync`.replace('//api', '/api');
  
  // Strip handles before sending to server (they aren't serializable)
  const payload = files.map(({ handle, ...rest }) => ({ ...rest, owner }));

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, files: payload })
  });
  
  if (!response.ok) throw new Error('Sync failed.');
}

export async function scanFileList(
  fileList: FileList,
  onProgress?: (count: number) => void
): Promise<MediaFile[]> {
  const mediaFiles: MediaFile[] = [];
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (isMediaFile(file.name)) {
      const relativePath = file.webkitRelativePath || file.name;
      const pathSegments = relativePath.split('/');
      
      mediaFiles.push({
        id: generateId(),
        rawFilename: file.name,
        path: relativePath,
        library: parseLibraryName(pathSegments.slice(0, -1)),
        quality: parseQuality(file.name),
        owner: 'Local Upload',
        sizeBytes: file.size,
        lastModified: file.lastModified
      });
      if (onProgress && i % 50 === 0) onProgress(i);
    }
  }
  return mediaFiles;
}

export async function generateDemoData(): Promise<MediaFile[]> {
  // Same as before but returning array...
  const mkFile = (name: string, path: string, size: number, owner: string): MediaFile => ({
    id: generateId(), rawFilename: name, path: `${path}/${name}`,
    library: parseLibraryName(path.split('/')), quality: parseQuality(name),
    owner, sizeBytes: size, lastModified: Date.now()
  });
  return [
    mkFile('Avatar.2009.2160p.mkv', 'Movies/Sci-Fi', 15e9, 'Alice'),
    mkFile('The.Office.S01E01.mkv', 'TV/Comedy', 500e6, 'Bob'),
    mkFile('Inception.1080p.mkv', 'Movies/Action', 8e9, 'Charlie (Host)')
  ];
}