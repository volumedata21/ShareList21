import React from 'react';
import { MediaItem } from '../types';
import { formatBytes } from '../utils/mediaUtils';

interface MediaListProps {
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  selectedId?: string;
}

const MediaList: React.FC<MediaListProps> = ({ items, onSelect, selectedId }) => {
  
  // Safety Guard: Handle empty or missing items
  if (!items || items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
        <svg className="w-16 h-16 mb-4 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
        </svg>
        <p>No media found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 md:p-4 scrollbar-thin">
      <div className="grid grid-cols-1 gap-2">
        {items.map((item) => {
          // Safety Checks
          const files = item.files || [];
          const totalSize = files.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
          const isSelected = item.id === selectedId;
          
          // Badge Detection
          const has4k = files.some(f => f.quality && (f.quality.includes('4k') || f.quality.includes('2160')));
          const has3d = files.some(f => f.quality === '3D');
          
          return (
            <div 
              key={item.id}
              onClick={() => onSelect(item)}
              className={`
                group p-3 md:p-4 rounded-lg cursor-pointer border transition-all duration-200
                ${isSelected 
                  ? 'bg-plex-orange/10 border-plex-orange shadow-[0_0_15px_rgba(229,160,13,0.1)]' 
                  : 'bg-gray-800 border-gray-700 hover:bg-gray-750 hover:border-gray-600'
                }
              `}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3 overflow-hidden">
                  {/* Type Icon */}
                  <div className={`
                    w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm transition-colors
                    ${isSelected ? 'bg-plex-orange text-black' : 'bg-gray-700 text-gray-400 group-hover:bg-gray-600 group-hover:text-white'}
                  `}>
                    {item.type === 'Movie' ? 'M' : item.type === 'TV Show' ? 'TV' : 'Au'}
                  </div>
                  
                  <div className="min-w-0">
                    <h3 className={`font-bold truncate ${isSelected ? 'text-plex-orange' : 'text-gray-200'}`}>
                      {item.name}
                    </h3>
                    <div className="text-xs text-gray-500 flex gap-2 items-center">
                      <span>{files.length} File{files.length !== 1 && 's'}</span>
                      <span className="w-1 h-1 bg-gray-600 rounded-full"></span>
                      <span>{item.type}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 flex flex-col items-end gap-1">
                  <div className="font-mono text-sm text-gray-400 group-hover:text-gray-300">
                    {formatBytes(totalSize)}
                  </div>
                  
                  <div className="flex gap-1">
                    {/* 3D Badge */}
                    {has3d && (
                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold bg-blue-900/30 text-blue-400 rounded border border-blue-500/50">
                        3D
                      </span>
                    )}

                    {/* 4K Badge */}
                    {has4k && (
                      <span className="inline-block px-1.5 py-0.5 text-[10px] font-bold bg-gray-700 text-plex-orange rounded border border-gray-600">
                        4K
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MediaList;