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
    status: 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled' | 'skipped';
    speed?: number; // bytes per second
    error?: string;
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

const DownloadManager: React.FC<DownloadManagerProps> = ({ isOpen, onClose, pin }) => {
    const [downloads, setDownloads] = useState<DownloadStatus[]>([]);

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
                }
            } catch (e) {
                // Silent error to prevent log spam
            }
        };

        fetchStatus(); // Initial fetch
        const interval = setInterval(fetchStatus, 1000); // Poll every 1s

        return () => clearInterval(interval);
    }, [isOpen, pin]);

    // Actions
    const handleCancel = async (id: string) => {
        try {
            await fetch('/api/download/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-app-pin': pin },
                body: JSON.stringify({ id })
            });
            // Optimistic update
            setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'cancelled', speed: 0 } : d));
        } catch (e) {
            console.error("Failed to cancel", e);
        }
    };

    const handleRetry = async (id: string) => {
        try {
            await fetch('/api/download/retry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-app-pin': pin },
                body: JSON.stringify({ id })
            });
            // Optimistic Update
            setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'pending', error: undefined } : d));
        } catch (e) {
            console.error("Retry failed", e);
        }
    };

    const handleClearCompleted = async () => {
        try {
            await fetch('/api/downloads/clear', {
                method: 'POST',
                headers: { 'x-app-pin': pin }
            });
            // Optimistic Update: Remove finished items locally
            setDownloads(prev => prev.filter(d => d.status === 'downloading' || d.status === 'pending'));
        } catch (e) {
            console.error("Clear failed", e);
        }
    };

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
                        Downloads
                    </h3>
                    <div className="flex items-center gap-2">
                        {/* Clear Button (Visible if there are items to clear) */}
                        {downloads.some(d => ['completed', 'error', 'cancelled', 'skipped'].includes(d.status)) && (
                            <button
                                onClick={handleClearCompleted}
                                className="text-[10px] uppercase font-bold text-gray-400 hover:text-white border border-gray-600 px-2 py-1 rounded transition-colors"
                            >
                                Clear Done
                            </button>
                        )}
                        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
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
                            const isSkipped = item.status === 'skipped';
                            const isError = item.status === 'error';
                            const isCancelled = item.status === 'cancelled';
                            const isActive = item.status === 'downloading';

                            // Speed & ETA Calc
                            const speed = item.speed || 0;
                            const remainingBytes = item.totalBytes - item.downloadedBytes;
                            const etaSeconds = speed > 0 ? remainingBytes / speed : 0;

                            return (
                                <div key={item.id} className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/50">
                                    <div className="flex justify-between items-start mb-1 gap-2">
                                        <div className="text-xs font-bold text-gray-200 truncate flex-1" title={item.filename}>
                                            {item.filename.split('/').pop()}
                                        </div>
                                        <div className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded 
                      ${isDone ? 'bg-green-500/20 text-green-400' :
                                                isSkipped ? 'bg-gray-600/50 text-gray-300' :
                                                    isError || isCancelled ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                                            {item.status}
                                        </div>
                                    </div>

                                    {/* Progress Bar Container */}
                                    <div className="relative w-full h-1.5 bg-gray-700 rounded-full overflow-hidden mt-2 mb-1">
                                        <div
                                            className={`absolute top-0 left-0 h-full transition-all duration-300 ease-out 
                        ${isDone ? 'bg-green-500' : isSkipped ? 'bg-gray-500' : (isError || isCancelled) ? 'bg-red-500' : 'bg-plex-orange'}`}
                                            style={{ width: `${(isDone || isCancelled || isSkipped) ? 100 : percent}%` }}
                                        />
                                    </div>

                                    {/* Meta Stats */}
                                    <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-1">
                                        <span>{formatBytes(item.downloadedBytes)} / {item.totalBytes ? formatBytes(item.totalBytes) : '?'}</span>

                                        {isActive ? (
                                            <span className="text-gray-300 flex gap-2">
                                                <span>{formatBytes(speed)}/s</span>
                                                <span className="text-gray-500">•</span>
                                                <span>ETA: {formatDuration(etaSeconds)}</span>
                                            </span>
                                        ) : isSkipped ? (
                                            <span className="text-gray-400 italic">File exists on disk</span>
                                        ) : (
                                            <span>{percent}%</span>
                                        )}
                                    </div>

                                    {item.error && (
                                        <div className="text-[10px] text-red-400 mt-1 truncate">
                                            Error: {item.error}
                                        </div>
                                    )}

                                    {/* Actions Row */}
                                    <div className="mt-2 flex justify-end gap-2">

                                        {/* Cancel Button */}
                                        {(isActive || item.status === 'pending') && (
                                            <button
                                                onClick={() => handleCancel(item.id)}
                                                className="text-[10px] font-bold text-red-400 hover:text-red-300 border border-red-900/50 bg-red-900/20 hover:bg-red-900/40 px-2 py-1 rounded transition-colors"
                                            >
                                                CANCEL
                                            </button>
                                        )}

                                        {/* Retry Button */}
                                        {(isError || isCancelled) && (
                                            <button
                                                onClick={() => handleRetry(item.id)}
                                                className="text-[10px] font-bold text-plex-orange hover:text-yellow-400 border border-plex-orange/50 bg-plex-orange/10 px-2 py-1 rounded transition-colors"
                                            >
                                                RETRY
                                            </button>
                                        )}
                                    </div>
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