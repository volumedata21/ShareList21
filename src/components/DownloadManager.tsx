import React, { useEffect, useState } from 'react';
import { formatBytes } from '../utils/mediaUtils';
import { DownloadStatus, UploadStatus } from '../types'; 

interface DownloadManagerProps {
    isOpen: boolean;
    onClose: () => void;
    pin: string;
    downloads: DownloadStatus[];
    uploads: UploadStatus[];
}

interface DiskInfo {
    free: number;
    size: number;
}

const formatDuration = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m > 60) {
        const h = Math.floor(m / 60);
        const remM = m % 60;
        return `${h}h ${remM}m`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
};

const DownloadManager: React.FC<DownloadManagerProps> = ({ isOpen, onClose, pin, downloads, uploads }) => {
    
    // View mode for Tabs
    const [viewMode, setViewMode] = useState<'downloads' | 'uploads'>('downloads');
    const [disk, setDisk] = useState<DiskInfo | null>(null);

    // Poll ONLY for Disk Space (App.tsx handles downloads/uploads now)
    useEffect(() => {
        if (!isOpen) return;

        const fetchDisk = async () => {
            try {
                const diskRes = await fetch('/api/disk', { headers: { 'x-app-pin': pin } });
                if (diskRes.ok) setDisk(await diskRes.json());
            } catch (e) { console.error(e); }
        };

        fetchDisk();
        const interval = setInterval(fetchDisk, 5000); // Check disk every 5s is enough
        return () => clearInterval(interval);
    }, [isOpen, pin]);

    const handleCancel = async (id: string) => {
        await fetch('/api/download/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-app-pin': pin },
            body: JSON.stringify({ id })
        });
    };

    const handleRetry = async (id: string) => {
        await fetch('/api/download/retry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-app-pin': pin },
            body: JSON.stringify({ id })
        });
    };

    const handleClear = async () => {
        await fetch('/api/downloads/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-app-pin': pin }
        });
        // Optimistic UI update handled by parent prop updates
    };

    if (!isOpen) return null;

    // Calculate disk stats
    let freePercent = 0;
    let usedPercent = 0;
    if (disk && disk.size > 0) {
        freePercent = (disk.free / disk.size) * 100;
        usedPercent = 100 - freePercent;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
                
                {/* --- HEADER WITH TABS --- */}
                <div className="p-4 border-b border-gray-700 bg-gray-900/50 flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-plex-orange">⚡</span> Network Activity
                        </h2>
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    {/* TABS */}
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setViewMode('downloads')}
                            className={`flex-1 py-1.5 text-sm font-bold rounded transition-colors ${
                                viewMode === 'downloads' ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:bg-gray-800'
                            }`}
                        >
                            Downloads ({downloads.length})
                        </button>
                        <button 
                            onClick={() => setViewMode('uploads')}
                            className={`flex-1 py-1.5 text-sm font-bold rounded transition-colors ${
                                viewMode === 'uploads' ? 'bg-blue-900/40 text-blue-200 border border-blue-500/30' : 'text-gray-500 hover:bg-gray-800'
                            }`}
                        >
                            Serving ({uploads.length})
                        </button>
                    </div>
                </div>

                {/* --- LIST AREA --- */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    
                    {/* === VIEW 1: DOWNLOADS === */}
                    {viewMode === 'downloads' && (
                        <>
                            {downloads.length === 0 ? (
                                <div className="text-center text-gray-500 py-10">No active downloads</div>
                            ) : (
                                downloads.map(item => {
                                    const isError = item.status === 'error';
                                    const isCancelled = item.status === 'cancelled';
                                    const isDone = item.status === 'completed' || item.status === 'skipped';
                                    const isDownloading = item.status === 'downloading';
                                    const percent = item.totalBytes > 0 ? (item.downloadedBytes / item.totalBytes) * 100 : 0;
                                    const remainingBytes = item.totalBytes - item.downloadedBytes;
                                    const eta = (item.speed && item.speed > 0) ? remainingBytes / item.speed : -1;

                                    return (
                                        <div key={item.id} className="bg-gray-900/50 rounded p-3 border border-gray-700/50">
                                            <div className="flex justify-between items-start mb-1">
                                                <div className="text-sm font-bold text-gray-200 truncate pr-4 max-w-[70%]">
                                                    {item.filename}
                                                </div>
                                                <div className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${
                                                    isError ? 'bg-red-900/50 text-red-400' :
                                                    isDone ? 'bg-green-900/50 text-green-400' :
                                                    isCancelled ? 'bg-gray-700 text-gray-400' :
                                                    'bg-blue-900/50 text-blue-400'
                                                }`}>
                                                    {item.status}
                                                </div>
                                            </div>
                                            <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden mb-2">
                                                <div className={`h-full transition-all duration-500 ${isError || isCancelled ? 'bg-gray-500' : isDone ? 'bg-green-500' : 'bg-plex-orange'}`} style={{ width: `${percent}%` }}></div>
                                            </div>
                                            <div className="flex justify-between items-center text-[10px] text-gray-400 font-mono">
                                                <div className="flex gap-3">
                                                    <span>{formatBytes(item.downloadedBytes)} / {formatBytes(item.totalBytes)}</span>
                                                    {isDownloading && item.speed && <span className="text-gray-300">{formatBytes(item.speed)}/s</span>}
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {isDownloading && eta > 0 && <span>ETA: {formatDuration(eta)}</span>}
                                                    {(isDownloading || item.status === 'pending') && (
                                                        <button onClick={() => handleCancel(item.id)} className="text-red-400 hover:text-white">CANCEL</button>
                                                    )}
                                                    {(isError || isCancelled) && (
                                                        <button onClick={() => handleRetry(item.id)} className="text-plex-orange hover:text-white">RETRY</button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                            {/* Clear Finished Button (Only for Downloads) */}
                            {downloads.some(d => ['completed', 'error', 'cancelled'].includes(d.status)) && (
                                <button onClick={handleClear} className="w-full py-2 text-xs font-bold text-gray-500 hover:text-white border border-dashed border-gray-700 hover:border-gray-500 rounded transition-colors mt-4">
                                    Clear Finished
                                </button>
                            )}
                        </>
                    )}

                    {/* === VIEW 2: UPLOADS (New!) === */}
                    {viewMode === 'uploads' && (
                        <>
                            {uploads.length === 0 ? (
                                <div className="text-center text-gray-500 py-10">No active uploads</div>
                            ) : (
                                uploads.map(item => {
                                    const percent = item.totalBytes > 0 ? (item.transferredBytes / item.totalBytes) * 100 : 0;
                                    return (
                                        <div key={item.id} className="bg-blue-900/10 rounded p-3 border border-blue-500/20 relative overflow-hidden">
                                            {/* Pulse Animation */}
                                            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/50 animate-pulse"></div>
                                            
                                            <div className="flex justify-between items-start mb-2 pl-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[10px] uppercase font-bold text-blue-300 mb-0.5">Serving to: {item.user}</div>
                                                    <div className="text-sm font-bold text-gray-200 truncate">{item.filename}</div>
                                                </div>
                                                <div className="text-blue-400 font-mono text-xs bg-blue-900/40 px-2 py-1 rounded border border-blue-500/20 ml-2">
                                                    {formatBytes(item.speed)}/s
                                                </div>
                                            </div>

                                            <div className="h-1.5 w-full bg-gray-700/50 rounded-full overflow-hidden mb-2 ml-2 w-[calc(100%-8px)]">
                                                <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${percent}%` }}></div>
                                            </div>

                                            <div className="flex justify-between text-[10px] text-gray-400 font-mono pl-2">
                                                <span>Sent: {formatBytes(item.transferredBytes)}</span>
                                                <span>Total: {formatBytes(item.totalBytes)}</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </>
                    )}
                </div>

                {/* Disk Space Footer (Kept same) */}
                {disk && (
                    <div className="bg-gray-900 border-t border-gray-700 p-3">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>Storage Usage</span>
                            <span>{formatBytes(disk.free)} Free / {formatBytes(disk.size)} Total</span>
                        </div>
                        <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden flex">
                            <div className={`h-full transition-all duration-1000 ${usedPercent > 90 ? 'bg-red-500' : usedPercent > 75 ? 'bg-yellow-500' : 'bg-green-600'}`} style={{ width: `${usedPercent}%` }}></div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DownloadManager;