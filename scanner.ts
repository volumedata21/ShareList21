import fs from 'fs/promises';
import path from 'path';
import { MediaFile } from './types';

// Only allow these extensions. 
// Images (jpg, png) and metadata (nfo, xml) are naturally ignored because they aren't in this list.
const VALID_EXTS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', 
  '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma'
]);

// Folders to completely skip recursion
const IGNORED_FOLDERS = new Set([
  'extras', 
  'featurettes', 
  'specials', 
  'season 00', 
  'season 0',
  'sample',
  'samples'
]);

async function scanDirectory(dir: string): Promise<string[]> {
  let results: string[] = [];
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    
    for (const dirent of dirents) {
      const name = dirent.name;
      const lowerName = name.toLowerCase();

      // 1. Ignore Hidden Files/Folders (starts with . or _)
      if (name.startsWith('.') || name.startsWith('_')) continue;

      const res = path.resolve(dir, name);

      if (dirent.isDirectory()) {
        // 2. Ignore Extras / Specials / Season 00
        if (IGNORED_FOLDERS.has(lowerName)) continue;

        // Recursively scan subdirectories
        results = results.concat(await scanDirectory(res));
      } else {
        // 3. Extension Check
        const ext = path.extname(res).toLowerCase();
        if (VALID_EXTS.has(ext)) {
          // Check for "Sample" files that might be loose in a folder
          if (lowerName.includes('sample') && (await fs.stat(res)).size < 50 * 1024 * 1024) {
             // Skip if filename contains "sample" and is < 50MB
             continue;
          }
          results.push(res);
        }
      }
    }
  } catch (e) {
    // console.warn(`Skipping: ${dir}`);
  }
  return results;
}

export async function processFiles(mediaRoot: string, owner: string): Promise<MediaFile[]> {
  console.log(`[Scanner] Starting scan of ${mediaRoot} for user ${owner}...`);
  
  // Get all valid file paths first
  const filePaths = await scanDirectory(mediaRoot);
  
  // Process stats in parallel
  const processed = await Promise.all(filePaths.map(async (filePath) => {
    try {
      const stats = await fs.stat(filePath);
      const relativePath = path.relative(mediaRoot, filePath);
      
      const file: MediaFile = {
        rawFilename: path.basename(filePath),
        path: relativePath,
        library: relativePath.split(path.sep)[0] || 'Root',
        // Simple regex for quality detection
        quality: path.basename(filePath).match(/4k|2160p|1080p|720p|sd/i)?.[0] || null,
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