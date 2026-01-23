import React, { useState, useEffect, useMemo } from 'react';
import { MediaItem, MediaFile, FilterType, AppConfig, DownloadStatus, UploadStatus } from './types';
import { fuzzyMatch, cleanName, getMediaType, getSeriesName, getMusicMetadata, formatBytes } from './utils/mediaUtils';
import MediaList from './components/MediaList';
import MediaDetail from './components/MediaDetail';
import DownloadManager from './components/DownloadManager';
import StatsModal from './components/StatsModal';
import { useToast } from './components/ToastContext';

const UserAvatar = ({ user, onLogout }: { user: string; onLogout: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getColor = (str: string) => {
    const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="relative z-50" ref={menuRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="relative group outline-none block"
      >
        {/* IDLE PULSE GLOW (Behind the avatar) */}
        {/* Only shows when NOT open and NOT hovering (group-hover handles the rest) */}
        <div className={`absolute inset-0 bg-orange-500/30 rounded-2xl blur-md transition-all duration-1000 
          ${isOpen ? 'opacity-0' : 'animate-pulse opacity-100 group-hover:opacity-0'}
        `}></div>

        {/* AVATAR CONTAINER */}
        <div className={`
          relative w-14 h-14 rounded-2xl overflow-hidden transition-all duration-300 ease-out z-10
          ${isOpen 
            ? 'ring-4 ring-orange-500 shadow-[0_0_30px_rgba(249,115,22,0.6)] scale-105' 
            : 'ring-2 ring-white/10 shadow-xl group-hover:ring-orange-500/50 group-hover:shadow-[0_0_25px_rgba(249,115,22,0.5)] group-hover:scale-105'
          }
        `}>
          {!imgError ? (
            <img 
              src={`/api/avatar/${user}`} 
              alt={user} 
              className="w-full h-full object-cover" 
              onError={() => setImgError(true)} 
            />
          ) : (
            // Fallback Initials
            <div className={`w-full h-full flex items-center justify-center text-white font-black text-2xl bg-gradient-to-br ${getColor(user)} to-gray-900`}>
              {user.charAt(0).toUpperCase()}
            </div>
          )}

          {/* Glossy Overlay */}
          <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
        </div>
        
        {/* Status Dot */}
        <div className="absolute -bottom-1 -right-1 flex h-4 w-4 z-20">
            <span className={`absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 ${isOpen ? 'animate-ping' : ''}`}></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500 border-2 border-gray-900"></span>
        </div>
      </button>

      {/* DROPDOWN MENU */}
      {isOpen && (
        <div className="absolute right-0 mt-4 w-60 bg-gray-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-3 overflow-hidden ring-1 ring-black/50 origin-top-right">
          
          {/* Menu Header with Gradient */}
          <div className="px-5 py-5 border-b border-white/5 bg-gradient-to-b from-white/5 to-transparent relative overflow-hidden">
            {/* Decorative background glow */}
            <div className="absolute -top-10 -right-10 w-20 h-20 bg-orange-500/20 blur-2xl rounded-full pointer-events-none"></div>
            
            <p className="text-[10px] font-bold text-orange-400 uppercase tracking-widest mb-1">Signed in as</p>
            <div className="flex justify-between items-center">
              <p className="text-white font-bold text-xl truncate tracking-tight">{user}</p>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/10 text-gray-300 border border-white/5 shadow-inner">HOST</span>
            </div>
          </div>
          
          <div className="p-2">
            <button 
              onClick={onLogout}
              className="w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-red-300 hover:bg-red-500/10 hover:text-red-200 transition-all flex items-center gap-3 group border border-transparent hover:border-red-500/10"
            >
              <div className="p-2 rounded-lg bg-red-500/10 group-hover:bg-red-500 group-hover:text-white transition-colors shadow-sm">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </div>
              <span className="font-semibold">Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

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

  const handleUnlock = () => refreshData(pinInput).catch(() => { });
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
      } catch (err) { }
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

  if (isLocked) {
    const isLockedOut = !!lockoutEnds;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
        {/* Main Card */}
        <div className="relative w-full max-w-sm bg-gradient-to-b from-gray-900 to-black border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col items-center p-8">
          
          {/* Subtle Top Lighting */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
          
          {/* Logo Container with Glow */}
          <div className="relative mb-6 group">
            <div className="absolute -inset-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl blur-lg opacity-20 group-hover:opacity-40 transition duration-1000"></div>
            <div className="relative w-20 h-20 bg-gray-800 rounded-2xl flex items-center justify-center shadow-2xl ring-1 ring-white/10 overflow-hidden">
               <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-black opacity-90"></div>
               <svg className="relative w-10 h-10 drop-shadow-md" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="lockIconGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#fbbf24" /> {/* Amber-400 */}
                      <stop offset="100%" stopColor="#ea580c" /> {/* Orange-600 */}
                    </linearGradient>
                  </defs>
                  <path stroke="url(#lockIconGrad)" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 tracking-tight mb-1">
            ShareList21
          </h1>
          <div className="flex items-center gap-2 mb-8">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
              Restricted Access
            </p>
          </div>

          {/* Input Area */}
          <div className="w-full space-y-4">
            <div className="space-y-2">
              <input 
                type="password" 
                value={pinInput} 
                onChange={(e) => { setPinInput(e.target.value); setAuthError(false); }} 
                onKeyDown={(e) => e.key === 'Enter' && !isLockedOut && handleUnlock()} 
                // UPDATED: Mixed case placeholder
                placeholder={isLockedOut ? `Locked: ${timeLeft}s` : "Enter PIN"} 
                autoFocus 
                disabled={isLockedOut} 
                // UPDATED: text-base (smaller) and tracking-normal (0 kerning)
                className={`w-full bg-black/50 border rounded-xl p-4 text-white placeholder:text-gray-600 text-center font-bold text-base tracking-normal outline-none transition-all duration-300 shadow-inner
                  ${isLockedOut 
                    ? 'border-red-900/50 bg-red-950/20 text-red-400 cursor-not-allowed placeholder:text-red-500/30' 
                    : authError 
                        ? 'border-red-500/50 text-red-200 ring-2 ring-red-500/20' 
                        : 'border-white/10 focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/20 focus:bg-black/80'
                  }`} 
              />
              
              {/* Error / Status Messages */}
              <div className="h-5 flex items-center justify-center">
                {isLockedOut ? (
                   <p className="text-xs text-red-400 font-bold animate-pulse">Too many attempts. Wait {timeLeft}s.</p> 
                ) : authError ? (
                   <p className="text-xs text-red-400 font-bold animate-shake">Access Denied {failedAttempts > 0 && `(${failedAttempts}/5)`}</p>
                ) : (
                   <p className="text-[10px] text-gray-600">Please verify your identity.</p>
                )}
              </div>
            </div>

            <button 
              onClick={handleUnlock} 
              disabled={loading || !pinInput || isLockedOut} 
              className={`w-full font-bold py-3.5 rounded-xl shadow-lg transition-all duration-300 transform active:scale-95 flex items-center justify-center gap-2
                ${isLockedOut || !pinInput 
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed border border-white/5' 
                  : 'bg-gradient-to-br from-orange-500 to-red-600 hover:from-orange-400 hover:to-red-500 text-white shadow-orange-900/20 hover:shadow-orange-600/30 border border-white/10'
                }`}
            >
              {loading ? (
                <svg className="w-5 h-5 animate-spin text-white/50" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
              ) : isLockedOut ? (
                <span className="flex items-center gap-2"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg> Locked</span>
              ) : (
                <>Unlock Server</>
              )}
            </button>
          </div>
        </div>
        
        {/* Footer Credit */}
        <div className="absolute bottom-6 text-[10px] text-gray-600 font-medium">
           Protected System • Authorized Personnel Only
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col md:flex-row bg-gray-900 text-gray-100 overflow-hidden relative">
      <div className={`flex-1 flex flex-col h-full relative ${selectedItem ? 'hidden md:flex' : 'flex'}`}>
        {/* --- REPLACED HEADER START --- */}
        {/* --- REPLACED HEADER START --- */}
        <header className="relative z-20 bg-gray-900/80 backdrop-blur-xl border-b border-white/5 p-4 shadow-2xl">
          {/* Top Row: Logo & Actions */}
          <div className="flex justify-between items-center mb-6">
            
            {/* NEW LOGO DESIGN (Reversed) */}
            <div className="flex items-center gap-4">
              <div className="relative w-10 h-10 bg-gray-800 rounded-xl flex items-center justify-center shadow-lg shadow-black/50 ring-1 ring-white/10 group hover:scale-100 transition-transform duration-300 overflow-hidden">
                {/* Dark Blue Background with subtle internal gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-black opacity-100"></div>
                
                {/* Orange Gradient Icon */}
                <svg className="relative w-6 h-6 drop-shadow-sm" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="iconGradient" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#fbbf24" /> {/* Amber-400 */}
                      <stop offset="100%" stopColor="#ea580c" /> {/* Orange-600 */}
                    </linearGradient>
                  </defs>
                  <path stroke="url(#iconGradient)" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div>
                 <h1 className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 tracking-tight">
                   ShareList21
                 </h1>
                 {config?.hostUser && (
                   <div className="flex items-center gap-1.5 mt-0.5">
                     <span className="relative flex h-2 w-2">
                       <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                       <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                     </span>
                     <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{config.hostUser}</span>
                   </div>
                 )}
              </div>
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-3">
              <a href="https://github.com/volumedata21/ShareList21" target="_blank" rel="noopener noreferrer" className="p-2 text-gray-500 hover:text-white transition-colors opacity-70 hover:opacity-100">
                 <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" /></svg>
              </a>
              
              {/* DOWNLOADS BUTTON */}
              {config?.canDownload && (
                 <button 
                   onClick={() => setShowDownloads(!showDownloads)} 
                   className={`relative p-2 rounded-xl transition-all duration-300 group ${
                      showDownloads 
                        ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg shadow-blue-500/30' 
                        : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/5'
                   }`}
                 >
                   {activeCount > 0 && (
                      <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none p-0.5" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r={radius} stroke="currentColor" strokeWidth="2" fill="transparent" className="text-white/10" />
                        <circle cx="12" cy="12" r={radius} stroke="currentColor" strokeWidth="2" fill="transparent" className="text-white transition-all duration-500 ease-out" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" />
                      </svg>
                   )}
                   
                   <div className="relative z-10">
                     <svg className={`w-5 h-5 ${activeCount > 0 ? 'animate-pulse' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                     </svg>
                     {(activeCount > 0 || activeUploads.length > 0) && (
                        <span className={`absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white shadow-sm ring-2 ring-gray-900 ${activeUploads.length > 0 ? 'bg-indigo-500' : 'bg-red-500'}`}>
                           {activeUploads.length > 0 ? activeUploads.length : activeCount}
                        </span>
                     )}
                   </div>
                 </button>
              )}
              
              {/* LOCK BUTTON */}
              {/* USER AVATAR / LOGOUT */}
              {config?.hostUser ? (
                <UserAvatar user={config.hostUser} onLogout={handleLock} />
              ) : (
                <button onClick={handleLock} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-all" title="Lock App">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                </button>
              )}
            </div>
          </div>

          {/* Bottom Row: Search & Tools */}
          <div className="flex gap-3">
            <div className="relative flex-1 group">
               <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-4 w-4 text-gray-500 group-focus-within:text-orange-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
               </div>
               <input 
                  type="text" 
                  placeholder="Search library..." 
                  value={searchQuery} 
                  onChange={e => setSearchQuery(e.target.value)} 
                  className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 focus:ring-4 focus:ring-orange-500/10 transition-all shadow-inner" 
               />
            </div>
            
            {/* TOOLBAR BUTTONS */}
            <div className="flex gap-2">
                {/* Connection Test (Tech/Cyan Theme) */}
                {config?.hostUser && (
                  <button onClick={handleTestConnection} disabled={isTesting} className={`group relative overflow-hidden p-2.5 rounded-xl border transition-all duration-300 ${isTesting ? 'bg-gray-800 border-white/5 text-gray-500' : 'bg-gray-800/50 border-white/10 text-gray-400 hover:text-cyan-300 hover:border-cyan-500/30 hover:bg-cyan-950/30 hover:shadow-lg hover:shadow-cyan-900/20'}`} title="Test Connection">
                    <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    {isTesting ? (
                        <svg className="w-5 h-5 animate-spin relative z-10" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                    ) : (
                        <svg className="w-5 h-5 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" /></svg>
                    )}
                  </button>
                )}

                {/* Social/Friends Button (Social/Indigo Theme) */}
                <button 
                  onClick={() => setShowStats(true)}
                  className="group relative overflow-hidden p-2.5 rounded-xl border border-white/10 bg-gray-800/50 text-gray-400 transition-all duration-300 hover:text-indigo-300 hover:border-indigo-500/30 hover:bg-indigo-950/30 hover:shadow-lg hover:shadow-indigo-900/20"
                  title="Friends & Network"
                >
                   <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                   <svg className="w-5 h-5 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                   </svg>
                </button>

                {/* Scan Button (Premium Orange Theme) */}
                {config?.hostUser && (
                  <button onClick={handleScanAll} disabled={loading} className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-orange-500 to-red-600 text-white font-bold px-4 py-2 shadow-lg shadow-orange-900/20 transition-all hover:scale-[1.02] hover:shadow-orange-500/30 active:scale-95 disabled:opacity-50 disabled:scale-100 disabled:cursor-not-allowed flex items-center gap-2">
                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 pointer-events-none"></div>
                    <div className={`${loading ? 'animate-spin' : ''} relative z-10`}>
                      <svg className="w-4 h-4" style={{ transform: 'scaleX(-1)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </div>
                    <span className="relative z-10 text-sm">{loading ? 'Scanning...' : 'Scan'}</span>
                  </button>
                )}
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex gap-2 overflow-x-auto pb-1 mt-4 scrollbar-hide">
            {['All', 'Movie', 'TV Show', 'Music'].map(f => (
              <button 
                key={f} 
                onClick={() => setActiveFilter(f as FilterType)} 
                className={`px-4 py-1.5 text-xs font-bold rounded-full border transition-all duration-200 whitespace-nowrap
                  ${activeFilter === f 
                    ? 'bg-white text-black border-white shadow-md shadow-white/10 scale-100' 
                    : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:border-white/20 hover:text-white'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </header>
        {/* --- REPLACED HEADER END --- */}
        {/* --- REPLACED HEADER END --- */}

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