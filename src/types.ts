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
  remoteUrl?: string;
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
  url: string;
  files: MediaFile[];
}

export interface DownloadStatus {
  id: string;
  filename: string;
  totalBytes: number;
  downloadedBytes: number;
  status: 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled' | 'skipped';
  speed?: number;
  error?: string;
  remotePath?: string;
}

export interface UploadStatus {
  id: string;
  filename: string;
  user: string;
  transferredBytes: number;
  totalBytes: number;
  speed: number;
  startTime: number;
}