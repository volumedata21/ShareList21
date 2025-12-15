import fs from 'fs/promises';
import path from 'path';
import { MediaFile } from './types';

// Expanded Audio/Video Extensions
const VALID_EXTS = new Set([
  // Video
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.iso', '.ts', '.m4v',
  // Audio
  '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma', '.alac', '.aiff', '.ape', '.opus'
]);

// Ignored Folder Names (Normalized: lowercase, no spaces/hyphens)
// REMOVED: 'other', 'scenes', 'shorts', 'trailers' (Too aggressive)
const IGNORED_TERMS = new Set([
  'extras', 
  'specials', 
  'season00', 
  'season0', 
  'sample', 
  'samples',
  'behindthescenes',
  'deletedscenes',
  'featurettes',
  'interviews'
]);

async function scanDirectory(dir: string): Promise<string[]> {
  let results: string[] = [];
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    
    for (const dirent of dirents) {
      const name = dirent.name;
      
      // 1. HIDDEN FILE CHECK (._, .DS_Store, etc)
      if (name.startsWith('.') || name.startsWith('_')) continue;

      const res = path.resolve(dir, name);

      if (dirent.isDirectory()) {
        // 2. EXTRAS FOLDER CHECK
        // Normalize: "Deleted Scenes" -> "deletedscenes"
        const normalized = name.toLowerCase().replace(/[\s\-_]/g, '');
        
        if (IGNORED_TERMS.has(normalized)) continue;

        results = results.concat(await scanDirectory(res));
      } else {
        // 3. EXTENSION CHECK
        const ext = path.extname(res).toLowerCase();
        if (VALID_EXTS.has(ext)) {
          // Skip small "sample" files (likely junk from downloads)
          if (name.toLowerCase().includes('sample') && (await fs.stat(res)).size < 50 * 1024 * 1024) {
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
  
  const filePaths = await scanDirectory(mediaRoot);
  
  const processed = await Promise.all(filePaths.map(async (filePath) => {
    try {
      const stats = await fs.stat(filePath);
      const relativePath = path.relative(mediaRoot, filePath);
      
      const file: MediaFile = {
        rawFilename: path.basename(filePath),
        path: relativePath,
        // Grab the first folder name as the "Library" (e.g., "Movies", "Music")
        library: relativePath.split(path.sep)[0] || 'Root',
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