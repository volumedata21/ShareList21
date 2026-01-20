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

export const cleanName = (filename: string): string => {
  if (!filename) return '';

  // 1. Remove extension
  let name = filename.replace(/\.[^/.]+$/, "");

  // 2. Remove [brackets] and (parentheses) with year/resolution info
  name = name.replace(/\[.*?\]/g, "");
  name = name.replace(/\(\d{4}\)/g, ""); // Remove (2024)

  // 3. Remove common release trash
  const metaPatterns = [
    /\b(1080p|720p|4k|2160p|uhd|bluray|web-dl|remux|h264|h265|hevc|hdr|aac|ac3|dts|5\.1|7\.1)\b/gi,
  ];

  metaPatterns.forEach(pattern => {
    name = name.replace(pattern, "");
  });

  // 4. Replace dots and underscores with spaces
  name = name.replace(/[._]/g, " ");

  // 5. Cleanup whitespace
  return name.replace(/\s{2,}/g, " ").trim();
};

// --- CORE DETECTION LOGIC ---

export const getMediaType = (path: string, filename: string): 'Movie' | 'TV Show' | 'Music' | 'Unknown' => {
  const lowerName = filename.toLowerCase();
  const lowerPath = path.toLowerCase().replace(/\\/g, '/'); 

  // 1. Check Extensions
  const isAudio = /\.(mp3|flac|wav|m4a|aac|ogg|wma|alac|aiff|ape|opus)$/.test(lowerName);
  const isVideo = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|iso)$/.test(lowerName);

  if (!isAudio && !isVideo) return 'Unknown';

  // 2. Audio is usually Music
  if (isAudio) return 'Music';

  // 3. TV Detection (Strongest Signals)
  // S01E01 or 1x01 in filename
  if (/s\d{1,2}e\d{1,2}/i.test(lowerName) || /\d{1,2}x\d{1,2}/.test(lowerName)) {
    return 'TV Show';
  }
  // Folder keywords
  if (/\/tv|\/shows|\/series|\/seasons?|\/anime|\/cartoons/i.test(lowerPath)) {
    return 'TV Show';
  }

  // 4. Movie Detection
  if (/\/movies?|\/films?|\/cinema/i.test(lowerPath)) {
    return 'Movie';
  }

  // 5. Fallback for Videos
  // If it's video but not clearly TV, default to Movie
  return 'Movie';
};

// --- METADATA EXTRACTORS ---

export const getMusicMetadata = (pathStr: string) => {
  const parts = pathStr.replace(/\\/g, '/').split('/');
  const len = parts.length;
  
  // Strategy: Look for "Music" folder, otherwise guess based on depth
  const musicIdx = parts.findIndex(p => p.toLowerCase() === 'music');

  if (musicIdx !== -1 && musicIdx + 2 < len) {
    return { artist: parts[musicIdx + 1], album: parts[musicIdx + 2] };
  } 
  
  // Fallback: Assume structure is .../Artist/Album/Song.mp3
  if (len >= 3) {
    return { artist: parts[len - 3], album: parts[len - 2] };
  }

  return { artist: 'Unknown Artist', album: 'Unknown Album' };
};

export const getSeriesName = (filename: string): string | null => {
  // Matches "Breaking.Bad.S01E01" -> "Breaking Bad"
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
  // Grab text AFTER S01E01
  const match = filename.match(/s\d{1,2}e\d{1,2}[._\s-]*(.*?)(\.(mkv|mp4|avi)|$)/i);
  if (match && match[1]) {
     return cleanName(match[1]);
  }
  return '';
};

// --- FORMAT FLAGS ---

export const get3DFormat = (filename: string): string | null => {
  const lower = filename.toLowerCase();
  if (lower.includes('.sbs') || lower.includes('h-sbs')) return '3D SBS';
  if (lower.includes('.hou') || lower.includes('h-ou')) return '3D OU';
  if (lower.includes('3d')) return '3D';
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
  if (ext === 'flac') return 'FLAC';
  if (ext === 'wav') return 'WAV';
  if (ext === 'aac') return 'AAC';
  if (ext === 'ac3') return 'DD';
  if (ext === 'dts') return 'DTS';
  if (ext === 'opus') return 'OPUS';
  return null;
};

export const fuzzyMatch = (text: string, query: string): boolean => {
  if (!text || !query) return false;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  return t.includes(q);
};