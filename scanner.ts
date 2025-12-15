import fs from 'fs/promises';
import path from 'path';
import { MediaFile } from './types';

// Valid Extensions
const VALID_EXTS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.iso', '.ts', '.m4v',
  '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma', '.alac', '.aiff', '.ape', '.opus'
]);

// Ignored Folder Names (Normalized: lowercase, no spaces/hyphens)
const IGNORED_TERMS = new Set([
  'extras', 'extra',
  'specials', 'special',
  'season00', 'season0',
  'sample', 'samples',
  'behindthescenes', 'bts',
  'deletedscenes', 'deleted',
  'featurettes', 'featurette',
  'interviews', 'interview',
  'scenes', 'scene',
  'shorts', 'short',
  'trailers', 'trailer',
  'other', 'others',
  'bonus', 'bonuses'
]);

async function scanDirectory(dir: string): Promise<string[]> {
  let results: string[] = [];
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    
    // CHECK: Are we currently inside a specific Movie folder?
    // Logic: If the folder we are scanning (dir) is a child of a "movies" folder.
    const parentName = path.basename(path.dirname(dir));
    const isInsideMovieFolder = /^movies?$/i.test(parentName);

    for (const dirent of dirents) {
      const name = dirent.name;
      
      // 1. HIDDEN FILE/FOLDER CHECK
      if (name.startsWith('.') || name.startsWith('_')) continue;

      const res = path.resolve(dir, name);

      if (dirent.isDirectory()) {
        // --- RECURSION STOPPER ---
        // If we are already inside a movie folder (e.g. /media/movies/RoboCop), 
        // STOP. Do not scan subfolders like "Deleted Scenes".
        if (isInsideMovieFolder) {
           continue; 
        }

        // 2. NORMAL IGNORE LIST CHECK
        const normalized = name.toLowerCase().replace(/[\s\-_]/g, '');
        if (IGNORED_TERMS.has(normalized)) continue;

        results = results.concat(await scanDirectory(res));
      } else {
        // 3. EXTENSION CHECK
        const ext = path.extname(res).toLowerCase();
        if (VALID_EXTS.has(ext)) {
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
      const filename = path.basename(filePath);
      
      // --- QUALITY / 3D DETECTION ---
      // Default to finding resolution (4k, 1080p, etc)
      let quality = filename.match(/4k|2160p|1080p|720p|sd/i)?.[0] || null;
      
      // Override if 3D markers are found
      if (/\{edition-3d\}|\.sbs/i.test(filename)) {
        quality = '3D';
      }

      const file: MediaFile = {
        rawFilename: filename,
        path: relativePath,
        library: relativePath.split(path.sep)[0] || 'Root',
        quality: quality,
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