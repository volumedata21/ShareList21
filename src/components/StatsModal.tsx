import React, { useMemo } from 'react';
import { MediaItem } from '../types';
import { getMusicMetadata } from '../utils/mediaUtils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  items: MediaItem[];
}

interface UserStats {
  totalFiles: number;
  movies: number;
  tvShows: Set<string>;
  episodes: number;
  albums: Set<string>;
  // Dynamic Time Buckets
  count24h: number;
  count7d: number;
  count30d: number;
  count365d: number;
}

const StatsModal: React.FC<Props> = ({ isOpen, onClose, items }) => {
  if (!isOpen) return null;

  // --- THE MATH ENGINE ---
  const stats = useMemo(() => {
    const map = new Map<string, UserStats>();
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    const getUser = (owner: string) => {
      if (!map.has(owner)) {
        map.set(owner, {
          totalFiles: 0,
          movies: 0,
          tvShows: new Set(),
          episodes: 0,
          albums: new Set(),
          count24h: 0,
          count7d: 0,
          count30d: 0,
          count365d: 0
        });
      }
      return map.get(owner)!;
    };

    items.forEach(item => {
      item.files.forEach(file => {
        const s = getUser(file.owner);
        s.totalFiles++;
        
        // Time Bucket Logic
        const age = now - file.lastModified;
        if (age < oneDay) s.count24h++;
        if (age < oneDay * 7) s.count7d++;
        if (age < oneDay * 30) s.count30d++;
        if (age < oneDay * 365) s.count365d++;
        
        if (item.type === 'Movie') {
          s.movies++;
        } else if (item.type === 'TV Show') {
          s.episodes++;
          s.tvShows.add(item.name);
        } else if (item.type === 'Music') {
          try {
             const { album } = getMusicMetadata(file.path);
             s.albums.add(album || 'Unknown');
          } catch (e) { s.albums.add('Unknown'); }
        }
      });
    });
    return map;
  }, [items]);

  const users = Array.from(stats.keys()).sort();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300" onClick={onClose}>
      <div 
        className="bg-[#0a0a0a] border border-white/10 w-full max-w-5xl rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col max-h-[90vh]" 
        onClick={e => e.stopPropagation()}
      >
        
        {/* Header */}
        <div className="bg-white/5 border-b border-white/5 p-6 flex justify-between items-center backdrop-blur-xl">
          <div>
            <h2 className="text-2xl font-semibold text-white tracking-tight flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-plex-orange to-yellow-600 rounded-lg shadow-lg shadow-orange-500/20">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              Network Overview
            </h2>
            <p className="text-gray-400 text-sm mt-1 font-medium pl-1">
              Active Nodes: <span className="text-white">{users.length}</span>
            </p>
          </div>
          
          <button 
            onClick={onClose} 
            className="group p-2 rounded-full hover:bg-white/10 transition-colors border border-transparent hover:border-white/5"
          >
            <svg className="w-6 h-6 text-gray-500 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto custom-scrollbar bg-gradient-to-b from-[#0a0a0a] to-[#111]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {users.map(user => {
              const s = stats.get(user)!;
              const hue = user.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
              const primaryColor = `hsl(${hue}, 75%, 60%)`;

              // --- DYNAMIC RECENT LABEL LOGIC ---
              let recentValue = 0;
              let recentLabel = "No recent activity";
              let recentColor = "text-gray-600";
              
              if (s.count24h > 0) {
                recentValue = s.count24h;
                recentLabel = "files today";
                recentColor = "text-emerald-400"; // Green for hot activity
              } else if (s.count7d > 0) {
                recentValue = s.count7d;
                recentLabel = "files this week";
                recentColor = "text-white"; // White for active
              } else if (s.count30d > 0) {
                recentValue = s.count30d;
                recentLabel = "files this month";
                recentColor = "text-blue-300"; // Blue for standard
              } else if (s.count365d > 0) {
                recentValue = s.count365d;
                recentLabel = "files this year";
                recentColor = "text-gray-400"; // Gray for cold
              }

              return (
                <div 
                  key={user} 
                  className="bg-white/[0.02] rounded-2xl p-1 border border-white/5 shadow-lg relative group transition-all hover:bg-white/[0.04] hover:-translate-y-1 duration-300"
                >
                  <div className="h-full bg-[#111]/50 rounded-xl p-5 backdrop-blur-sm relative overflow-hidden flex flex-col justify-between">
                    
                    <div>
                        {/* Subtle Top Gradient Line */}
                        <div className="absolute top-0 left-0 w-full h-1 opacity-50" style={{ background: `linear-gradient(90deg, transparent, ${primaryColor}, transparent)` }}></div>
                        
                        {/* User Header */}
                        <div className="flex items-center gap-4 mb-6">
                        <div 
                            className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold text-white shadow-lg relative overflow-hidden border border-white/10"
                            style={{ background: `linear-gradient(135deg, ${primaryColor}, hsl(${hue}, 60%, 30%))` }}
                        >
                            {user.charAt(0).toUpperCase()}
                            <div className="absolute top-0 left-0 w-full h-1/2 bg-white/20 blur-[1px]"></div>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white tracking-wide">{user}</h3>
                            <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            <span className="text-xs font-mono text-gray-400 uppercase tracking-wider">Online</span>
                            </div>
                        </div>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 gap-3 mb-6">
                        <StatBox 
                            label="Movies" 
                            value={s.movies} 
                            icon={<path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />} 
                        />
                        <StatBox 
                            label="TV Series" 
                            value={s.tvShows.size} 
                            icon={<path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />} 
                        />
                        <StatBox 
                            label="Episodes" 
                            value={s.episodes} 
                            icon={<path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />} 
                            subtle 
                        />
                        <StatBox 
                            label="Albums" 
                            value={s.albums.size} 
                            icon={<path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />} 
                            subtle 
                        />
                        </div>
                    </div>

                    {/* Footer / Recent Activity */}
                    <div className="flex items-center justify-between pt-4 border-t border-white/5">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Recent Activity</span>
                        <div className="flex items-baseline gap-1 mt-0.5">
                          {recentValue > 0 ? (
                              <>
                                <span className={`text-lg font-mono font-medium ${recentColor}`}>
                                    +{recentValue}
                                </span>
                                <span className="text-xs text-gray-500">{recentLabel}</span>
                              </>
                          ) : (
                              <span className="text-xs text-gray-600 font-mono">No recent uploads</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-right">
                         <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest block mb-0.5">Total Library</span>
                         <span className="text-xs font-mono text-gray-300 bg-white/5 px-2 py-1 rounded border border-white/5">
                           {s.totalFiles.toLocaleString()} Items
                         </span>
                      </div>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- SUB-COMPONENT ---
const StatBox: React.FC<{ label: string; value: number; icon: React.ReactNode; subtle?: boolean }> = ({ label, value, icon, subtle }) => (
  <div className={`rounded-lg p-3 border flex flex-col justify-between h-20 transition-all ${subtle ? 'bg-transparent border-white/5 text-gray-500 hover:border-white/10 hover:bg-white/[0.02]' : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06] hover:border-white/20'}`}>
    <div className="flex justify-between items-start">
      <span className={`text-[10px] font-bold uppercase tracking-wider ${subtle ? 'text-gray-600' : 'text-gray-400'}`}>{label}</span>
      <svg className={`w-4 h-4 ${subtle ? 'text-gray-700' : 'text-gray-500'} opacity-80`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        {icon}
      </svg>
    </div>
    <span className={`text-2xl font-light tracking-tight ${value === 0 ? 'text-gray-700' : 'text-white'}`}>
      {value.toLocaleString()}
    </span>
  </div>
);

export default StatsModal;