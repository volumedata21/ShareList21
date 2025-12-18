export interface AppConfig {
  users: string[];
  requiresPin: boolean;
  hostUser?: string;
  canDownload?: boolean;
}

export interface MediaFile {
  id?: string;
  rawFilename: string;
  path: string;
  library: string;
  quality?: string;
  sizeBytes: number;
  lastModified: number;
  owner: string;
  remoteUrl?: string; // NEW: The specific URL to reach this file's server
}

export interface MediaItem {
  id: string;
  name: string;
  type: 'Movie' | 'TV Show' | 'Music' | 'Unknown';
  files: MediaFile[];
}

export type FilterType = 'All' | 'Movie' | 'TV Show' | 'Music';

export interface SyncPayload {
  owner: string;
  url: string; // NEW: The Client announcing their address
  files: MediaFile[];
}