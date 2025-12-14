import React, { useState, useMemo, useRef, useEffect } from 'react';
import { MediaItem, MediaFile, FilterType } from './types';
import { scanDirectory, scanFileList, generateDemoData, triggerServerScan, syncFiles, fetchAllFiles } from './services/fileSystem';
import { fuzzyMatch, cleanName, getMediaType, getSeriesName } from './utils/mediaUtils';
import MediaList from './components/MediaList';
import MediaDetail from './components/MediaDetail';
import SettingsModal from './components/SettingsModal';

declare global {
  interface Window {
    showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
  }
}

const App: React.FC = () => {
  // App State
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [username, setUsername] = useState(() => localStorage.getItem('pf_username') || 'Guest');
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('pf_server_url') || '');
  
  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('All');
  const [qualityFilter, setQualityFilter] = useState<string>('All');
  
  const isNativeFileSystemSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Initial Load ---
  useEffect(() => {
    refreshData();
  }, [serverUrl]); // Refresh when server URL changes

  const getApiUrl = () => {
    return serverUrl || window.location.origin;
  };

  const refreshData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const files = await fetchAllFiles(getApiUrl());
      handleScanResult(files);
    } catch (e) {
      console.error(e);
      // Don't show error on first load if it's just empty or dev mode without server
      if (mediaItems.length > 0) setErrorMsg("Failed to refresh data from server.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = (newUsername: string, newUrl: string) => {
    setUsername(newUsername);
    setServerUrl(newUrl);
    localStorage.setItem('pf_username', newUsername);
    localStorage.setItem('pf_server_url', newUrl);
    setIsSettingsOpen(false);
    // Data refresh is triggered by useEffect on serverUrl change
    if (newUrl === serverUrl) refreshData();
  };

  // Group flat files into logical MediaItems
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
      if (!map.has(key)) {
        map.set(key, { id: key, name: name || file.rawFilename, type, files: [] });
      }
      map.get(key)!.files.push(file);
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  };

  const handleScanResult = (files: MediaFile[]) => {
    const grouped = groupMediaFiles(files);
    setMediaItems(grouped);
  };

  const handleClientScan = async (files: MediaFile[]) => {
    try {
      setLoading(true);
      // Sync to server
      await syncFiles(getApiUrl(), username, files);
      // Refresh to get full list including what we just uploaded + others
      await refreshData();
    } catch (e) {
      console.error(e);
      setErrorMsg("Scanned successfully, but failed to sync to server.");
      // Fallback: show local files mixed with existing state? 
      // For now just show local scan if sync fails
      handleScanResult(files);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFolder = async () => {
    if (isNativeFileSystemSupported) {
      try {
        const dirHandle = await window.showDirectoryPicker();
        setLoading(true);
        const files = await scanDirectory(dirHandle);
        await handleClientScan(files);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error(err);
          alert('Error scanning folder.');
        }
        setLoading(false);
      }
    } else {
      if (fileInputRef.current) fileInputRef.current.click();
    }
  };

  const handleServerScan = async () => {
    setLoading(true);
    try {
      await triggerServerScan(getApiUrl());
      await new Promise(r => setTimeout(r, 1000)); // Give DB a moment to write
      await refreshData();
    } catch (err) {
      console.error(err);
      alert("Failed to trigger server scan. Check Host URL in settings.");
      setLoading(false);
    }
  };

  const handleLegacyFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const inputFiles = event.target.files;
    if (!inputFiles || inputFiles.length === 0) return;
    setLoading(true);
    try {
      const files = await scanFileList(inputFiles);
      await handleClientScan(files);
    } catch (err) {
      alert("Error parsing files.");
      setLoading(false);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLoadDemo = async () => {
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    const demoFiles = await generateDemoData();
    // For demo, we don't sync, just show
    handleScanResult(demoFiles);
    setLoading(false);
  };

  const availableQualities = useMemo(() => {
    const qualities = new Set<string>();
    mediaItems.forEach(item => {
      item.files.forEach(f => {
        if (f.quality) qualities.add(f.quality);
        else qualities.add("Standard");
      });
    });
    return ['All', ...Array.from(qualities).sort()];
  }, [mediaItems]);

  const filteredItems = useMemo(() => {
    let result = mediaItems;
    if (activeFilter !== 'All') result = result.filter(item => item.type === activeFilter);
    if (qualityFilter !== 'All') {
      result = result.filter(item => {
        if (qualityFilter === 'Standard') return item.files.some(f => !f.quality);
        return item.files.some(f => f.quality === qualityFilter);
      });
    }
    if (searchQuery.trim()) {
      result = result.filter(item => {
        if (fuzzyMatch(item.name, searchQuery)) return true;
        return item.files.some(f => fuzzyMatch(f.rawFilename, searchQuery));
      });
    }
    return result;
  }, [mediaItems, activeFilter, qualityFilter, searchQuery]);

  return (
    <div className="h-full flex flex-col md:flex-row bg-gray-900 text-gray-100 overflow-hidden relative">
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
        initialUsername={username}
        initialHostUrl={serverUrl}
      />

      <input 
        type="file" 
        ref={fileInputRef} 
        // @ts-ignore
        webkitdirectory="" 
        directory=""
        multiple 
        className="hidden" 
        onChange={handleLegacyFileSelect} 
      />

      <div className={`flex-1 flex flex-col h-full relative ${selectedItem ? 'hidden md:flex' : 'flex'}`}>
        
        <header className="bg-plex-black border-b border-gray-800 p-4 sticky top-0 z-20 shadow-md">
          <div className="flex flex-col gap-4 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <span className="text-plex-orange text-2xl">►</span> PlexFlash
              </h1>
              <div className="flex gap-2 flex-wrap items-center">
                <button
                   onClick={() => setIsSettingsOpen(true)}
                   className="p-2 text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg mr-1"
                   title="Settings"
                >
                   <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                   </svg>
                </button>
                <button
                  onClick={handleLoadDemo}
                  disabled={loading}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 font-semibold rounded-lg text-xs transition-colors"
                >
                  Demo
                </button>
                <button
                  onClick={handleServerScan}
                  disabled={loading}
                  className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white font-semibold rounded-lg text-xs transition-colors shadow-lg"
                >
                  Scan Server
                </button>
                <button
                  onClick={handleSelectFolder}
                  disabled={loading}
                  className="px-4 py-1.5 bg-plex-orange hover:bg-yellow-600 text-black font-bold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-yellow-600/20"
                >
                  {loading ? `Syncing...` : 'Add Local Folder'}
                </button>
              </div>
            </div>

            <div className="relative w-full">
              <input
                type="text"
                placeholder="Search media..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-plex-orange focus:border-transparent transition-all placeholder-gray-500"
              />
              <svg className="w-5 h-5 text-gray-500 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar items-center">
              <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider mr-1">Type</span>
              {['All', 'Movie', 'TV Show', 'Music'].map((filter) => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter as FilterType)}
                  className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all border
                    ${activeFilter === filter 
                      ? 'bg-gray-200 border-gray-200 text-gray-900' 
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white hover:border-gray-500'}`}
                >
                  {filter}
                </button>
              ))}
            </div>

            {mediaItems.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar items-center">
                <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider mr-1">Quality</span>
                {availableQualities.map((qual) => (
                  <button
                    key={qual}
                    onClick={() => setQualityFilter(qual)}
                    className={`px-3 py-0.5 rounded text-[11px] font-bold whitespace-nowrap transition-all border
                      ${qualityFilter === qual 
                        ? 'bg-plex-orange/20 border-plex-orange text-plex-orange' 
                        : 'bg-gray-900 border-gray-800 text-gray-500 hover:border-gray-600 hover:text-gray-300'}`}
                  >
                    {qual}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {/* List Content */}
        <div className="flex-1 overflow-hidden flex flex-col relative">
          {errorMsg && (
             <div className="bg-red-900/50 border-b border-red-800 p-2 text-center text-xs text-red-200">
               {errorMsg}
             </div>
          )}

          {!isNativeFileSystemSupported && mediaItems.length === 0 && !loading && (
             <div className="bg-blue-900/20 border-b border-blue-900/50 p-2 text-center">
               <p className="text-xs text-blue-300">
                 Running in Compatibility Mode.
               </p>
             </div>
          )}

          {mediaItems.length === 0 && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 opacity-60">
              <svg className="w-24 h-24 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              <p>Connect to a host server or add local files.</p>
              <p className="text-sm mt-2 text-gray-600">Username: <span className="text-gray-400">{username}</span></p>
            </div>
          )}

          <MediaList 
            items={filteredItems} 
            onSelect={setSelectedItem} 
            selectedId={selectedItem?.id} 
          />
          
          <div className="bg-plex-black border-t border-gray-800 p-2 text-xs text-gray-500 flex justify-between px-4">
            <span className="flex items-center gap-2">
               <span>{mediaItems.length} Titles</span>
               {serverUrl && <span className="px-1.5 py-0.5 rounded bg-green-900/50 text-green-500 border border-green-900 text-[10px]">Connected</span>}
            </span>
            <span>{filteredItems.length} Showing</span>
          </div>
        </div>
      </div>

      <div 
        className={`
          fixed inset-0 z-30 md:static md:z-auto md:w-[450px] lg:w-[600px] transform transition-transform duration-300 ease-in-out bg-gray-800
          ${selectedItem ? 'translate-x-0' : 'translate-x-full md:translate-x-0 md:hidden'}
        `}
      >
        {selectedItem ? (
          <MediaDetail 
            item={selectedItem} 
            onClose={() => setSelectedItem(null)} 
          />
        ) : (
          <div className="hidden md:flex flex-col items-center justify-center h-full bg-gray-800 border-l border-gray-700 text-gray-500">
            <p>Select an item to view details</p>
          </div>
        )}
      </div>

    </div>
  );
};

export default App;