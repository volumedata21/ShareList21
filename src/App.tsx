import React, { useState, useEffect, useMemo } from 'react';
import { MediaItem, MediaFile, FilterType, AppConfig } from '../types';
import { fuzzyMatch, cleanName, getMediaType, getSeriesName, getMusicMetadata } from './utils/mediaUtils';
import MediaList from './components/MediaList';
import MediaDetail from './components/MediaDetail';
import DownloadManager from './components/DownloadManager'; // NEW IMPORT

const App: React.FC = () => {
  // --- Auth & Config ---
  const [configLoading, setConfigLoading] = useState(true);
  const [config, setConfig] = useState<AppConfig | null>(null);
  
  const [pinInput, setPinInput] = useState('');
  const [activePin, setActivePin] = useState(() => sessionStorage.getItem('pf_pin') || '');
  const [isLocked, setIsLocked] = useState(true);
  const [authError, setAuthError] = useState(false);

  // --- Lockout State ---
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutEnds, setLockoutEnds] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  
  // --- App Data ---
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('All');
  
  // --- NEW: Download Manager State ---
  const [showDownloads, setShowDownloads] = useState(false);

  // --- HISTORY & NAVIGATION HANDLERS ---
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      setSelectedItem(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSelectMedia = (item: MediaItem) => {
    if (selectedItem) {
      window.history.replaceState({ itemId: item.id }, '', '');
    } else {
      window.history.pushState({ itemId: item.id }, '', '');
    }
    setSelectedItem(item);
  };

  const handleCloseMedia = () => {
    window.history.back();
  };

  // --- LOCKOUT TIMER ---
  useEffect(() => {
    let timer: any;
    if (lockoutEnds) {
      timer = setInterval(() => {
        const remaining = Math.ceil((lockoutEnds - Date.now()) / 1000);
        if (remaining <= 0) {
          setLockoutEnds(null);
          setFailedAttempts(0);
          setTimeLeft(0);
        } else {
          setTimeLeft(remaining);
        }
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [lockoutEnds]);

  // --- INITIAL LOAD & AUTH ---
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then((data: AppConfig) => {
        setConfig(data);
        if (!data.requiresPin) {
          setIsLocked(false);
          setConfigLoading(false);
        } else if (activePin) {
          refreshData(activePin)
            .then(() => setIsLocked(false))
            .catch(() => {
              sessionStorage.removeItem('pf_pin');
              setIsLocked(true);
            })
            .finally(() => setConfigLoading(false));
        } else {
          setIsLocked(true);
          setConfigLoading(false);
        }
      })
      .catch(e => {
        console.error("Config Error:", e);
        setConfigLoading(false);
      });
  }, []);

  const refreshData = async (pinToUse: string) => {
    if (lockoutEnds && Date.now() < lockoutEnds) return;

    setLoading(true);
    setAuthError(false);
    try {
      const res = await fetch('/api/files', { headers: { 'x-app-pin': pinToUse } });
      
      if (res.status === 401) {
        setAuthError(true);
        setIsLocked(true);
        setLoading(false);

        const newFailures = failedAttempts + 1;
        setFailedAttempts(newFailures);
        
        if (newFailures >= 5) {
          const duration = 30 * 1000;
          const end = Date.now() + duration;
          setLockoutEnds(end);
          setTimeLeft(30);
          setPinInput('');
        }
        throw new Error("Invalid PIN");
      }
      if (!res.ok) throw new Error(`Server Error: ${res.status}`);
      
      const data = await res.json();
      // The server now returns { files: [], nodes: [] } or just the array depending on version
      const files: MediaFile[] = data.files ? data.files : data; 
      
      setFailedAttempts(0);
      setLockoutEnds(null);

      if (Array.isArray(files)) {
        setMediaItems(groupMediaFiles(files));
      } else {
        console.error("Data received is not an array:", files);
        setMediaItems([]);
      }

      setActivePin(pinToUse);
      sessionStorage.setItem('pf_pin', pinToUse);
      setIsLocked(false);
    } catch (e: any) {
      if (e.message !== "Invalid PIN") alert(`Connection Error: ${e.message}`);
      throw e; 
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = () => refreshData(pinInput).catch(() => {});
  const handleLock = () => {
    setPinInput('');
    setActivePin('');
    sessionStorage.removeItem('pf_pin');
    setIsLocked(true);
  };

  const groupMediaFiles = (files: MediaFile[]): MediaItem[] => {
    const map = new Map<string, MediaItem>();
    
    files.forEach(file => {
      try {
        if (!file.rawFilename) return;

        let name = cleanName(file.rawFilename);
        const type = getMediaType(file.path, file.rawFilename);
        
        if (type === 'Music') {
          const { artist } = getMusicMetadata(file.path);
          const key = `Music:${artist.toLowerCase()}`;
          if (!map.has(key)) {
            map.set(key, { id: key, name: artist, type: 'Music', files: [] });
          }
          map.get(key)!.files.push(file);
          return;
        }

        if (type === 'TV Show') {
          const series = getSeriesName(file.rawFilename);
          if (series) {
            name = series;
          } else {
            const parts = file.path.replace(/\\/g, '/').split('/');
            const seasonIdx = parts.findIndex(p => p.toLowerCase().startsWith('season '));
            if (seasonIdx > 0) {
              name = parts[seasonIdx - 1];
            } else {
              const lowerParts = parts.map(p => p.toLowerCase());
              const roots = ['tv shows', 'tv', 'shows'];
              let rootIdx = -1;
              for (const r of roots) {
                const idx = lowerParts.lastIndexOf(r);
                if (idx > rootIdx) rootIdx = idx;
              }
              if (rootIdx !== -1 && rootIdx + 1 < parts.length) {
                name = parts[rootIdx + 1];
              }
            }
          }
        }
        
        const key = `${type}:${name.toLowerCase()}`;
        if (!map.has(key)) map.set(key, { id: key, name: name || file.rawFilename, type, files: [] });
        map.get(key)!.files.push(file);
      } catch (err) {
        console.warn("Skipping file due to grouping error:", file.rawFilename);
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  };

  // --- SCAN ALL LOGIC ---
  const handleScanAll = async () => {
    setLoading(true);
    setStatusMsg(`Scanning local library and syncing...`);

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-pin': activePin 
        },
        body: JSON.stringify({ owner: 'ALL' })
      });

      const result = await res.json();

      if (!res.ok) throw new Error(result.error || "Scan failed");

      setStatusMsg(result.message);
      await refreshData(activePin);
      
      setTimeout(() => setStatusMsg(null), 4000);

    } catch (err: any) {
      console.error(err);
      alert(`Scan Error: ${err.message}`);
      setStatusMsg(null);
    } finally {
      setLoading(false);
    }
  };

  // --- FILTER & RANKING LOGIC ---
  const filteredItems = useMemo(() => {
    const calculateScore = (text: string, query: string, isPrimary: boolean, type: string) => {
      let score = 0;
      const lowerText = text.toLowerCase();
      const lowerQuery = query.toLowerCase();

      if (lowerText === lowerQuery) score += 100;
      else if (lowerText.startsWith(lowerQuery)) score += 50;
      else if (fuzzyMatch(text, query)) score += isPrimary ? 10 : 1;
      else return 0;

      if (['Movie', 'TV Show', 'Music'].includes(type) && isPrimary) {
        score += 5; 
      }
      return score;
    };

    const scoredResults: { item: MediaItem, score: number }[] = [];

    mediaItems.forEach(item => {
      if (activeFilter !== 'All' && item.type !== activeFilter) return;

      if (!searchQuery) {
        scoredResults.push({ item, score: 0 });
        return;
      }

      if (item.type === 'Music') {
        const artistScore = calculateScore(item.name, searchQuery, true, 'Music');
        if (artistScore > 0) scoredResults.push({ item, score: artistScore });

        const albumMap = new Map<string, MediaFile[]>();
        item.files.forEach(f => {
          const { album } = getMusicMetadata(f.path);
          if (!albumMap.has(album)) albumMap.set(album, []);
          albumMap.get(album)!.push(f);
        });

        albumMap.forEach((files, albumName) => {
          const albumScore = calculateScore(albumName, searchQuery, true, 'Album');
          let trackScore = 0;
          if (albumScore < 10) {
             const hasTrackMatch = files.some(f => fuzzyMatch(f.rawFilename, searchQuery));
             if (hasTrackMatch) trackScore = 1; 
          }
          const finalScore = Math.max(albumScore, trackScore);
          if (finalScore > 0) {
            scoredResults.push({
              item: {
                id: `${item.id}:album:${albumName}`,
                name: albumName,
                type: 'Music',
                files: files
              },
              score: finalScore
            });
          }
        });
        return;
      }

      const nameScore = calculateScore(item.name, searchQuery, true, item.type);
      let fileScore = 0;
      if (nameScore < 10) {
        const hasFileMatch = item.files.some(f => fuzzyMatch(f.rawFilename, searchQuery));
        if (hasFileMatch) fileScore = 1;
      }
      const totalScore = Math.max(nameScore, fileScore);
      
      if (totalScore > 0) {
        scoredResults.push({ item, score: totalScore });
      }
    });

    return scoredResults
      .sort((a, b) => b.score - a.score)
      .map(r => r.item);

  }, [mediaItems, searchQuery, activeFilter]);


  // --- RENDER ---

  if (configLoading) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
           <div className="w-8 h-8 border-4 border-plex-orange border-t-transparent rounded-full animate-spin"></div>
           <div className="text-sm font-bold uppercase tracking-wider text-gray-500">ShareList21</div>
        </div>
      </div>
    );
  }

  if (isLocked) {
    const isLockedOut = !!lockoutEnds;
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center text-white p-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
          <div className="bg-gray-900/50 p-6 border-b border-gray-700 flex flex-col items-center">
            <h1 className="text-xl font-bold flex items-center gap-2"><span className="text-plex-orange">►</span> ShareList21</h1>
            <p className="text-xs text-gray-500 mt-1 uppercase tracking-wider font-bold">Restricted Access</p>
          </div>
          <div className="p-6 space-y-4">
             <div className="space-y-1">
               <label className="text-xs font-bold uppercase text-gray-400 tracking-wider ml-1">Application PIN</label>
               <input 
                 type="password" 
                 value={pinInput} 
                 onChange={(e) => { setPinInput(e.target.value); setAuthError(false); }} 
                 onKeyDown={(e) => e.key === 'Enter' && !isLockedOut && handleUnlock()} 
                 placeholder={isLockedOut ? `Locked: ${timeLeft}s` : "••••••••"} 
                 autoFocus 
                 disabled={isLockedOut}
                 className={`w-full bg-gray-900 border rounded p-3 text-white placeholder:text-gray-700 focus:outline-none transition-colors text-center font-mono text-lg 
                   ${isLockedOut ? 'border-red-900 bg-red-900/10 text-red-400 cursor-not-allowed placeholder:text-red-500/50' : 
                     authError ? 'border-red-500 text-red-200' : 'border-gray-600 focus:border-plex-orange'}`} 
               />
               {isLockedOut ? (
                 <p className="text-xs text-red-400 text-center font-bold mt-2 animate-pulse">Too many attempts. Wait {timeLeft}s.</p>
               ) : authError && (
                 <p className="text-xs text-red-400 text-center font-bold mt-2 animate-pulse">Access Denied {failedAttempts > 0 && `(${failedAttempts}/5)`}</p>
               )}
             </div>
             <button onClick={handleUnlock} disabled={loading || !pinInput || isLockedOut} className={`w-full font-bold py-3 rounded shadow-lg transition-colors ${isLockedOut || !pinInput ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-plex-orange hover:bg-yellow-600 text-black'}`}>{isLockedOut ? 'Locked' : 'Unlock'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col md:flex-row bg-gray-900 text-gray-100 overflow-hidden relative">
      <div className={`flex-1 flex flex-col h-full relative ${selectedItem ? 'hidden md:flex' : 'flex'}`}>
        <header className="bg-gray-900 border-b border-gray-800 p-4">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-xl font-bold flex items-center gap-2"><span className="text-plex-orange">►</span> ShareList21</h1>
            
            <div className="flex items-center gap-3">
              {/* User Badge */}
              {config?.hostUser && (
                <div className="hidden sm:flex items-center gap-2 mr-2 px-3 py-1 bg-gray-800 rounded-full border border-gray-700 shadow-sm">
                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.8)]"></div>
                  <span className="text-xs font-bold text-gray-300 tracking-wide">{config.hostUser}</span>
                </div>
              )}

              {/* GitHub Link */}
              <a href="https://github.com/volumedata21/ShareList21" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white transition-colors" title="View on GitHub">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" /></svg>
              </a>

              {/* NEW DOWNLOAD BUTTON */}
              {config?.canDownload && (
                 <button 
                   onClick={() => setShowDownloads(!showDownloads)}
                   className={`p-1.5 rounded transition-colors relative ${showDownloads ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-white hover:bg-gray-800'}`}
                   title="Downloads"
                 >
                   <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                   </svg>
                 </button>
              )}

              {/* Lock Button */}
              <button onClick={handleLock} className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded" title="Lock App">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              </button>
            </div>
          </div>

          <div className="flex gap-2 mb-4">
            <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white focus:border-plex-orange outline-none" />
            
            {/* SCAN ALL BUTTON */}
            {config?.hostUser && (
              <button 
                onClick={handleScanAll}
                disabled={loading}
                className="bg-plex-orange hover:bg-yellow-600 text-black font-bold px-4 py-2 rounded shadow-lg transition-transform transform active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed"
              >
                <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {loading ? 'Scanning...' : 'Scan All'}
              </button>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {['All', 'Movie', 'TV Show', 'Music'].map(f => (
              <button key={f} onClick={() => setActiveFilter(f as FilterType)} className={`px-3 py-1 text-xs font-bold rounded-full border ${activeFilter === f ? 'bg-white text-black' : 'border-gray-700 text-gray-500'}`}>{f}</button>
            ))}
          </div>
        </header>
        {statusMsg && <div className="bg-blue-900/30 text-blue-200 text-xs p-2 text-center">{statusMsg}</div>}
        
        <MediaList items={filteredItems} onSelect={handleSelectMedia} selectedId={selectedItem?.id} />
      </div>

      <div className={`fixed inset-0 z-30 md:static md:w-[450px] bg-gray-800 transition-transform duration-300 ${selectedItem ? 'translate-x-0' : 'translate-x-full md:translate-x-0 md:hidden'}`}>
        {selectedItem ? (
          <MediaDetail item={selectedItem} onClose={handleCloseMedia} />
        ) : (
          <div className="hidden md:flex items-center justify-center h-full text-gray-600">Select an item</div>
        )}
      </div>

      {/* RENDER THE DOWNLOAD MANAGER HERE */}
      <DownloadManager 
        isOpen={showDownloads} 
        onClose={() => setShowDownloads(false)} 
        pin={activePin} 
      />
    </div>
  );
};

export default App;