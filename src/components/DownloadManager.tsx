import React, { useEffect, useState } from 'react';
import { formatBytes } from '../utils/mediaUtils';

interface DownloadManagerProps {
  isOpen: boolean;
  onClose: () => void;
  pin: string;
}

interface DownloadStatus {
  id: string;
  filename: string;
  totalBytes: number;
  downloadedBytes: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  error?: string;
}

const DownloadManager: React.FC<DownloadManagerProps> = ({ isOpen, onClose, pin }) => {
  const [downloads, setDownloads] = useState<DownloadStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Poll for updates when the modal is open
  useEffect(() => {
    if (!isOpen) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/downloads', {
          headers: { 'x-app-pin': pin }
        });
        if (res.ok) {
          const data = await res.json();
          setDownloads(data);
          setError(null);
        }
      } catch (e) {
        console.error("Polling error", e);
        // Don't set global error to avoid flashing UI on single failed poll
      }
    };

    fetchStatus(); // Initial fetch
    const interval = setInterval(fetchStatus, 1500); // Poll every 1.5s

    return () => clearInterval(interval);
  }, [isOpen, pin]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4 sm:p-6 pointer-events-none">
      {/* Container - Pointer events auto to allow clicking inside */}
      <div className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-xl shadow-2xl pointer-events-auto overflow-hidden flex flex-col max-h-[80vh]">
        
        {/* Header */}
        <div className="p-4 bg-gray-900/90 border-b border-gray-700 flex justify-between items-center backdrop-blur-sm">
          <h3 className="text-white font-bold flex items-center gap-2">
            <svg className="w-5 h-5 text-plex-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Active Downloads
            <span className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded-full ml-2">
              {downloads.filter(d => d.status === 'downloading' || d.status === 'pending').length}
            </span>
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {downloads.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              No active downloads.
            </div>
          ) : (
            downloads.map((item) => {
              const percent = item.totalBytes > 0 
                ? Math.min(100, Math.round((item.downloadedBytes / item.totalBytes) * 100)) 
                : 0;
              
              const isDone = item.status === 'completed';
              const isError = item.status === 'error';

              return (
                <div key={item.id} className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/50">
                  <div className="flex justify-between items-start mb-1 gap-2">
                    <div className="text-xs font-bold text-gray-200 truncate flex-1" title={item.filename}>
                      {item.filename.split('/').pop()} {/* Show just filename, not full path */}
                    </div>
                    <div className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded 
                      ${isDone ? 'bg-green-500/20 text-green-400' : 
                        isError ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                      {item.status}
                    </div>
                  </div>

                  {/* Progress Bar Container */}
                  <div className="relative w-full h-1.5 bg-gray-700 rounded-full overflow-hidden mt-2 mb-1">
                    <div 
                      className={`absolute top-0 left-0 h-full transition-all duration-500 ease-out 
                        ${isDone ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-plex-orange'}`}
                      style={{ width: `${isDone ? 100 : percent}%` }}
                    />
                  </div>

                  {/* Meta Stats */}
                  <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-1">
                    <span>
                      {formatBytes(item.downloadedBytes)} / {item.totalBytes ? formatBytes(item.totalBytes) : '?'}
                    </span>
                    <span>{percent}%</span>
                  </div>
                  
                  {item.error && (
                    <div className="text-[10px] text-red-400 mt-1 truncate">
                      Error: {item.error}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default DownloadManager;