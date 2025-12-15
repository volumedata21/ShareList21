import React, { useState, useEffect } from 'react';
import { MediaItem, MediaFile, FilterType, AppConfig } from './types';
import { fuzzyMatch, cleanName, getMediaType, getSeriesName } from './utils/mediaUtils';
import MediaList from './components/MediaList';
import MediaDetail from './components/MediaDetail';

const App: React.FC = () => {
  // --- Auth & Config ---
  const [configLoading, setConfigLoading] = useState(true);
  const [config, setConfig] = useState<AppConfig | null>(null);
  
  const [pinInput, setPinInput] = useState('');
  const [activePin, setActivePin] = useState(() => sessionStorage.getItem('pf_pin') || '');
  const [isLocked, setIsLocked] = useState(true);
  const [authError, setAuthError] = useState(false);
  
  // --- App Data ---
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('All');

  // 1. Initial Load
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
        console.error(e);
        setConfigLoading(false);
      });
  }, []);

  // 2. Fetch/Unlock
  const refreshData = async (pinToUse: string) => {
    setLoading(true);
    setAuthError(false);
    try {
      const res = await fetch('/api/files', { headers: { 'x-app-pin': pinToUse } });
      if (res.status === 401) {
        setAuthError(true);
        setIsLocked(true);
        setLoading(false);
        throw new Error("Invalid PIN");
      }
      if (!res.ok) throw new Error(`Server Error: ${res.status}`);
      const files: MediaFile[] = await res.json();
      setMediaItems(groupMediaFiles(files));
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
      let name = cleanName(file.rawFilename);
      const type = getMediaType(file.path, file.rawFilename);
      if (type === 'TV Show') {
        const series = getSeriesName(file.rawFilename);
        if (series) name = series;
        else {
          const parts = file.path.split('/');
          const seasonIdx = parts.findIndex(p => p.toLowerCase().startsWith('season '));
          if (seasonIdx > 0) name = parts[seasonIdx - 1];
        }
      }
      const key = `${type}:${name.toLowerCase()}`;
      if (!map.has(key)) map.set(key, { id: key, name: name || file.rawFilename, type, files: [] });
      map.get(key)!.files.push(file);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  };

  // --- SERVER SCAN LOGIC ---
  const handleScanLibrary = async () => {
    // We don't need a local user anymore. We use the Host User from config.
    if (!config?.hostUser) return;
    
    setLoading(true);
    setStatusMsg(`Scanning library for ${config.hostUser}...`);

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-app-pin': activePin 
        },
        body: JSON.stringify({ owner: config.hostUser })
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Scan failed");
      }

      setStatusMsg(`Scan Complete! Found ${result.count} files.`);
      setTimeout(() => setStatusMsg(null), 3000);
      
      // Refresh list to show new files
      await refreshData(activePin);

    } catch (err: any) {
      console.error(err);
      alert(`Scan Error: ${err.message}`);
      setStatusMsg(null);
    } finally {
      setLoading(false);
    }
  };

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
               <input type="password" value={pinInput} onChange={(e) => { setPinInput(e.target.value); setAuthError(false); }} onKeyDown={(e) => e.key === 'Enter' && handleUnlock()} placeholder="••••" autoFocus className={`w-full bg-gray-900 border rounded p-3 text-white focus:outline-none transition-colors text-center font-mono text-lg ${authError ? 'border-red-500 text-red-200' : 'border-gray-600 focus:border-plex-orange'}`} />
               {authError && <p className="text-xs text-red-400 text-center font-bold mt-2 animate-pulse">Access Denied</p>}
             </div>
             <button onClick={handleUnlock} disabled={loading || !pinInput} className="w-full bg-plex-orange hover:bg-yellow-600 text-black font-bold py-3 rounded shadow-lg">Unlock</button>
          </div>
        </div>
      </div>
    );
  }

  const filteredItems = mediaItems.filter(item => {
    if (activeFilter !== 'All' && item.type !== activeFilter) return false;
    if (searchQuery && !fuzzyMatch(item.name, searchQuery)) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col md:flex-row bg-gray-900 text-gray-100 overflow-hidden relative">
      
      <div className={`flex-1 flex flex-col h-full relative ${selectedItem ? 'hidden md:flex' : 'flex'}`}>
        <header className="bg-gray-900 border-b border-gray-800 p-4">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-xl font-bold flex items-center gap-2"><span className="text-plex-orange">►</span> ShareList21</h1>
            <button onClick={handleLock} className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded" title="Lock App">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            </button>
          </div>
          <div className="flex gap-2 mb-4">
            <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white focus:border-plex-orange outline-none" />
            
            {/* BUTTON ONLY SHOWS IF HOST USER IS CONFIGURED */}
            {config?.hostUser && (
              <button 
                onClick={handleScanLibrary}
                disabled={loading}
                className="bg-plex-orange hover:bg-yellow-600 text-black font-bold px-4 rounded disabled:opacity-50 whitespace-nowrap"
              >
                {loading ? 'Scanning...' : 'Scan Library'}
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
        <MediaList items={filteredItems} onSelect={setSelectedItem} selectedId={selectedItem?.id} />
      </div>

      <div className={`fixed inset-0 z-30 md:static md:w-[450px] bg-gray-800 transition-transform duration-300 ${selectedItem ? 'translate-x-0' : 'translate-x-full md:translate-x-0 md:hidden'}`}>
        {selectedItem ? <MediaDetail item={selectedItem} onClose={() => setSelectedItem(null)} /> : <div className="hidden md:flex items-center justify-center h-full text-gray-600">Select an item</div>}
      </div>
    </div>
  );
};

export default App;