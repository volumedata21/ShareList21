import React, { useState, useEffect } from 'react';
import { MediaItem, MediaFile } from '../types';
import { formatBytes, parseEpisodeInfo, getEpisodeTitle, get3DFormat, get4KFormat, is4KQualityString } from '../utils/mediaUtils';

interface MediaDetailProps {
  item: MediaItem;
  onClose: () => void;
}

interface ProcessedFile extends MediaFile {
  epSeason?: number;
  epNumber?: number;
  epFull?: string; 
  epTitle?: string;
  is3D?: string | null;
  is4K?: boolean;
}

const MediaDetail: React.FC<MediaDetailProps> = ({ item, onClose }) => {
  const [loadedFiles, setLoadedFiles] = useState<ProcessedFile[]>([]);

  useEffect(() => {
    let mounted = true;
    
    const loadStats = async () => {
      const updatedFiles = await Promise.all(item.files.map(async (file) => {
        let size = file.sizeBytes;
        let modified = file.lastModified;
        
        const format3D = get3DFormat(file.rawFilename);
        const format4K = get4KFormat(file.rawFilename);

        let epInfo = {};
        if (item.type === 'TV Show') {
          const info = parseEpisodeInfo(file.rawFilename);
          if (info) {
             epInfo = {
               epSeason: info.season,
               epNumber: info.episode,
               epFull: info.full,
               epTitle: getEpisodeTitle(file.rawFilename)
             };
          }
        }

        return {
          ...file,
          sizeBytes: size,
          lastModified: modified,
          is3D: format3D,
          is4K: format4K,
          ...epInfo
        } as ProcessedFile;
      }));

      if (mounted) {
        const sorted = updatedFiles.sort((a, b) => {
           if (item.type === 'TV Show') {
             if (a.epSeason !== b.epSeason) return (a.epSeason || 0) - (b.epSeason || 0);
             if (a.epNumber !== b.epNumber) return (a.epNumber || 0) - (b.epNumber || 0);
           }
           return a.owner.localeCompare(b.owner);
        });
        setLoadedFiles(sorted);
      }
    };

    setLoadedFiles([]); 
    loadStats();

    return () => { mounted = false; };
  }, [item]);

  const uniqueOwners = Array.from(new Set(item.files.map(f => f.owner))).sort();

  return (
    <div className="h-full flex flex-col bg-gray-800 border-l border-gray-700 shadow-2xl overflow-y-auto">
      <div className="p-6 border-b border-gray-700 flex justify-between items-start sticky top-0 bg-gray-800 z-10 shadow-md">
        <div className="flex-1 mr-4">
          <h2 className="text-2xl font-bold text-white break-words leading-tight">{item.name}</h2>
          <div className="flex gap-2 mt-3 items-center">
            <span className="px-2 py-0.5 bg-plex-orange text-black text-xs font-bold rounded uppercase tracking-wider">
              {item.type}
            </span>
            <span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs font-bold rounded">
              {item.files.length} {item.files.length === 1 ? 'File' : 'Files'}
            </span>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors bg-gray-700/50 p-2 rounded-full"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-6 space-y-8">
        <section>
           <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
             Owners
           </h3>
           <div className="flex flex-wrap gap-2">
             {uniqueOwners.map(owner => (
               <div key={owner} className="flex items-center gap-2 bg-green-900/20 border border-green-500/50 rounded-full px-3 py-1 shadow-[0_0_10px_rgba(34,197,94,0.1)]">
                 <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.8)]"></div>
                 <span className="text-sm font-bold text-green-100">{owner}</span>
               </div>
             ))}
           </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
            {item.type === 'TV Show' ? 'Episodes' : 'Available Versions'}
          </h3>

          <div className="space-y-4">
            {loadedFiles.map((file) => (
              <div key={file.id || file.path} className="bg-gray-900/50 rounded-xl border border-gray-700 overflow-hidden hover:border-gray-500 transition-colors">
                
                <div className="p-4 bg-gray-900 border-b border-gray-800 flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    {item.type === 'TV Show' && file.epFull ? (
                       <div className="mb-2">
                          <div className="flex items-center gap-2 text-plex-orange font-bold text-lg">
                            <span>{file.epFull}</span>
                            {file.epTitle && <span className="text-gray-300 font-normal truncate">- {file.epTitle}</span>}
                          </div>
                       </div>
                    ) : null}

                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex items-center gap-1.5 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                          <span className="text-sm font-extrabold text-green-400 tracking-wide">{file.owner}</span>
                      </div>
                      <span className="text-xs text-gray-600">•</span>
                      <span className="text-xs text-gray-400">{file.library}</span>
                    </div>

                    <div className="text-xs font-mono text-gray-500 break-all">
                      {file.rawFilename}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-gray-500 mb-1">Size</div>
                    <div className="text-sm font-mono font-bold text-white whitespace-nowrap">
                      {file.sizeBytes ? formatBytes(file.sizeBytes) : '...'}
                    </div>
                  </div>
                </div>

                <div className="p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    
                    {/* GOLD 4K BADGE */}
                    {file.is4K && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-plex-orange text-black border border-plex-orange shadow-[0_0_8px_rgba(229,160,13,0.3)]">
                        4K UHD
                      </span>
                    )}

                    {/* 3D BADGE */}
                    {file.is3D && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded border border-blue-400 text-blue-300 bg-blue-900/20 shadow-[0_0_8px_rgba(96,165,250,0.1)]">
                        {file.is3D}
                      </span>
                    )}

                    {/* Generic Quality Badge (Filtered: hidden if it's 4K) */}
                    {file.quality && !is4KQualityString(file.quality) && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded border border-gray-600 text-gray-400">
                        {file.quality}
                      </span>
                    )}

                    {!file.is4K && !file.quality && (
                       <span className="text-xs font-bold px-2 py-0.5 rounded border border-gray-600 text-gray-400">Standard</span>
                    )}
                  </div>

                  <div className="bg-black/30 p-2 rounded border border-gray-800">
                    <div className="text-[10px] uppercase text-gray-600 font-bold mb-1">Full Path</div>
                    <div className="font-mono text-xs text-gray-400 break-all whitespace-normal">
                      {file.path}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
};

export default MediaDetail;