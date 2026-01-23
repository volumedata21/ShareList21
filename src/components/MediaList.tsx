import React, { useState, useEffect, useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { MediaItem, AppConfig } from '../types';
import { get3DFormat, get4KFormat, is4KQualityString, getMusicMetadata, getAudioFormat, getRemuxFormat } from '../utils/mediaUtils';

interface MediaListProps {
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  selectedId?: string;
}

// --- HELPER: Owner Avatar Button ---
const OwnerAvatar = ({ 
  user, 
  isActive, 
  isDimmed, 
  onClick 
}: { 
  user: string; 
  isActive: boolean; 
  isDimmed: boolean; 
  onClick: () => void 
}) => {
  const [imgError, setImgError] = useState(false);

  // Generate color for fallback initials
  const getColor = (str: string) => {
    const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <button 
      onClick={onClick}
      className={`group flex flex-col items-center gap-1.5 transition-all duration-300 ${isDimmed ? 'opacity-40 grayscale hover:opacity-70 hover:grayscale-0' : 'opacity-100 scale-105'}`}
    >
      <div className={`relative w-11 h-11 rounded-2xl p-0.5 transition-all ${isActive ? 'bg-gradient-to-br from-orange-400 to-red-500 shadow-lg shadow-orange-500/20' : 'bg-transparent'}`}>
        <div className="w-full h-full rounded-[14px] overflow-hidden bg-gray-800 relative border border-white/10">
          {!imgError ? (
            <img 
              src={`/api/avatar/${user}`} 
              alt={user} 
              className="w-full h-full object-cover" 
              onError={() => setImgError(true)} 
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center text-white font-bold text-sm ${getColor(user)}`}>
              {user.charAt(0).toUpperCase()}
            </div>
          )}
          
          {/* Active Gloss */}
          {isActive && <div className="absolute inset-0 bg-white/10 pointer-events-none"></div>}
        </div>

        {/* Status Dot */}
        <div className="absolute -bottom-0.5 -right-0.5 bg-gray-900 rounded-full p-0.5">
           <div className="w-2.5 h-2.5 bg-green-500 rounded-full border border-gray-900 shadow-sm"></div>
        </div>
      </div>
      
      <span className={`text-[10px] font-bold tracking-wide truncate max-w-[60px] transition-colors ${isActive ? 'text-white' : 'text-gray-500 group-hover:text-gray-300'}`}>
        {user}
      </span>
    </button>
  );
};


const getIcon = (type: string, isAlbum = false) => {
  switch (type) {
    case 'Movie': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>;
    case 'TV Show': return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
    case 'Music': return isAlbum 
      ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg> // Library Icon
      : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>; // Music Note
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

  // Split owners into "Host" vs "Others"
  const ownerGroups = useMemo(() => {
    const others = new Set<string>();
    items.forEach(m => m.files.forEach(f => {
      if (f.owner !== hostUser) others.add(f.owner);
    }));
    return {
      host: hostUser,
      others: Array.from(others).sort()
    };
  }, [items, hostUser]);

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

  // --- ROW COMPONENT ---
  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const item = displayedItems[index];
    if (!item) return null;

    const versionCount = item.files.length;
    const is4K = item.files.some(f => get4KFormat(f.rawFilename));
    
    // --- MULTI-REMUX BADGE LOGIC ---
    const allRemuxes = item.files
        .filter(f => getRemuxFormat(f.rawFilename) !== null)
        .map(f => ({
            label: getRemuxFormat(f.rawFilename)!,
            is4K: get4KFormat(f.rawFilename)
        }));

    const uniqueRemuxes: { label: string, is4K: boolean }[] = [];
    const seenRemux = new Set<string>();
    allRemuxes.forEach(r => {
        const key = `${r.label}-${r.is4K}`;
        if (!seenRemux.has(key)) {
            seenRemux.add(key);
            uniqueRemuxes.push(r);
        }
    });

    const has4KRemux = uniqueRemuxes.some(r => r.is4K);

    // --- 3D FORMAT LOGIC ---
    const threeDTags = Array.from(new Set(
        item.files.map(f => get3DFormat(f.rawFilename)).filter((f): f is string => f !== null)
    ));

    // --- CLEANING LOGIC ---
    const editionMatch = item.name.match(/\{edition-([^}]+)\}/i);
    const editionName = editionMatch ? editionMatch[1] : null;

    let cleanTitle = item.name
        .replace(/\.[^/.]+$/, "") 
        .replace(/\{edition-[^}]+\}/i, '') 
        .trim();

    const yearMatch = cleanTitle.match(/^(.*?\(\d{4}\))/);
    if (yearMatch) {
        cleanTitle = yearMatch[1];
    }

    const qualities = Array.from(new Set(
      item.files
        .map(f => item.type === 'Music' ? getAudioFormat(f.rawFilename) : f.quality)
        .filter((q): q is string => {
            if (typeof q !== 'string' || q.trim().length === 0) return false;
            if (is4KQualityString(q)) return false;
            if (uniqueRemuxes.length > 0 && (q === '1080p' || q === '1080i')) return false;
            if (q === '3D') return false; 
            return true;
        })
    )).slice(0, 3);
    
    const owners = Array.from(new Set(item.files.map(f => f.owner))).sort();

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

    const isMissingItem = hostUser && !owners.includes(hostUser);
    
    let cardStyle = "";
    if (selectedId === item.id) {
        cardStyle = "bg-gray-800 border-plex-orange text-white shadow-lg z-10";
    } else if (isMissingItem) {
        cardStyle = "bg-gray-800/40 border-transparent text-gray-400 hover:bg-gray-800/60";
    } else {
        cardStyle = "bg-gray-800 border-transparent text-gray-200 hover:bg-gray-700";
    }

    return (
      <div style={style} className="px-4 py-1">
        <button
          onClick={() => onSelect(item)}
          className={`w-full h-full flex items-center p-3 rounded-lg text-left transition-all duration-200 group border ${cardStyle}`}
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
            
            {uniqueRemuxes.map((badge, idx) => (
              <span key={idx} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap shadow-sm 
                  ${badge.is4K 
                      ? (selectedId === item.id ? 'border-purple-300 bg-purple-600 text-white' : 'border-purple-500 text-purple-300 bg-purple-900/40')
                      : (selectedId === item.id ? 'border-blue-300 bg-blue-600 text-white' : 'border-blue-500 text-blue-300 bg-blue-900/40')
                  }`}>
                  {badge.label}
              </span>
            ))}

            {is4K && !has4KRemux && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${selectedId === item.id ? 'border-black/20 bg-black/20 text-white' : 'border-plex-orange bg-plex-orange text-black'}`}>4K UHD</span>
            )}
            
            {threeDTags.map((tag, idx) => (
              <span key={`3d-${idx}`} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap 
                  ${selectedId === item.id 
                      ? 'border-emerald-300 bg-emerald-600 text-white' 
                      : 'border-emerald-500 text-emerald-300 bg-emerald-900/40 shadow-[0_0_8px_rgba(52,211,153,0.3)]'}`}>
                  {tag}
              </span>
            ))}

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
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 overflow-hidden">
      
      {/* FILTER HEADER (With New Avatar Row) */}
      <div className="flex-none p-3 bg-gray-900/95 backdrop-blur border-b border-gray-800 z-10 flex flex-col gap-3 shadow-md">
        
        {/* AVATAR ROW */}
        <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide px-1">
          {/* 1. Host User (Me) */}
          {ownerGroups.host && (
            <OwnerAvatar 
              user={ownerGroups.host}
              isActive={filterOwner === ownerGroups.host}
              isDimmed={filterOwner !== 'All' && filterOwner !== ownerGroups.host}
              onClick={() => setFilterOwner(filterOwner === ownerGroups.host ? 'All' : ownerGroups.host)}
            />
          )}

          {/* 2. Divider (Only if there are other users) */}
          {ownerGroups.host && ownerGroups.others.length > 0 && (
             <div className="w-px h-10 bg-gradient-to-b from-transparent via-gray-700 to-transparent mx-1 flex-shrink-0"></div>
          )}

          {/* 3. Other Users */}
          {ownerGroups.others.map(user => (
            <OwnerAvatar 
              key={user}
              user={user}
              isActive={filterOwner === user}
              isDimmed={filterOwner !== 'All' && filterOwner !== user}
              onClick={() => setFilterOwner(filterOwner === user ? 'All' : user)}
            />
          ))}

          {/* 4. "Missing" Toggle (Moved to right side of avatar bar) */}
          {hostUser && (
              <button
                  onClick={() => setMissingOnly(!missingOnly)}
                  className={`ml-auto flex flex-col items-center gap-1 group transition-all ${missingOnly ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}
                  title="Show only items I do NOT have"
              >
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border transition-all ${
                     missingOnly 
                        ? 'bg-purple-600 border-purple-400 text-white shadow-[0_0_15px_rgba(147,51,234,0.4)]' 
                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500'
                  }`}>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                  </div>
                  <span className={`text-[10px] font-bold tracking-wide ${missingOnly ? 'text-purple-300' : 'text-gray-600 group-hover:text-gray-400'}`}>
                      Missing
                  </span>
              </button>
          )}
        </div>
      </div>

      {/* LIST CONTENT - VIRTUALIZED */}
      <div className="flex-1 min-h-0 custom-scrollbar">
        {displayedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-500">
             <p>No media found.</p>
             {missingOnly && <p className="text-xs mt-1">Try turning off 'Missing' filter.</p>}
          </div>
        ) : (
          <AutoSizer>
            {({ height, width }) => (
              <List
                height={height}
                width={width}
                itemCount={displayedItems.length}
                itemSize={84} // 84px height per row
                className="custom-scrollbar"
              >
                {Row}
              </List>
            )}
          </AutoSizer>
        )}
      </div>
    </div>
  );
};

export default MediaList;