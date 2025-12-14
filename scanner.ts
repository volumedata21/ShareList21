import fs from 'fs/promises';
import path from 'path';
import { MediaFile } from './types';

const VALID_EXTS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg']);

async function scanDirectory(dir: string): Promise<string[]> {
  let results: string[] = [];
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const res = path.resolve(dir, dirent.name);
      if (dirent.isDirectory()) {
        results = results.concat(await scanDirectory(res));
      } else {
        const ext = path.extname(res).toLowerCase();
        if (VALID_EXTS.has(ext)) results.push(res);
      }
    }
  } catch (e) {
    // console.warn(`Skipping access-denied or missing directory: ${dir}`);
  }
  return results;
}

export async function processFiles(mediaRoot: string, owner: string): Promise<MediaFile[]> {
  console.log(`[Scanner] Starting scan of ${mediaRoot} for user ${owner}...`);
  
  const filePaths = await scanDirectory(mediaRoot);
  
  const processed = await Promise.all(filePaths.map(async (filePath) => {
    try {
      const stats = await fs.stat(filePath);
      const relativePath = path.relative(mediaRoot, filePath);
      
      const file: MediaFile = {
        rawFilename: path.basename(filePath),
        path: relativePath,
        library: relativePath.split(path.sep)[0] || 'Root',
        quality: path.basename(filePath).match(/4k|1080p|720p/i)?.[0] || null,
        owner: owner,
        sizeBytes: stats.size,
        lastModified: stats.mtimeMs
      };
      return file;
    } catch (e) { return null; }
  }));

  const validFiles = processed.filter((f): f is MediaFile => f !== null);
  console.log(`[Scanner] Found ${validFiles.length} valid media files.`);
  return validFiles;
}