import React, { useMemo, useState } from 'react';
import { MediaItem } from '../types';

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
  count24h: number;
  count7d: number;
  count30d: number;
  count365d: number;
}

// --- HELPER: Massive Hero Avatar ---
const HeroAvatar = ({ user, rank }: { user: string, rank: number }) => {
  const [imgError, setImgError] = useState(false);

  // Generate distinct gradients based on user string
  const getGradient = (str: string) => {
    const gradients = [
      'from-red-500 to-orange-600',
      'from-blue-500 to-cyan-600',
      'from-emerald-500 to-green-600',
      'from-purple-500 to-pink-600',
      'from-indigo-500 to-purple-600',
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return gradients[Math.abs(hash) % gradients.length];
  };

  return (
    <div className="relative group shrink-0">
        {/* Glow Layer */}
        <div className={`absolute -inset-1 rounded-[2rem] bg-gradient-to-br ${getGradient(user)} opacity-20 blur-xl group-hover:opacity-40 transition-opacity duration-500`}></div>
        
        {/* Image Container */}
        <div className="relative w-40 h-40 sm:w-48 sm:h-48 rounded-[2rem] overflow-hidden shadow-2xl ring-1 ring-white/10 bg-gray-800">
            {!imgError ? (
                <img 
                    src={`/api/avatar/${user}`} 
                    alt={user} 
                    className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-700 ease-in-out" 
                    onError={() => setImgError(true)} 
                />
            ) : (
                <div className={`w-full h-full flex flex-col items-center justify-center bg-gradient-to-br ${getGradient(user)}`}>
                    <span className="text-6xl font-black text-white/90 drop-shadow-md">
                        {user.charAt(0).toUpperCase()}
                    </span>
                </div>
            )}
            
            {/* Gloss Overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-black/20 via-white/5 to-transparent pointer-events-none"></div>
        </div>

        {/* Rank Badge */}
        <div className="absolute -top-3 -left-3 w-10 h-10 flex items-center justify-center rounded-full bg-gray-900 border border-white/10 shadow-lg z-10">
            <span className={`font-bold text-lg ${rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-gray-300' : rank === 3 ? 'text-amber-600' : 'text-gray-500'}`}>
                #{rank}
            </span>
        </div>
    </div>
  );
};

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
      item.files.forEach(f => {
        const s = getUser(f.owner);
        s.totalFiles++;

        // Activity Buckets
        const age = now - f.lastModified;
        if (age < oneDay) s.count24h++;
        if (age < oneDay * 7) s.count7d++;
        if (age < oneDay * 30) s.count30d++;
        if (age < oneDay * 365) s.count365d++;
      });

      // Type Counts (Item level owners)
      // Since an item can have multiple files from multiple owners, we iterate files above.
      // But for distinct Movies/Shows, we roughly approximate based on who has files for it.
      const itemOwners = new Set(item.files.map(f => f.owner));
      itemOwners.forEach(owner => {
        const s = getUser(owner);
        if (item.type === 'Movie') s.movies++;
        if (item.type === 'TV Show') s.tvShows.add(item.name);
        if (item.type === 'Music') {
             // Basic estimation for albums
             s.albums.add(item.name);
        }
      });
      
      // Episodes count
      if (item.type === 'TV Show') {
          item.files.forEach(f => {
              const s = getUser(f.owner);
              s.episodes++;
          });
      }
    });

    return map;
  }, [items]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity" onClick={onClose}></div>
      
      <div className="relative w-full max-w-4xl bg-gray-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-white/5 bg-gradient-to-r from-gray-900 to-black flex justify-between items-center z-10 shrink-0">
          <div>
            <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500">
              NETWORK STATS
            </h2>
            <p className="text-gray-500 text-sm font-medium mt-1">
              Global contribution leaderboard
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          
          <div className="grid grid-cols-1 gap-6">
            {Array.from(stats.entries())
                .sort((a,b) => b[1].totalFiles - a[1].totalFiles)
                .map(([owner, s], index) => {
              
              const rank = index + 1;
              const isTop = rank === 1;

              return (
                <div key={owner} className={`relative overflow-hidden rounded-[2.5rem] p-6 border transition-all duration-300 ${isTop ? 'bg-gradient-to-r from-gray-800 to-gray-900 border-yellow-500/20' : 'bg-gray-900/40 border-white/5 hover:border-white/10'}`}>
                  {isTop && <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>}

                  <div className="flex flex-col sm:flex-row gap-8 items-center sm:items-start">
                    
                    {/* MASSIVE AVATAR */}
                    <HeroAvatar user={owner} rank={rank} />

                    {/* Stats Grid */}
                    <div className="flex-1 w-full min-w-0">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
                           {owner}
                           {isTop && <span className="px-2 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 font-bold uppercase tracking-wider">Top Contributor</span>}
                        </h3>
                        <div className="text-right">
                           <div className="text-sm text-gray-400 font-bold uppercase tracking-widest">Total Share</div>
                           <div className="text-2xl font-black text-white">{s.totalFiles.toLocaleString()} <span className="text-sm font-medium text-gray-600">Files</span></div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatBox 
                          label="Movies" 
                          value={s.movies} 
                          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>}
                        />
                        <StatBox 
                          label="Shows" 
                          value={s.tvShows.size} 
                          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>}
                        />
                         <StatBox 
                          label="Episodes" 
                          value={s.episodes} 
                          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                        />
                         <StatBox 
                          label="Music" 
                          value={s.albums.size} 
                          icon={<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>}
                        />
                      </div>
                      
                      {/* Activity Bar */}
                      <div className="mt-4 pt-4 border-t border-white/5">
                        <div className="flex justify-between items-center mb-2">
                           <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Recent Activity</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-center">
                            <ActivityPill label="24h" count={s.count24h} />
                            <ActivityPill label="7d" count={s.count7d} />
                            <ActivityPill label="30d" count={s.count30d} />
                            <ActivityPill label="Year" count={s.count365d} />
                        </div>
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

const StatBox = ({ label, value, icon }: { label: string, value: number, icon: any }) => (
    <div className="bg-black/20 rounded-xl p-3 border border-white/5 flex flex-col items-center justify-center gap-1 group hover:bg-white/5 transition-colors">
        <div className="text-gray-500 group-hover:text-white transition-colors">{icon}</div>
        <div className="text-xl font-bold text-white">{value}</div>
        <div className="text-[10px] text-gray-500 uppercase font-bold">{label}</div>
    </div>
);

const ActivityPill = ({ label, count }: { label: string, count: number }) => (
    <div className={`rounded-lg p-2 border ${count > 0 ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-transparent border-white/5 text-gray-600'}`}>
        <div className="text-lg font-bold leading-none">{count}</div>
        <div className="text-[9px] font-bold opacity-60 mt-1">{label}</div>
    </div>
);

export default StatsModal;