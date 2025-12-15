export const formatBytes = (bytes: number, decimals = 2): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const getMediaType = (path: string, filename: string): 'Movie' | 'TV Show' | 'Music' | 'Unknown' => {
  const lowerPath = path.toLowerCase();
  const lowerName = filename.toLowerCase();
  
  if (lowerPath.includes('/music/') || lowerPath.startsWith('music/')) return 'Music';
  if (lowerPath.includes('/tv/') || lowerPath.includes('/shows/') || lowerPath.startsWith('tv/')) return 'TV Show';
  if (lowerPath.includes('/movies/') || lowerPath.startsWith('movies/')) return 'Movie';

  if (/\.(mp3|flac|wav|m4a|aac|ogg|wma|alac|aiff|ape|opus)$/.test(lowerName)) return 'Music';
  
  if (/\.(mkv|mp4|avi|mov|wmv|m4v|ts|iso)$/.test(lowerName)) {
     if (/s\d{2}e\d{2}/.test(lowerName) || lowerPath.includes('season')) return 'TV Show';
     return 'Movie';
  }
  
  return 'Unknown';
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

  // 1. Extract {edition-...} BEFORE cleaning
  // Matches "{edition-Director's Cut}" and captures "Director's Cut"
  const editionMatch = name.match(/\{edition-(.+?)\}/i);
  if (editionMatch) {
    editionText = editionMatch[1].trim(); 
    // Remove the tag from the name so it doesn't get garbled by later regex
    name = name.replace(editionMatch[0], ""); 
  }

  // 2. Remove Extension
  name = name.replace(/\.[^/.]+$/, "");

  // 3. Replace dots/underscores with spaces
  name = name.replace(/[._]/g, " ");

  // 4. Remove common release tags
  // Note: We leave 'cut', 'extended' etc. in this list so normal filenames get cleaned,
  // but since we extracted 'editionText' separately above, it remains safe.
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
  
  // Fix "Name (Year) - " Pattern
  name = name.replace(/(\(\d{4}\))\s*-\s*$/, '$1');
  
  // General Cleanup
  name = name.replace(/\s*-\s*$/, '');
  name = name.replace(/\s{2,}/g, ' ');

  name = name.trim();

  // 5. Append Edition Text if it existed
  if (editionText) {
    name = `${name} - ${editionText}`;
  }

  return name;
};

export const fuzzyMatch = (text: string, query: string): boolean => {
  return text.toLowerCase().includes(query.toLowerCase());
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