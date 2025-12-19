import React, { useState, useEffect, useMemo } from 'react';
import { MediaItem, AppConfig } from '../types';
import { get3DFormat, get4KFormat, is4KQualityString, getMusicMetadata, getAudioFormat, getRemuxFormat } from '../utils/mediaUtils';

interface MediaListProps {
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  selectedId?: string;
}

const getIcon = (type: string, isAlbum = false) => {
  switch (type) {
    case 'Movie': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>;
    case 'TV Show': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
    case 'Music': return isAlbum ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg> : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>;
    default: return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
  }
};

const MediaList: React.FC<MediaListProps> = ({ items, onSelect, selectedId }) => {
  const [hostUser, setHostUser] = useState<string>(''); 
  const [filterOwner, setFilterOwner] = useState<string>('All'); 
  const [missingOnly, setMissingOnly] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then((data: AppConfig) => {
        if (data.hostUser) setHostUser(data.hostUser);
      })
      .catch(console.error);
  }, []);

  const availableOwners = useMemo(() => {
    const owners = new Set<string>();
    items.forEach(m => m.files.forEach(f => owners.add(f.owner)));
    return Array.from(owners).sort();
  }, [items]);

  const displayedItems = useMemo(() => {
    return items.filter(item => {
      if (filterOwner !== 'All') {
        const hasOwner = item.files.some(f => f.owner === filterOwner);
        if (!hasOwner) return false;
      }
      if (missingOnly && hostUser) {
        const iHaveIt = item.files.some(f => f.owner === hostUser);
        if (iHaveIt) return false; 
      }
      return true;
    });
  }, [items, filterOwner, missingOnly, hostUser]);

  const renderName = (name: string, isSelected: boolean) => {
    const parts = name.split(/(\(\d{4}\))/g);
    return parts.map((part, i) => {
      if (/^\(\d{4}\)$/.test(part)) {
        return <span key={i} className={`font-normal ${isSelected ? 'text-white/70' : 'text-gray-500'}`}>{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 overflow-hidden">
      
      {/* FILTER HEADER */}
      <div className="flex-none p-3 bg-gray-900/95 backdrop-blur border-b border-gray-800 z-10 flex flex-wrap gap-3 items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Source</span>
            <select 
                value={filterOwner}
                onChange={(e) => setFilterOwner(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-xs text-white rounded px-2 py-1 focus:outline-none focus:border-plex-orange cursor-pointer hover:bg-gray-750"
            >
                <option value="All">All Owners</option>
                {availableOwners.map(owner => (
                    <option key={owner} value={owner}>{owner}</option>
                ))}
            </select>
        </div>

        {hostUser && (
            <button
                onClick={() => setMissingOnly(!missingOnly)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold transition-all border ${
                    missingOnly 
                        ? 'bg-purple-600 border-purple-500 text-white shadow-lg' 
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                }`}
                title="Show only items I do NOT have"
            >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span>Missing</span>
            </button>
        )}
      </div>

      {/* LIST CONTENT */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 custom-scrollbar">
        {displayedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-500">
             <p>No media found.</p>
             {missingOnly && <p className="text-xs mt-1">Try turning off 'Missing' filter.</p>}
          </div>
        ) : (
          displayedItems.map((item) => {
            const versionCount = item.files.length;
            const is4K = item.files.some(f => get4KFormat(f.rawFilename));
            const remuxTag = item.files.map(f => getRemuxFormat(f.rawFilename)).find(t => t !== null);
            
            // --- CLEANING & METADATA LOGIC ---
            
            // 1. Extract Edition
            const editionMatch = item.name.match(/\{edition-([^}]+)\}/i);
            const editionName = editionMatch ? editionMatch[1] : null;

            // 2. Base Cleanup (Remove Extension & Edition Tag)
            let cleanTitle = item.name
                .replace(/\.[^/.]+$/, "") // Remove .mkv or .mp4
                .replace(/\{edition-[^}]+\}/i, '') // Remove {edition...}
                .trim();

            // 3. STOP AT YEAR LOGIC
            const yearMatch = cleanTitle.match(/^(.*?\(\d{4}\))/);
            if (yearMatch) {
                cleanTitle = yearMatch[1];
            }

            // 4. QUALITIES FILTER
            const qualities = Array.from(new Set(
              item.files
                .map(f => item.type === 'Music' ? getAudioFormat(f.rawFilename) : f.quality)
                .filter((q): q is string => {
                    if (typeof q !== 'string' || q.trim().length === 0) return false;
                    if (is4KQualityString(q)) return false;
                    if (remuxTag && (q === '1080p' || q === '1080i')) return false;
                    return true;
                })
            )).slice(0, 3);
            
            const owners = Array.from(new Set(item.files.map(f => f.owner))).sort();
            const is3D = item.files.some(f => get3DFormat(f.rawFilename));

            let albumCount = 0;
            let isAlbumView = false;
            let artistName = "";
            
            if (item.type === 'Music') {
              const albums = new Set(item.files.map(f => getMusicMetadata(f.path).album));
              albumCount = albums.size;
              const firstAlbum = albums.values().next().value;
              if (albumCount === 1 && item.name === firstAlbum) {
                 isAlbumView = true;
                 artistName = getMusicMetadata(item.files[0].path).artist;
              }
            }

            // --- STYLING LOGIC: OWNED vs MISSING ---
            const isMissingItem = hostUser && !owners.includes(hostUser);
            
            // Determine Background & Text Classes
            let bgClass = "";
            let textClass = "";
            
            if (selectedId === item.id) {
                // SELECTED (Always wins)
                bgClass = "bg-plex-orange text-white shadow-lg scale-[1.01]";
                textClass = "text-white"; 
            } else if (isMissingItem) {
                // MISSING (Darker Background, Dimmed Text)
                bgClass = "bg-gray-800/40 hover:bg-gray-800/60";
                textClass = "text-gray-400"; // Dimmed from normal white/gray
            } else {
                // OWNED (Standard)
                bgClass = "bg-gray-800 hover:bg-gray-700";
                textClass = "text-gray-200";
            }

            // Borders are gone, we use background/opacity to distinguish
            const borderClass = 'border border-transparent';

            return (
              <button
                key={item.id}
                onClick={() => onSelect(item)}
                className={`w-full flex items-center p-3 rounded-lg text-left transition-all duration-200 group ${borderClass} ${bgClass} ${textClass}`}
              >
                <div className={`p-2 rounded-full mr-4 ${selectedId === item.id ? 'bg-white/20' : 'bg-gray-700 group-hover:bg-gray-600'}`}>
                  {getIcon(item.type, isAlbumView)}
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold flex items-center gap-2 overflow-hidden">
                    <span className="flex items-center gap-1 truncate">
                        {renderName(cleanTitle, selectedId === item.id)}
                    </span>
                    
                    {editionName && (
                       <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap flex-none
                         ${selectedId === item.id 
                           ? 'border-cyan-300 bg-cyan-600 text-white' 
                           : 'border-cyan-500 text-cyan-300 bg-cyan-900/40 shadow-[0_0_8px_rgba(34,211,238,0.3)]'}`}>
                         {editionName}
                       </span>
                    )}

                    {isAlbumView && (
                      <span className={`text-xs font-normal truncate ${selectedId === item.id ? 'text-white/70' : 'text-gray-500'}`}>
                        by {artistName}
                      </span>
                    )}
                  </h3>
                  
                  <div className="flex items-center gap-1 mt-0.5">
                     <svg className={`w-3 h-3 ${selectedId === item.id ? 'text-green-300' : 'text-green-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                     </svg>
                     <p className={`text-xs truncate font-bold ${selectedId === item.id ? 'text-green-100' : 'text-green-400'}`}>
                       {owners.join(', ')}
                     </p>
                  </div>

                  <p className={`text-[10px] truncate flex gap-2 mt-0.5 ${selectedId === item.id ? 'text-white/60' : 'text-gray-500'}`}>
                    <span>{item.type}</span>
                    {item.type === 'TV Show' && <span>• {versionCount} Ep/Files</span>}
                    {item.type === 'Music' && <span>• {isAlbumView ? 'Album' : `${albumCount} Albums`}</span>}
                    {item.type !== 'TV Show' && item.type !== 'Music' && versionCount > 1 && (
                      <span className="font-bold">• {versionCount} Versions</span>
                    )}
                  </p>
                </div>

                <div className="flex flex-row items-center ml-2 gap-1">
                  
                  {remuxTag && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap shadow-sm 
                        ${is4K 
                            ? (selectedId === item.id ? 'border-purple-300 bg-purple-600 text-white' : 'border-purple-500 text-purple-300 bg-purple-900/40')
                            : (selectedId === item.id ? 'border-blue-300 bg-blue-600 text-white' : 'border-blue-500 text-blue-300 bg-blue-900/40')
                        }`}>
                        {remuxTag}
                    </span>
                  )}

                  {is4K && !remuxTag && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${selectedId === item.id ? 'border-black/20 bg-black/20 text-white' : 'border-plex-orange bg-plex-orange text-black'}`}>4K UHD</span>
                  )}
                  
                  {is3D && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap 
                        ${selectedId === item.id 
                            ? 'border-emerald-300 bg-emerald-600 text-white' 
                            : 'border-emerald-500 text-emerald-300 bg-emerald-900/40 shadow-[0_0_8px_rgba(52,211,153,0.3)]'}`}>
                        3D
                    </span>
                  )}

                  {qualities.map((q, i) => {
                    const isFlac = q.toUpperCase() === 'FLAC';
                    const defaultStyle = selectedId === item.id ? 'border-white/40 bg-white/10' : 'border-gray-600 bg-gray-700 text-gray-400';
                    const flacStyle = selectedId === item.id ? 'border-yellow-300 bg-yellow-600 text-white' : 'border-yellow-500 text-yellow-400 bg-yellow-900/40';
                    return (
                      <span key={i} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${isFlac ? flacStyle : defaultStyle}`}>
                        {q}
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default MediaList;