import React, { useState, useEffect } from 'react';
import { MediaItem, MediaFile } from '../types';
import { formatBytes, parseEpisodeInfo, getEpisodeTitle, get3DFormat, get4KFormat, is4KQualityString, getMusicMetadata, getAudioFormat } from '../utils/mediaUtils';

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
  albumName?: string;
  audioFormat?: string | null;
}

const MediaDetail: React.FC<MediaDetailProps> = ({ item, onClose }) => {
  const [loadedFiles, setLoadedFiles] = useState<ProcessedFile[]>([]);
  const [copiedState, setCopiedState] = useState<string | null>(null);
  
  // NEW: State to filter by specific owner
  const [filterOwner, setFilterOwner] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedState(id);
    setTimeout(() => setCopiedState(null), 2000);
  };

  useEffect(() => {
    let mounted = true;
    
    const loadStats = async () => {
      const updatedFiles = await Promise.all(item.files.map(async (file) => {
        let size = file.sizeBytes;
        let modified = file.lastModified;
        
        const format3D = get3DFormat(file.rawFilename);
        const format4K = get4KFormat(file.rawFilename);
        const audioFormat = getAudioFormat(file.rawFilename);

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

        let musicInfo = {};
        if (item.type === 'Music') {
          const meta = getMusicMetadata(file.path);
          musicInfo = { albumName: meta.album };
        }

        return {
          ...file,
          sizeBytes: size,
          lastModified: modified,
          is3D: format3D,
          is4K: format4K,
          audioFormat,
          ...epInfo,
          ...musicInfo
        } as ProcessedFile;
      }));

      if (mounted) {
        const sorted = updatedFiles.sort((a, b) => {
           if (item.type === 'TV Show') {
             if (a.epSeason !== b.epSeason) return (a.epSeason || 0) - (b.epSeason || 0);
             if (a.epNumber !== b.epNumber) return (a.epNumber || 0) - (b.epNumber || 0);
           }
           if (item.type === 'Music') {
             if (a.albumName !== b.albumName) return (a.albumName || '').localeCompare(b.albumName || '');
             return a.rawFilename.localeCompare(b.rawFilename);
           }
           return a.owner.localeCompare(b.owner);
        });
        setLoadedFiles(sorted);
      }
    };

    setLoadedFiles([]); 
    setFilterOwner(null); // Reset filter when item changes
    loadStats();

    return () => { mounted = false; };
  }, [item]);

  const uniqueOwners = Array.from(new Set(item.files.map(f => f.owner))).sort();

  // FILTER LOGIC: Only show files for the selected owner (or all if null)
  const displayedFiles = filterOwner 
    ? loadedFiles.filter(f => f.owner === filterOwner)
    : loadedFiles;

  // --- MUSIC RENDER LOGIC ---
  if (item.type === 'Music') {
    const albums: Record<string, ProcessedFile[]> = {};
    displayedFiles.forEach(f => {
      const alb = f.albumName || 'Unknown Album';
      if (!albums[alb]) albums[alb] = [];
      albums[alb].push(f);
    });

    const albumCount = Object.keys(albums).length;
    const isAlbumView = albumCount === 1 && item.name === Object.keys(albums)[0];

    return (
      <div className="h-full flex flex-col bg-gray-800 border-l border-gray-700 shadow-2xl overflow-y-auto">
        <div className="p-6 border-b border-gray-700 flex justify-between items-start sticky top-0 bg-gray-800 z-10 shadow-md">
          <div className="flex-1 mr-4">
            <h2 className="text-2xl font-bold text-white break-words leading-tight">{item.name}</h2>
            <div className="flex gap-2 mt-3 items-center">
              <span className="px-2 py-0.5 bg-plex-orange text-black text-xs font-bold rounded uppercase tracking-wider">
                {isAlbumView ? 'Music Album' : 'Music Artist'}
              </span>
              {!isAlbumView && (
                 <span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs font-bold rounded">{albumCount} Albums</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors bg-gray-700/50 p-2 rounded-full">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-8">
           
           {/* OWNERS FILTER (For Music too!) */}
           <section>
             <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
               <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
               Filter by Owner
             </h3>
             <div className="flex flex-wrap gap-2">
               {uniqueOwners.map(owner => {
                 const isActive = filterOwner === owner;
                 const isDimmed = filterOwner && !isActive;
                 return (
                   <button 
                     key={owner} 
                     onClick={() => setFilterOwner(isActive ? null : owner)}
                     className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all duration-200
                       ${isActive 
                         ? 'bg-green-500 border-green-400 text-black shadow-[0_0_10px_rgba(34,197,94,0.6)] scale-105 font-bold' 
                         : isDimmed
                           ? 'bg-gray-800 border-gray-700 text-gray-600 opacity-60 hover:opacity-100 hover:text-gray-400'
                           : 'bg-green-900/20 border-green-500/50 text-green-100 hover:bg-green-900/40'
                       }`}
                   >
                     <div className={`w-2 h-2 rounded-full shadow-sm ${isActive ? 'bg-black' : 'bg-green-500'}`}></div>
                     <span className="text-sm">{owner}</span>
                   </button>
                 );
               })}
             </div>
           </section>

           {Object.keys(albums).sort().map(albumName => (
             <div key={albumName} className="space-y-3">
               <h3 className="text-lg font-bold text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2">
                 <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                 {albumName}
               </h3>
               
               <div className="space-y-2">
                 {albums[albumName].map(file => (
                   <div key={file.id || file.path} className="flex items-center justify-between bg-gray-900/50 p-3 rounded border border-gray-800 hover:border-gray-600 transition-colors">
                     <div className="min-w-0 flex-1 pr-4">
                       <button 
                         onClick={() => handleCopy(file.rawFilename, `name-${file.path}`)}
                         className="text-sm font-medium text-gray-200 truncate hover:text-white text-left w-full transition-colors"
                         title="Click to copy"
                       >
                         {file.rawFilename}
                         {copiedState === `name-${file.path}` && <span className="ml-2 text-[10px] text-green-400 font-bold uppercase animate-pulse">Copied!</span>}
                       </button>
                       <div className="flex items-center gap-2 mt-1">
                          {file.audioFormat && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-gray-600 text-gray-400">
                              {file.audioFormat}
                            </span>
                          )}
                         <span className="text-[10px] uppercase font-bold text-green-500 bg-green-900/20 px-1.5 py-0.5 rounded">{file.owner}</span>
                         <button 
                           onClick={() => handleCopy(file.path, `path-${file.path}`)}
                           className="text-xs text-gray-600 truncate hover:text-gray-400 transition-colors max-w-[200px]"
                           title={file.path}
                         >
                           {copiedState === `path-${file.path}` ? <span className="text-green-500 font-bold">COPIED!</span> : file.path}
                         </button>
                       </div>
                     </div>
                     <div className="text-xs font-mono text-gray-500">
                       {file.sizeBytes !== undefined ? formatBytes(file.sizeBytes) : '...'}
                     </div>
                   </div>
                 ))}
               </div>
             </div>
           ))}
        </div>
      </div>
    );
  }

  // --- STANDARD RENDER LOGIC ---
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
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors bg-gray-700/50 p-2 rounded-full">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="p-6 space-y-8">
        
        {/* OWNERS FILTER SECTION */}
        <section>
           <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
             Filter by Owner
           </h3>
           <div className="flex flex-wrap gap-2">
             {uniqueOwners.map(owner => {
               const isActive = filterOwner === owner;
               const isDimmed = filterOwner && !isActive;
               
               return (
                 <button 
                   key={owner} 
                   onClick={() => setFilterOwner(isActive ? null : owner)}
                   className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all duration-200 cursor-pointer
                     ${isActive 
                       ? 'bg-green-500 border-green-400 text-black shadow-[0_0_10px_rgba(34,197,94,0.6)] scale-105 font-bold' 
                       : isDimmed
                         ? 'bg-gray-800 border-gray-700 text-gray-600 opacity-60 hover:opacity-100 hover:text-gray-400'
                         : 'bg-green-900/20 border-green-500/50 text-green-100 hover:bg-green-900/40'
                     }`}
                 >
                   <div className={`w-2 h-2 rounded-full shadow-sm ${isActive ? 'bg-black' : 'bg-green-500'}`}></div>
                   <span className="text-sm">{owner}</span>
                 </button>
               );
             })}
           </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
            {item.type === 'TV Show' ? 'Episodes' : 'Available Versions'}
          </h3>

          <div className="space-y-4">
            {displayedFiles.length === 0 ? (
                <div className="text-gray-500 italic text-sm p-4 text-center border border-gray-800 rounded bg-gray-900/30">
                    No files found for this user.
                </div>
            ) : displayedFiles.map((file) => (
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

                    <button 
                      onClick={() => handleCopy(file.rawFilename, `name-${file.path}`)}
                      className="text-xs font-mono text-gray-500 break-words hover:text-white transition-colors text-left"
                      title="Click to copy"
                    >
                      {file.rawFilename}
                      {copiedState === `name-${file.path}` && <span className="ml-2 text-green-400 font-bold uppercase animate-pulse">Copied!</span>}
                    </button>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-gray-500 mb-1">Size</div>
                    <div className="text-sm font-mono font-bold text-white whitespace-nowrap">
                       {file.sizeBytes !== undefined ? formatBytes(file.sizeBytes) : '...'}
                    </div>
                  </div>
                </div>

                <div className="p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    
                    {file.is4K && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-plex-orange text-black border border-plex-orange shadow-[0_0_8px_rgba(229,160,13,0.3)]">
                        4K UHD
                      </span>
                    )}

                    {file.is3D && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded border border-blue-400 text-blue-300 bg-blue-900/20 shadow-[0_0_8px_rgba(96,165,250,0.1)]">
                        {file.is3D}
                      </span>
                    )}

                    {file.quality && !is4KQualityString(file.quality) && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded border border-gray-600 text-gray-400">
                        {file.quality}
                      </span>
                    )}

                    {!file.is4K && !file.quality && (
                       <span className="text-xs font-bold px-2 py-0.5 rounded border border-gray-600 text-gray-400">Standard</span>
                    )}
                  </div>

                  <div 
                    onClick={() => handleCopy(file.path, `path-${file.path}`)}
                    className="bg-black/30 p-2 rounded border border-gray-800 cursor-pointer hover:border-gray-500 hover:bg-black/50 transition-all group"
                    title="Click to copy full path"
                  >
                    <div className="flex justify-between items-center mb-1">
                      <div className="text-[10px] uppercase text-gray-600 font-bold group-hover:text-gray-400 transition-colors">Full Path</div>
                      {copiedState === `path-${file.path}` && (
                        <span className="text-[10px] font-bold text-green-500 animate-bounce">COPIED!</span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-gray-400 break-words whitespace-normal group-hover:text-white transition-colors">
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