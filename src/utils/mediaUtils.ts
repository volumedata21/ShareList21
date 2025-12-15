export const formatBytes = (bytes: number, decimals = 2): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const getMediaType = (path: string, filename: string): 'Movie' | 'TV Show' | 'Music' | 'Unknown' => {
  const normalizedPath = path.toLowerCase().replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  const lowerName = filename.toLowerCase();

  const isAudio = /\.(mp3|flac|wav|m4a|aac|ogg|wma|alac|aiff|ape|opus)$/.test(lowerName);
  const isVideo = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|iso)$/.test(lowerName);

  if (parts.includes('music') && isAudio) {
    return 'Music';
  }

  if ((parts.includes('tv') || parts.includes('shows')) && isVideo) {
    return 'TV Show';
  }

  if (parts.includes('movies') && isVideo) {
    return 'Movie';
  }

  if (isVideo) {
     if (/s\d{2}e\d{2}/.test(lowerName)) return 'TV Show';
     return 'Movie';
  }
  
  return 'Unknown';
};

// NEW: Helper to extract audio format for badges
export const getAudioFormat = (filename: string): string | null => {
  const match = filename.match(/\.(mp3|flac|wav|m4a|aac|ogg|wma|alac|aiff|ape|opus)$/i);
  if (match) {
    return match[1].toUpperCase();
  }
  return null;
};

export const getMusicMetadata = (path: string) => {
  const normalizedPath = path.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  
  const musicIdx = parts.findIndex(p => p.toLowerCase() === 'music');
  
  if (musicIdx !== -1 && musicIdx + 2 < parts.length) {
    return {
      artist: parts[musicIdx + 1],
      album: parts[musicIdx + 2]
    };
  } else if (musicIdx !== -1 && musicIdx + 1 < parts.length) {
     return {
       artist: parts[musicIdx + 1],
       album: 'Unknown Album'
     };
  }
  
  return { artist: 'Unknown Artist', album: 'Unknown Album' };
};

export const get3DFormat = (filename: string): string | null => {
  const lower = filename.toLowerCase();
  if (lower.includes('.sbs') || lower.includes('h-sbs')) return '3D SBS';
  if (lower.includes('.hou') || lower.includes('h-ou')) return '3D OU';
  if (lower.includes('.3d.') || lower.includes(' 3d ')) return '3D';
  return null;
};

export const get4KFormat = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  return lower.includes('4k') || lower.includes('2160p') || lower.includes('uhd');
};

export const is4KQualityString = (quality: string | null): boolean => {
  if (!quality) return false;
  const lower = quality.toLowerCase();
  return ['4k', '2160p', 'uhd', '4k uhd'].includes(lower);
};

export const cleanName = (filename: string): string => {
  let name = filename;
  let editionText = "";

  const editionMatch = name.match(/\{edition-(.+?)\}/i);
  if (editionMatch) {
    editionText = editionMatch[1].trim(); 
    name = name.replace(editionMatch[0], ""); 
  }

  name = name.replace(/\.[^/.]+$/, "");
  name = name.replace(/[._]/g, " ");

  const tagsToRemove = [
    '4k', '2160p', '1080p', '720p', '480p', 'sd',
    'bluray', 'web-dl', 'webrip', 'dvdrip', 'hdr', 'dv',
    'x264', 'x265', 'hevc', 'aac', 'ac3', 'dts', 'atmos',
    'remastered', 'extended', 'cut', 'uhd',
    '3d', 'sbs', 'h-sbs', 'hou', 'h-ou'
  ];
  
  const tagRegex = new RegExp(`\\b(${tagsToRemove.join('|')})\\b`, 'gi');
  name = name.replace(tagRegex, '');
  
  name = name.replace(/(\.sbs|\.hou)/gi, '');
  name = name.replace(/(\(\d{4}\))\s*-\s*$/, '$1');
  name = name.replace(/\s*-\s*$/, '');
  name = name.replace(/\s{2,}/g, ' ');

  name = name.trim();

  if (editionText) {
    name = `${name} - ${editionText}`;
  }

  return name;
};

export const fuzzyMatch = (text: string, query: string): boolean => {
  const lowerText = text.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  return terms.every(term => lowerText.includes(term));
};

export const getSeriesName = (filename: string): string | null => {
  const match = filename.match(/(.+?)\s*s\d{2}e\d{2}/i);
  if (match) return cleanName(match[1]);
  return null;
};

export const parseEpisodeInfo = (filename: string) => {
  const match = filename.match(/s(\d{2})e(\d{2})/i);
  if (match) {
    return {
      season: parseInt(match[1]),
      episode: parseInt(match[2]),
      full: match[0].toUpperCase()
    };
  }
  return null;
};

export const getEpisodeTitle = (filename: string): string => {
  const match = filename.match(/s\d{2}e\d{2}[\s.]+(?:-[\s.]+)?(.+)\.\w+$/i);
  if (match) return cleanName(match[1]);
  return "";
};