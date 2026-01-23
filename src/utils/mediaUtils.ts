// src/utils/mediaUtils.ts

// --- FORMATTERS ---

export const formatBytes = (bytes: number, decimals = 2): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

/**
 * INTELLIGENT NAME CLEANER
 * 1. Global Scrub: Remove {edition-x}, [brackets].
 * 2. Year Anchor: If (YYYY) exists, keep it and discard everything after.
 * 3. Tech Cleanup: If no year, strip technical jargon (sbs, 4k, etc).
 */
export const cleanName = (filename: string): string => {
  if (!filename) return '';

  // 1. Remove file extension
  let name = filename.replace(/\.[^/.]+$/, "");

  // 2. Global "Tag" Cleanup (Happens before Year logic)
  // Remove {edition-XYZ}, [Anything], and (Anything that isn't a year)
  // We accept (YYYY) but remove (2013-2019) or (Directors Cut)
  name = name.replace(/\{.*?\}/g, ""); // Remove {edition-3d}
  name = name.replace(/\[.*?\]/g, ""); // Remove [Remux]

  // 3. YEAR ANCHOR STRATEGY
  // Look for the year pattern (YYYY). 
  // We strictly want to KEEP the year, but discard what comes AFTER it.
  const yearMatch = name.match(/^(.*?)(\(\d{4}\))/);
  
  if (yearMatch) {
    // yearMatch[1] = Title ("Star Trek ")
    // yearMatch[2] = Year ("(2013)")
    // This automatically drops ".1080p.sbs" because it comes AFTER the year.
    name = `${yearMatch[1]}${yearMatch[2]}`;
  } 
  else {
    // 4. NO YEAR STRATEGY (TV Shows / Misc)
    // If no year, we have to manually clean "trash" terms.

    // A. Replace dots/underscores with spaces first so we can check tokens
    name = name.replace(/[._]/g, " ");

    // B. List of junk terms to strip from the end of the string
    const trashPatterns = [
      /\b(sbs|hou|3d|4k|1080p|720p|2160p|remux|bluray|web-dl|hevc|hdr|dvd|rip)\b/gi,
      /\b(h264|h265|x264|x265|aac|ac3|dts)\b/gi
    ];

    trashPatterns.forEach(pattern => {
      name = name.replace(pattern, "");
    });

    // C. Conditional Dash Logic
    // If there is still a " - ", check if it was just separating trash
    if (name.includes(' - ')) {
      const parts = name.split(' - ');
      // If the last part is now empty or just spaces (because we stripped the text), drop it
      if (parts[parts.length - 1].trim().length === 0) {
        parts.pop();
        name = parts.join(' - ');
      }
    }
  }

  // 5. General Cleanup (Applies to everything)
  
  // Replace dots/underscores (if Year Strategy skipped step 4A)
  name = name.replace(/[._]/g, " ");

  // Final whitespace polish
  // "Star Trek  (2013) " -> "Star Trek (2013)"
  return name.replace(/\s+/g, " ").trim();
};

// --- CORE DETECTION LOGIC ---

export const getMediaType = (path: string, filename: string): 'Movie' | 'TV Show' | 'Music' | 'Unknown' => {
  const lowerName = filename.toLowerCase();
  const lowerPath = path.toLowerCase().replace(/\\/g, '/'); 

  // 1. Check Extensions
  const isAudio = /\.(mp3|flac|wav|m4a|aac|ogg|wma|alac|aiff|ape|opus)$/.test(lowerName);
  const isVideo = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|iso)$/.test(lowerName);

  if (!isAudio && !isVideo) return 'Unknown';
  if (isAudio) return 'Music';

  // 2. Explicit Folder Detection
  if (/\/movies\//.test(lowerPath)) return 'Movie';
  if (/\/tv\//.test(lowerPath) || /\/tvshows\//.test(lowerPath)) return 'TV Show';
  if (/\/music\//.test(lowerPath)) return 'Music';

  // 3. Fallback: TV Detection via Filename (S01E01)
  if (/s\d{1,2}e\d{1,2}/i.test(lowerName) || /\d{1,2}x\d{1,2}/.test(lowerName)) {
    return 'TV Show';
  }

  return 'Movie';
};

// --- METADATA EXTRACTORS ---

export const getMusicMetadata = (pathStr: string) => {
  const parts = pathStr.replace(/\\/g, '/').split('/');
  const len = parts.length;
  const musicIdx = parts.findIndex(p => p.toLowerCase() === 'music');

  if (musicIdx !== -1 && musicIdx + 2 < len) {
    return { artist: parts[musicIdx + 1], album: parts[musicIdx + 2] };
  } 
  
  if (len >= 3) {
    return { artist: parts[len - 3], album: parts[len - 2] };
  }

  return { artist: 'Unknown Artist', album: 'Unknown Album' };
};

export const getSeriesName = (filename: string): string | null => {
  const match = filename.match(/(.*?)[._\s-]*(s\d{1,2}e\d{1,2}|\d{1,2}x\d{1,2})/i);
  if (match && match[1]) {
    return cleanName(match[1]);
  }
  return null;
};

export const parseEpisodeInfo = (filename: string) => {
  const match = filename.match(/s(\d{1,2})e(\d{1,2})/i);
  if (match) {
    return {
      season: parseInt(match[1], 10),
      episode: parseInt(match[2], 10),
      full: `S${match[1].padStart(2, '0')}E${match[2].padStart(2, '0')}`
    };
  }
  return null;
};

export const getEpisodeTitle = (filename: string): string => {
  const match = filename.match(/s\d{1,2}e\d{1,2}[._\s-]*(.*?)(\.(mkv|mp4|avi)|$)/i);
  if (match && match[1]) {
     return match[1].replace(/[._]/g, " ").trim();
  }
  return '';
};

// --- FORMAT FLAGS ---

export const get3DFormat = (filename: string): string | null => {
  const lower = filename.toLowerCase();
  
  // Side-by-Side (SBS)
  if (lower.includes('.sbs') || lower.includes('h-sbs') || lower.includes('half-sbs')) {
    return '3D SBS';
  }
  
  // Top-and-Bottom (OU / TAB)
  if (lower.includes('.hou') || lower.includes('h-ou') || lower.includes('.tab') || lower.includes('.topbottom')) {
    return '3D OU';
  }
  
  // Generic 3D (Catch-all)
  if (lower.includes('3d')) {
    return '3D';
  }
  
  return null;
};

export const get4KFormat = (filename: string): boolean => {
  return /2160p|4k|uhd/i.test(filename);
};

export const is4KQualityString = (quality: string | undefined): boolean => {
  return !!quality && /2160p|4k|uhd/i.test(quality);
};

export const getRemuxFormat = (filename: string): string | null => {
  const lower = filename.toLowerCase();
  if (!lower.includes('remux')) return null;
  if (lower.includes('4k') || lower.includes('2160p')) return 'REMUX-4K';
  if (lower.includes('1080p')) return 'REMUX-1080';
  return 'REMUX';
};

export const getAudioFormat = (filename: string): string | null => {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (['flac', 'wav', 'aac', 'opus'].includes(ext || '')) return ext?.toUpperCase() || null;
  if (ext === 'ac3') return 'DD';
  if (ext === 'dts') return 'DTS';
  return null;
};

export const fuzzyMatch = (text: string, query: string): boolean => {
  if (!text || !query) return false;
  return text.toLowerCase().includes(query.toLowerCase());
};