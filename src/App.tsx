import React, { useState, useEffect, useMemo } from 'react';
import { MediaItem, MediaFile, FilterType, AppConfig, DownloadStatus, UploadStatus } from './types';
import { fuzzyMatch, cleanName, getMediaType, getSeriesName, getMusicMetadata, formatBytes } from './utils/mediaUtils';
import MediaList from './components/MediaList';
import MediaDetail from './components/MediaDetail';
import DownloadManager from './components/DownloadManager';
import StatsModal from './components/StatsModal';
import { useToast } from './components/ToastContext';

// Structure for tracking active downloads in the UI

const App: React.FC = () => {
  const { addToast } = useToast();
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
  
  // --- Download & Inventory State ---
  const [showDownloads, setShowDownloads] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState<DownloadStatus[]>([]);
  const [activeUploads, setActiveUploads] = useState<UploadStatus[]>([]);
  
  // NEW: State object to track both complete files and partial (.part) files
  const [inventory, setInventory] = useState<{ complete: Set<string>, partials: Set<string> }>({ 
    complete: new Set(), 
    partials: new Set() 
  });

  // --- Connection Test & Scan Status State ---
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [scanStatus, setScanStatus] = useState<{
    isRunning: boolean;
    step: string;
    localFiles: number;
    newLocal: number;
    remoteSummary: string[];
    error: string | null;
  } | null>(null);

  // --- POLLING: Downloads & Inventory ---
  // --- SMART POLLING (Self-Scheduling Loop) ---
  useEffect(() => {
    if (isLocked || !activePin) return;
    
    let isMounted = true;
    let timeoutId: any;

    const poll = async () => {
      try {
        // 1. Fetch Downloads (Fast)
        const dRes = await fetch('/api/downloads', { headers: { 'x-app-pin': activePin } });
        if (isMounted && dRes.ok) {
            const data = await dRes.json();
            if (Array.isArray(data)) setActiveDownloads(data);
        }

        // 2. Fetch Uploads (Traffic Control)
        const uRes = await fetch('/api/uploads', { headers: { 'x-app-pin': activePin } });
        if (isMounted && uRes.ok) {
            const data = await uRes.json();
            if (Array.isArray(data)) setActiveUploads(data);
        }

        // 3. Fetch Inventory (Check less often if needed, but safe here due to serial await)
        const iRes = await fetch('/api/inventory', { headers: { 'x-app-pin': activePin } });
        if (isMounted && iRes.ok) {
           const data = await iRes.json();
           const complete = Array.isArray(data?.complete) ? data.complete : [];
           const partials = Array.isArray(data?.partials) ? data.partials : [];
           setInventory({
               complete: new Set(complete),
               partials: new Set(partials)
           });
        }
      } catch (e) {
        console.error("Poll error (retrying in 2s)", e);
      } finally {
        // 3. ONLY schedule the next run when the current one is completely finished.
        // This prevents "request pile-up" on slow networks.
        if (isMounted) timeoutId = setTimeout(poll, 2000);
      }
    };

    poll(); // Start the loop

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [activePin, isLocked]);

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

    if (!scanStatus?.isRunning) setLoading(true);
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
      const files: MediaFile[] = data.files ? data.files : data; 
      
      setFailedAttempts(0);
      setLockoutEnds(null);

      if (Array.isArray(files)) {
        setMediaItems(groupMediaFiles(files));
      } else {
        setMediaItems([]);
      }

      setActivePin(pinToUse);
      sessionStorage.setItem('pf_pin', pinToUse);
      setIsLocked(false);
    } catch (e: any) {
      // USE TOAST HERE
      if (e.message !== "Invalid PIN") {
          addToast(`Connection Error: ${e.message}`, 'error');
      }
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
          if (!map.has(key)) map.set(key, { id: key, name: artist, type: 'Music', files: [] });
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
            if (seasonIdx > 0) name = parts[seasonIdx - 1];
            else {
              const lowerParts = parts.map(p => p.toLowerCase());
              const roots = ['tv shows', 'tv', 'shows'];
              let rootIdx = -1;
              for (const r of roots) {
                const idx = lowerParts.lastIndexOf(r);
                if (idx > rootIdx) rootIdx = idx;
              }
              if (rootIdx !== -1 && rootIdx + 1 < parts.length) name = parts[rootIdx + 1];
            }
          }
        }
        
        const key = `${type}:${name.toLowerCase()}`;
        if (!map.has(key)) map.set(key, { id: key, name: name || file.rawFilename, type, files: [] });
        map.get(key)!.files.push(file);
      } catch (err) {}
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  };

  // --- SCAN ALL LOGIC ---
  const handleScanAll = async () => {
    if (loading) return;
    setLoading(true);
    setScanStatus({ isRunning: true, step: 'Starting...', localFiles: 0, newLocal: 0, remoteSummary: [], error: null });

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-pin': activePin },
        body: JSON.stringify({ owner: 'ALL' })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Scan failed");

      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/scan-status', { headers: { 'x-app-pin': activePin } });
          const status = await statusRes.json();
          setScanStatus(status);
          if (!status.isRunning) {
            clearInterval(poll);
            setLoading(false);
            if (status.step === 'Complete') await refreshData(activePin);
            setTimeout(() => setScanStatus(null), 10000);
          }
        } catch (e) { clearInterval(poll); setLoading(false); }
      }, 1000); 
    } catch (err: any) {
      console.error(err);
      setScanStatus({ isRunning: false, step: 'Error', localFiles: 0, newLocal: 0, remoteSummary: [], error: err.message });
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (isTesting) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-pin': activePin } });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({ success: true, message: data.message });
        setTimeout(() => setTestResult(null), 3000);
      } else {
        setTestResult({ success: false, message: data.message || "Connection failed" });
      }
    } catch (e) {
      setTestResult({ success: false, message: "Network Error" });
    } finally {
      setIsTesting(false);
    }
  };

  const filteredItems = useMemo(() => {
    const calculateScore = (text: string, query: string, isPrimary: boolean, type: string) => {
      let score = 0;
      const lowerText = text.toLowerCase();
      const lowerQuery = query.toLowerCase();
      if (lowerText === lowerQuery) score += 100;
      else if (lowerText.startsWith(lowerQuery)) score += 50;
      else if (fuzzyMatch(text, query)) score += isPrimary ? 10 : 1;
      else return 0;
      if (['Movie', 'TV Show', 'Music'].includes(type) && isPrimary) score += 5; 
      return score;
    };
    const scoredResults: { item: MediaItem, score: number }[] = [];
    mediaItems.forEach(item => {
      if (activeFilter !== 'All' && item.type !== activeFilter) return;
      if (!searchQuery) { scoredResults.push({ item, score: 0 }); return; }
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
          if (albumScore < 10 && files.some(f => fuzzyMatch(f.rawFilename, searchQuery))) trackScore = 1; 
          const finalScore = Math.max(albumScore, trackScore);
          if (finalScore > 0) scoredResults.push({ item: { id: `${item.id}:album:${albumName}`, name: albumName, type: 'Music', files: files }, score: finalScore });
        });
        return;
      }
      const nameScore = calculateScore(item.name, searchQuery, true, item.type);
      let fileScore = 0;
      if (nameScore < 10 && item.files.some(f => fuzzyMatch(f.rawFilename, searchQuery))) fileScore = 1;
      const totalScore = Math.max(nameScore, fileScore);
      if (totalScore > 0) scoredResults.push({ item, score: totalScore });
    });
    return scoredResults.sort((a, b) => b.score - a.score).map(r => r.item);
  }, [mediaItems, searchQuery, activeFilter]);

  // --- RENDER ---
  const activeDownloadsList = activeDownloads.filter(d => d.status === 'downloading' || d.status === 'pending');
  const activeCount = activeDownloadsList.length;
  let globalProgress = 0;
  if (activeCount > 0) {
    const total = activeDownloadsList.reduce((acc, d) => acc + (d.totalBytes || 0), 0);
    const loaded = activeDownloadsList.reduce((acc, d) => acc + (d.downloadedBytes || 0), 0);
    if (total > 0) globalProgress = (loaded / total) * 100;
  }
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (globalProgress / 100) * circumference;

  if (configLoading) return <div className="h-screen bg-gray-900 flex items-center justify-center text-white"><div className="flex flex-col items-center gap-4"><div className="w-8 h-8 border-4 border-plex-orange border-t-transparent rounded-full animate-spin"></div></div></div>;

  if (isLocked) { /* ... Lock Screen ... */ 
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
               <input type="password" value={pinInput} onChange={(e) => { setPinInput(e.target.value); setAuthError(false); }} onKeyDown={(e) => e.key === 'Enter' && !isLockedOut && handleUnlock()} placeholder={isLockedOut ? `Locked: ${timeLeft}s` : "••••••••"} autoFocus disabled={isLockedOut} className={`w-full bg-gray-900 border rounded p-3 text-white placeholder:text-gray-700 focus:outline-none transition-colors text-center font-mono text-lg ${isLockedOut ? 'border-red-900 bg-red-900/10 text-red-400 cursor-not-allowed placeholder:text-red-500/50' : authError ? 'border-red-500 text-red-200' : 'border-gray-600 focus:border-plex-orange'}`} />
               {isLockedOut ? <p className="text-xs text-red-400 text-center font-bold mt-2 animate-pulse">Too many attempts. Wait {timeLeft}s.</p> : authError && <p className="text-xs text-red-400 text-center font-bold mt-2 animate-pulse">Access Denied {failedAttempts > 0 && `(${failedAttempts}/5)`}</p>}
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
              {config?.hostUser && (
                <div className="hidden sm:flex items-center gap-2 mr-2 px-3 py-1 bg-gray-800 rounded-full border border-gray-700 shadow-sm">
                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.8)]"></div>
                  <span className="text-xs font-bold text-gray-300 tracking-wide">{config.hostUser}</span>
                </div>
              )}
              <a href="https://github.com/volumedata21/ShareList21" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white transition-colors"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" /></svg></a>
              
              {/* DOWNLOAD BUTTON (Updated for Uploads) */}
              {config?.canDownload && (
                 <button 
                   onClick={() => setShowDownloads(!showDownloads)} 
                   className={`p-1.5 rounded transition-all relative group flex items-center justify-center ${
                      showDownloads ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-white hover:bg-gray-800'
                   }`}
                 >
                   {/* Background Glow for Uploads */}
                   {activeUploads.length > 0 && (
                      <div className="absolute inset-0 bg-blue-500/20 animate-pulse rounded"></div>
                   )}

                   <div className="relative w-6 h-6 flex items-center justify-center">
                     {/* Existing Download Progress Circle */}
                     {activeCount > 0 && (
                        <svg className="absolute inset-0 w-6 h-6 -rotate-90 pointer-events-none" viewBox="0 0 24 24"><circle cx="12" cy="12" r={radius} stroke="currentColor" strokeWidth="2" fill="transparent" className="text-gray-700" /><circle cx="12" cy="12" r={radius} stroke="currentColor" strokeWidth="2" fill="transparent" className="text-plex-orange transition-all duration-500 ease-out" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" /></svg>
                     )}
                     
                     {/* Icon changes color based on activity */}
                     <svg className={`w-4 h-4 ${activeCount > 0 ? 'text-white animate-pulse' : activeUploads.length > 0 ? 'text-blue-400' : 'text-current'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                     </svg>
                     
                     {/* Badge Logic: Show Uploads count if > 0, otherwise Downloads count */}
                     {(activeCount > 0 || activeUploads.length > 0) && (
                        <span className={`absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-gray-900 shadow-sm animate-in zoom-in ${activeUploads.length > 0 ? 'bg-blue-500' : 'bg-red-500'}`}>
                           {activeUploads.length > 0 ? activeUploads.length : activeCount}
                        </span>
                     )}
                   </div>
                 </button>
              )}
              <button onClick={handleLock} className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded" title="Lock App"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg></button>
            </div>
          </div>

          <div className="flex gap-2 mb-4">
            <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded px-4 py-2 text-white focus:border-plex-orange outline-none" />
            
            {/* CONNECTION TEST */}
            {config?.hostUser && (
              <button onClick={handleTestConnection} disabled={isTesting} className={`p-2 rounded-lg transition-all duration-200 border relative group ${isTesting ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-wait' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 hover:bg-gray-700'}`} title="Test Connection">
                {isTesting ? <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> : <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" /></svg>}
                {testResult?.success && <span className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full shadow-lg shadow-green-500/50 animate-ping"></span>}
              </button>
            )}

            {/* STATS BUTTON */}
            <button 
              onClick={() => setShowStats(true)}
              className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 hover:bg-gray-700 transition-all"
              title="Network Statistics"
            >
               <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
               </svg>
            </button>

            {/* SCAN BUTTON (Corrected Spin) */}
            {config?.hostUser && (
              <button onClick={handleScanAll} disabled={loading} className="bg-plex-orange hover:bg-yellow-600 text-black font-bold px-4 py-2 rounded shadow-lg transition-transform transform active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed">
                <div className={`${loading ? 'animate-spin' : ''}`}>
                  <svg className="w-4 h-4" style={{ transform: 'scaleX(-1)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </div>
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

        {testResult && !testResult.success && <div className="bg-red-900/90 border-b border-red-700 p-2 flex items-center justify-between backdrop-blur animate-in slide-in-from-top-2"><div className="flex items-center gap-3 px-2"><div className="p-1 bg-red-800 rounded-full flex-shrink-0"><svg className="w-3 h-3 text-red-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div><span className="text-xs font-bold text-red-100">{testResult.message}</span></div><button onClick={() => setTestResult(null)} className="text-red-300 hover:text-white p-1 hover:bg-red-800 rounded transition-colors mr-2"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button></div>}
        {testResult && testResult.success && <div className="absolute top-20 right-4 z-50 bg-green-600/90 border border-green-500 text-white px-4 py-2 rounded shadow-xl backdrop-blur animate-in fade-in slide-in-from-top-4 flex items-center gap-2 pointer-events-none"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg><span className="text-sm font-bold">{testResult.message}</span></div>}

        {scanStatus ? (
          <div className="bg-blue-900/20 border-b border-blue-500/30 p-3 text-xs text-blue-100 animate-in slide-in-from-top-2">
             <div className="flex justify-between items-center mb-1">
                <span className="font-bold uppercase tracking-wider">{scanStatus.step}</span>
                {scanStatus.isRunning && (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                )}
             </div>
             <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                   <p className="text-gray-400">Local Files</p>
                   <p className="font-mono text-lg">{scanStatus.localFiles} <span className="text-green-400 text-xs">({scanStatus.newLocal > 0 ? '+' : ''}{scanStatus.newLocal} new)</span></p>
                </div>
                {scanStatus.remoteSummary.length > 0 && (
                  <div>
                    <p className="text-gray-400">Remote Sync</p>
                    <ul className="list-disc list-inside">
                      {scanStatus.remoteSummary.map((s, i) => <li key={i} className="truncate">{s}</li>)}
                    </ul>
                  </div>
                )}
             </div>
             {scanStatus.error && <p className="text-red-400 mt-2 font-bold">Error: {scanStatus.error}</p>}
          </div>
        ) : (
          statusMsg && <div className="bg-blue-900/30 text-blue-200 text-xs p-2 text-center">{statusMsg}</div>
        )}
        {/* --- LIVE UPLOAD BANNER --- */}
        {activeUploads.length > 0 && (
           <div className="bg-blue-600/20 border-b border-blue-500/50 p-3 flex items-center justify-between animate-in slide-in-from-top-4">
              <div className="flex items-center gap-3">
                 <div className="relative">
                    <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-75"></div>
                    <div className="relative w-3 h-3 bg-blue-500 rounded-full border border-white"></div>
                 </div>
                 <div className="text-sm text-blue-100">
                    <span className="font-bold">
  {activeUploads.length === 1 
    ? `uploading to ${activeUploads[0].user}` 
    : `uploading to ${activeUploads.length} users`}
</span>
                    <span className="mx-2 opacity-50">|</span>
                    <span className="font-mono text-xs opacity-80">
                       {formatBytes(activeUploads.reduce((a, b) => a + b.speed, 0))}/s
                    </span>
                 </div>
              </div>
              <button 
                 onClick={() => setShowDownloads(true)} // Open the manager
                 className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded font-bold transition-colors"
              >
                 VIEW
              </button>
           </div>
        )}
        
        <MediaList items={filteredItems} onSelect={handleSelectMedia} selectedId={selectedItem?.id} />
      </div>

      <div className={`fixed inset-0 z-30 md:static md:w-[450px] bg-gray-800 transition-transform duration-300 ${selectedItem ? 'translate-x-0' : 'translate-x-full md:translate-x-0 md:hidden'}`}>
        {selectedItem ? (
          // Updated prop passing to match MediaDetail's new interface
          <MediaDetail 
            item={selectedItem} 
            onClose={handleCloseMedia} 
            activeDownloads={activeDownloads} 
            completeFiles={inventory.complete}
            partialFiles={inventory.partials}
          />
        ) : (
          <div className="hidden md:flex items-center justify-center h-full text-gray-600">Select an item</div>
        )}
      </div>

      <StatsModal 
        isOpen={showStats} 
        onClose={() => setShowStats(false)} 
        items={mediaItems} // Pass the data!
      />

      <DownloadManager 
        isOpen={showDownloads} 
        onClose={() => setShowDownloads(false)} 
        pin={activePin}
        downloads={activeDownloads} 
        uploads={activeUploads}
      />
    </div>
  );
};

export default App;