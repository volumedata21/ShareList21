import React, { useState, useEffect, useMemo } from 'react';
import { MediaItem, MediaFile, AppConfig } from '../types';
import { formatBytes, parseEpisodeInfo, getEpisodeTitle, get3DFormat, get4KFormat, is4KQualityString, getMusicMetadata, getAudioFormat, getRemuxFormat } from '../utils/mediaUtils';

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
  isRemux?: string | null;
  albumName?: string;
  audioFormat?: string | null;
}

const MediaDetail: React.FC<MediaDetailProps> = ({ item, onClose }) => {
  const [loadedFiles, setLoadedFiles] = useState<ProcessedFile[]>([]);
  const [copiedState, setCopiedState] = useState<string | null>(null);
  const [filterOwner, setFilterOwner] = useState<string | null>(null);
  
  const [canDownload, setCanDownload] = useState(false);
  const [currentUser, setCurrentUser] = useState<string>('');
  
  // UPDATED: Use a Set to track multiple files downloading at once
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  // Accordion State
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then((data: AppConfig) => {
        setCanDownload(!!data.canDownload);
        if (data.hostUser) setCurrentUser(data.hostUser);
      });
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedState(id);
    setTimeout(() => setCopiedState(null), 2000);
  };

  // --- SINGLE DOWNLOAD ---
  const handleDownload = async (file: ProcessedFile) => {
    const pin = sessionStorage.getItem('pf_pin') || '';
    setDownloadingIds(prev => new Set(prev).add(file.path));

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-pin': pin },
        body: JSON.stringify({ 
          path: file.path, 
          filename: file.rawFilename,
          owner: file.owner
        })
      });
      if (!res.ok) throw new Error("Failed");
      
      // Clear loading state after a delay
      setTimeout(() => {
        setDownloadingIds(prev => {
          const next = new Set(prev);
          next.delete(file.path);
          return next;
        });
      }, 2000);
    } catch (e) {
      console.error(e);
      setDownloadingIds(prev => {
         const next = new Set(prev);
         next.delete(file.path);
         return next;
      });
      alert("Download failed.");
    }
  };

  // --- NEW: BATCH DOWNLOAD SEASON ---
  const handleSeasonDownload = async (files: ProcessedFile[]) => {
    const pin = sessionStorage.getItem('pf_pin') || '';
    
    // Filter out files I already own
    const filesToDownload = files.filter(f => f.owner !== currentUser);
    
    if (filesToDownload.length === 0) {
        alert("You already own all files in this season!");
        return;
    }

    // Update UI immediately
    setDownloadingIds(prev => {
        const next = new Set(prev);
        filesToDownload.forEach(f => next.add(f.path));
        return next;
    });

    // Group by owner (in case Ep1 is from Joe, Ep2 from Lamar)
    const filesByOwner: Record<string, ProcessedFile[]> = {};
    filesToDownload.forEach(f => {
        if (!filesByOwner[f.owner]) filesByOwner[f.owner] = [];
        filesByOwner[f.owner].push(f);
    });

    // Send requests
    for (const owner of Object.keys(filesByOwner)) {
        const batch = filesByOwner[owner];
        try {
            await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-app-pin': pin },
                body: JSON.stringify({ 
                  files: batch.map(f => ({ path: f.path, rawFilename: f.rawFilename })),
                  owner: owner,
                  folderName: item.name // Puts them in a folder named after the show
                })
            });
        } catch (e) {
            console.error("Batch failed for owner", owner, e);
        }
    }

    // Clear loading state after delay
    setTimeout(() => {
        setDownloadingIds(prev => {
          const next = new Set(prev);
          filesToDownload.forEach(f => next.delete(f.path));
          return next;
        });
    }, 2000);
  };

  useEffect(() => {
    let mounted = true;
    const loadStats = async () => {
      const updatedFiles = await Promise.all(item.files.map(async (file) => {
        let size = file.sizeBytes;
        let modified = file.lastModified;
        const format3D = get3DFormat(file.rawFilename);
        const format4K = get4KFormat(file.rawFilename);
        const formatRemux = getRemuxFormat(file.rawFilename);
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
          isRemux: formatRemux,
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
        setExpandedSeasons(new Set());
      }
    };
    setLoadedFiles([]); 
    setFilterOwner(null);
    loadStats();
    return () => { mounted = false; };
  }, [item]);

  const uniqueOwners = Array.from(new Set(item.files.map(f => f.owner))).sort();
  const displayedFiles = filterOwner ? loadedFiles.filter(f => f.owner === filterOwner) : loadedFiles;

  const groupedSeasons = useMemo(() => {
    if (item.type !== 'TV Show') return {};
    const groups: Record<number, ProcessedFile[]> = {};
    displayedFiles.forEach(f => {
      const s = f.epSeason !== undefined ? f.epSeason : 0; 
      if (!groups[s]) groups[s] = [];
      groups[s].push(f);
    });
    return groups;
  }, [displayedFiles, item.type]);

  const toggleSeason = (seasonNum: number) => {
    setExpandedSeasons(prev => {
      const next = new Set(prev);
      if (next.has(seasonNum)) next.delete(seasonNum);
      else next.add(seasonNum);
      return next;
    });
  };

  const renderFileCard = (file: ProcessedFile) => {
    const isDownloading = downloadingIds.has(file.path);
    
    return (
      <div key={file.id || file.path} className="bg-gray-900/50 rounded-xl border border-gray-700 overflow-hidden hover:border-gray-500 transition-colors mb-4 last:mb-0">
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

          <div className="flex flex-col items-end gap-2">
            <div className="text-sm font-mono font-bold text-white whitespace-nowrap">
                {file.sizeBytes !== undefined ? formatBytes(file.sizeBytes) : '...'}
            </div>
            
            {canDownload && file.owner !== currentUser && (
              <button 
                onClick={() => handleDownload(file)}
                disabled={isDownloading}
                className={`text-[10px] font-bold uppercase px-3 py-1.5 rounded flex items-center gap-2 transition-all
                  ${isDownloading 
                    ? 'bg-blue-600/50 text-blue-200 cursor-not-allowed' 
                    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg'}`}
              >
                {isDownloading ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                    <span>Queued</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    <span>Download</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {/* Tags */}
            {file.isRemux && <span className="text-xs font-bold px-2 py-0.5 rounded border border-purple-500 text-purple-300 bg-purple-900/40">{file.isRemux}</span>}
            {file.is4K && !file.isRemux && <span className="text-xs font-bold px-2 py-0.5 rounded bg-plex-orange text-black border border-plex-orange">4K UHD</span>}
            {file.is3D && <span className="text-xs font-bold px-2 py-0.5 rounded border border-blue-400 text-blue-300 bg-blue-900/20">{file.is3D}</span>}
            {file.quality && !is4KQualityString(file.quality) && <span className="text-xs font-bold px-2 py-0.5 rounded border border-gray-600 text-gray-400">{file.quality}</span>}
          </div>

          <div 
            onClick={() => handleCopy(file.path, `path-${file.path}`)}
            className="bg-black/30 p-2 rounded border border-gray-800 cursor-pointer hover:border-gray-500 hover:bg-black/50 transition-all group"
          >
            <div className="flex justify-between items-center mb-1">
              <div className="text-[10px] uppercase text-gray-600 font-bold group-hover:text-gray-400 transition-colors">Full Path</div>
              {copiedState === `path-${file.path}` && <span className="text-[10px] font-bold text-green-500 animate-bounce">COPIED!</span>}
            </div>
            <div className="font-mono text-xs text-gray-400 break-words whitespace-normal group-hover:text-white transition-colors">
              {file.path}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- MUSIC RENDER ---
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
              <span className="px-2 py-0.5 bg-plex-orange text-black text-xs font-bold rounded uppercase tracking-wider">{isAlbumView ? 'Music Album' : 'Music Artist'}</span>
              {!isAlbumView && (<span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs font-bold rounded">{albumCount} Albums</span>)}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors bg-gray-700/50 p-2 rounded-full">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6 space-y-8">
           <section>
             <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">Filter by Owner</h3>
             <div className="flex flex-wrap gap-2">{uniqueOwners.map(owner => {const isActive = filterOwner === owner;const isDimmed = filterOwner && !isActive;return (<button key={owner} onClick={() => setFilterOwner(isActive ? null : owner)} className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all duration-200 cursor-pointer ${isActive ? 'bg-green-500 border-green-400 text-black shadow-[0_0_10px_rgba(34,197,94,0.6)] scale-105 font-bold' : isDimmed ? 'bg-gray-800 border-gray-700 text-gray-600 opacity-60 hover:opacity-100 hover:text-gray-400' : 'bg-green-900/20 border-green-500/50 text-green-100 hover:bg-green-900/40'}`}><div className={`w-2 h-2 rounded-full shadow-sm ${isActive ? 'bg-black' : 'bg-green-500'}`}></div><span className="text-sm">{owner}</span></button>);})}</div>
           </section>

           {Object.keys(albums).sort().map(albumName => (
             <div key={albumName} className="space-y-3">
               <h3 className="text-lg font-bold text-gray-300 border-b border-gray-700 pb-2 flex items-center gap-2"><svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>{albumName}</h3>
               <div className="space-y-2">
                 {albums[albumName].map(file => {
                     const isDownloading = downloadingIds.has(file.path);
                     return (
                       <div key={file.id || file.path} className="flex items-center justify-between bg-gray-900/50 p-3 rounded border border-gray-800 hover:border-gray-600 transition-colors group">
                         <div className="min-w-0 flex-1 pr-4">
                           <div className="text-sm font-medium text-gray-200 truncate">{file.rawFilename}</div>
                           <div className="flex items-center gap-2 mt-1">
                             {file.audioFormat && (<span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-gray-600 text-gray-400">{file.audioFormat}</span>)}
                             <span className="text-[10px] uppercase font-bold text-green-500 bg-green-900/20 px-1.5 py-0.5 rounded">{file.owner}</span>
                           </div>
                         </div>
                         <div className="flex items-center gap-3">
                           <div className="text-xs font-mono text-gray-500">{file.sizeBytes !== undefined ? formatBytes(file.sizeBytes) : '...'}</div>
                           {canDownload && file.owner !== currentUser && (
                             <button 
                               onClick={() => handleDownload(file)}
                               disabled={isDownloading}
                               className={`p-1.5 rounded transition-all opacity-0 group-hover:opacity-100 focus:opacity-100
                                 ${isDownloading 
                                   ? 'bg-blue-600/50 text-blue-200 cursor-not-allowed opacity-100' 
                                   : 'bg-gray-700 hover:bg-blue-600 text-gray-300 hover:text-white'}`}
                             >
                                {isDownloading ? (
                                   <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                                ) : (
                                   <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                )}
                             </button>
                           )}
                         </div>
                       </div>
                     );
                 })}
               </div>
             </div>
           ))}
        </div>
      </div>
    );
  }

  // --- STANDARD / TV SHOW RENDER ---
  return (
    <div className="h-full flex flex-col bg-gray-800 border-l border-gray-700 shadow-2xl overflow-y-auto">
      {/* Header */}
      <div className="p-6 border-b border-gray-700 flex justify-between items-start sticky top-0 bg-gray-800 z-10 shadow-md">
        <div className="flex-1 mr-4">
          <h2 className="text-2xl font-bold text-white break-words leading-tight">{item.name}</h2>
          <div className="flex gap-2 mt-3 items-center">
            <span className="px-2 py-0.5 bg-plex-orange text-black text-xs font-bold rounded uppercase tracking-wider">{item.type}</span>
            <span className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs font-bold rounded">{item.files.length} {item.files.length === 1 ? 'File' : 'Files'}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors bg-gray-700/50 p-2 rounded-full">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="p-6 space-y-8">
        
        {/* OWNERS FILTER */}
        <section>
           <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">Filter by Owner</h3>
           <div className="flex flex-wrap gap-2">
             {uniqueOwners.map(owner => {
               const isActive = filterOwner === owner;
               const isDimmed = filterOwner && !isActive;
               return (
                 <button key={owner} onClick={() => setFilterOwner(isActive ? null : owner)} className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all duration-200 cursor-pointer ${isActive ? 'bg-green-500 border-green-400 text-black shadow-[0_0_10px_rgba(34,197,94,0.6)] scale-105 font-bold' : isDimmed ? 'bg-gray-800 border-gray-700 text-gray-600 opacity-60 hover:opacity-100 hover:text-gray-400' : 'bg-green-900/20 border-green-500/50 text-green-100 hover:bg-green-900/40'}`}><div className={`w-2 h-2 rounded-full shadow-sm ${isActive ? 'bg-black' : 'bg-green-500'}`}></div><span className="text-sm">{owner}</span></button>
               );
             })}
           </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
            {item.type === 'TV Show' ? 'Episodes' : 'Available Versions'}
          </h3>

          {displayedFiles.length === 0 ? (
             <div className="text-gray-500 italic text-sm p-4 text-center border border-gray-800 rounded bg-gray-900/30">No files found for this user.</div>
          ) : (
             <>
               {/* TV SHOWS (With Season Download) */}
               {item.type === 'TV Show' ? (
                 <div className="space-y-4">
                   {Object.keys(groupedSeasons).map(k => Number(k)).sort((a,b) => a - b).map(seasonNum => {
                     const isExpanded = expandedSeasons.has(seasonNum);
                     const files = groupedSeasons[seasonNum];
                     const seasonTitle = seasonNum === 0 ? 'Specials' : `Season ${seasonNum}`;
                     
                     // Check if there's anything to download in this season
                     const downloadableFiles = files.filter(f => f.owner !== currentUser);
                     const hasDownloads = canDownload && downloadableFiles.length > 0;

                     return (
                       <div key={seasonNum} className="border border-gray-800 rounded-lg overflow-hidden bg-gray-800/30">
                         {/* Header */}
                         <div className="flex justify-between items-center p-4 bg-gray-800/50 hover:bg-gray-800 transition-colors">
                           
                           {/* Click to Expand */}
                           <button 
                             onClick={() => toggleSeason(seasonNum)}
                             className="flex items-center gap-3 flex-1 text-left"
                           >
                             <span className={`transform transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                               <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                               </svg>
                             </span>
                             <div>
                                <h3 className="text-lg font-bold text-gray-200">{seasonTitle}</h3>
                                <span className="text-xs text-gray-500 font-mono">{files.length} Episodes</span>
                             </div>
                           </button>

                           {/* DOWNLOAD SEASON BUTTON (Prevent expansion click) */}
                           {hasDownloads && (
                               <button
                                 onClick={(e) => { e.stopPropagation(); handleSeasonDownload(downloadableFiles); }}
                                 className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase transition-colors shadow-lg border border-blue-400/50"
                               >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                  Download Season
                               </button>
                           )}
                         </div>

                         {/* Body */}
                         {isExpanded && (
                           <div className="p-4 border-t border-gray-800 space-y-4 bg-gray-900/20">
                             {files.map(file => renderFileCard(file))}
                           </div>
                         )}
                       </div>
                     );
                   })}
                 </div>
               ) : (
                 /* MOVIES (Flat List) */
                 <div className="space-y-4">
                   {displayedFiles.map(file => renderFileCard(file))}
                 </div>
               )}
             </>
          )}
        </section>

      </div>
    </div>
  );
};

export default MediaDetail;