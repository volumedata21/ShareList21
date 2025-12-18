import React from 'react';
import { MediaItem } from '../types';
import { get3DFormat, get4KFormat, is4KQualityString, getMusicMetadata, getAudioFormat, getRemuxFormat } from '../utils/mediaUtils';

interface MediaListProps {
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  selectedId?: string;
}

const getIcon = (type: string, isAlbum = false) => {
  switch (type) {
    case 'Movie': return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>
    );
    case 'TV Show': return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
    );
    case 'Music': 
      if (isAlbum) {
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
        );
      }
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
      );
    default: return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
    );
  }
};

const MediaList: React.FC<MediaListProps> = ({ items, onSelect, selectedId }) => {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <p className="text-lg">No media found matching your filters.</p>
      </div>
    );
  }

  const renderName = (name: string, isSelected: boolean) => {
    const parts = name.split(/(\(\d{4}\))/g);
    return parts.map((part, i) => {
      if (/^\(\d{4}\)$/.test(part)) {
        return (
          <span 
            key={i} 
            className={`font-normal ${isSelected ? 'text-white/70' : 'text-gray-500'}`}
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2 pb-24 lg:pb-4">
      {items.map((item) => {
        const versionCount = item.files.length;
        
        const is4K = item.files.some(f => get4KFormat(f.rawFilename));
        
        // Check for REMUX across all versions
        const remuxTag = item.files
          .map(f => getRemuxFormat(f.rawFilename))
          .find(t => t !== null); // Grab the first one found, usually implies highest quality available

        const qualities = Array.from(new Set(
          item.files
            .map(f => {
               if (item.type === 'Music') return getAudioFormat(f.rawFilename);
               return f.quality;
            })
            .filter((q): q is string => typeof q === 'string' && !is4KQualityString(q))
        )).slice(0, 3);
        
        const owners = Array.from(new Set(item.files.map(f => f.owner))).sort().join(', ');
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

        return (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className={`w-full flex items-center p-3 rounded-lg text-left transition-colors duration-200 group
              ${selectedId === item.id 
                ? 'bg-plex-orange text-white shadow-lg' 
                : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
              }`}
          >
            <div className={`p-2 rounded-full mr-4 ${selectedId === item.id ? 'bg-white/20' : 'bg-gray-700 group-hover:bg-gray-600'}`}>
              {getIcon(item.type, isAlbumView)}
            </div>
            
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold truncate flex items-center gap-2">
                <span className="flex items-center gap-1">
                  {renderName(item.name, selectedId === item.id)}
                </span>

                {isAlbumView && (
                  <span className={`text-xs font-normal ${selectedId === item.id ? 'text-white/70' : 'text-gray-500'}`}>
                    by {artistName}
                  </span>
                )}
              </h3>
              
              <div className="flex items-center gap-1 mt-0.5">
                 <svg className={`w-3 h-3 ${selectedId === item.id ? 'text-green-300' : 'text-green-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                 </svg>
                 <p className={`text-xs truncate font-bold ${selectedId === item.id ? 'text-green-100' : 'text-green-400'}`}>
                   {owners}
                 </p>
              </div>

              <p className={`text-[10px] truncate flex gap-2 mt-0.5 ${selectedId === item.id ? 'text-white/60' : 'text-gray-500'}`}>
                <span>{item.type}</span>
                {item.type === 'TV Show' && (
                   <span>• {versionCount} Ep/Files</span>
                )}
                {item.type === 'Music' && (
                   <span>• {isAlbumView ? 'Album' : `${albumCount} Albums`}</span>
                )}
                {item.type !== 'TV Show' && item.type !== 'Music' && versionCount > 1 && (
                  <span className="font-bold">• {versionCount} Versions</span>
                )}
              </p>
            </div>

            <div className="flex flex-row items-center ml-2 gap-1">
              
              {/* NEW: REMUX Tag (Highest Priority) */}
              {remuxTag && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap shadow-sm
                  ${selectedId === item.id 
                    ? 'border-purple-300 bg-purple-600 text-white' 
                    : 'border-purple-500 text-purple-300 bg-purple-900/40'}`}>
                  {remuxTag}
                </span>
              )}

              {/* Only show 4K badge if it's NOT a Remux (avoid double badging) */}
              {is4K && !remuxTag && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap
                  ${selectedId === item.id 
                    ? 'border-black/20 bg-black/20 text-white' 
                    : 'border-plex-orange bg-plex-orange text-black'
                  }`}>
                  4K UHD
                </span>
              )}

              {is3D && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap
                  ${selectedId === item.id ? 'border-blue-300 bg-blue-500/50 text-white' : 'border-blue-500 text-blue-400 bg-blue-900/30'}`}>
                  3D
                </span>
              )}

              {qualities.map((q, i) => (
                <span key={i} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap
                  ${selectedId === item.id ? 'border-white/40 bg-white/10' : 'border-gray-600 bg-gray-700 text-gray-400'}`}>
                  {q}
                </span>
              ))}
              
              {qualities.length === 0 && !is3D && !is4K && !remuxTag && (
                 <span className={`text-[9px] px-1.5 py-0.5 rounded border 
                 ${selectedId === item.id ? 'border-white/20' : 'border-gray-700 text-gray-600'}`}>
                   STD
                 </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default MediaList;