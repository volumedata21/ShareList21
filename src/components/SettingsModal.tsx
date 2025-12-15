import React, { useState, useEffect } from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (username: string, hostUrl: string) => void;
  initialUsername: string;
  initialHostUrl: string;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ 
  isOpen, onClose, onSave, initialUsername, initialHostUrl 
}) => {
  const [username, setUsername] = useState(initialUsername);
  const [hostUrl, setHostUrl] = useState(initialHostUrl);

  useEffect(() => {
    if (isOpen) {
      setUsername(initialUsername);
      setHostUrl(initialHostUrl);
    }
  }, [isOpen, initialUsername, initialHostUrl]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-gray-700 bg-gray-900/50">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <svg className="w-6 h-6 text-plex-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </h2>
        </div>

        <div className="p-6 space-y-6">
          
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase text-gray-400 tracking-wider">My Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Alice"
              className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white focus:border-plex-orange focus:ring-1 focus:ring-plex-orange outline-none transition-colors"
            />
            <p className="text-xs text-gray-500">This name will be tagged on files you scan from this browser.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase text-gray-400 tracking-wider">Host Server URL</label>
            <input 
              type="text" 
              value={hostUrl}
              onChange={(e) => setHostUrl(e.target.value)}
              placeholder="e.g. http://192.168.1.100:80"
              className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white focus:border-plex-orange focus:ring-1 focus:ring-plex-orange outline-none transition-colors font-mono text-sm"
            />
            <p className="text-xs text-gray-500">Leave blank to use the server hosting this app (localhost).</p>
          </div>

        </div>

        <div className="p-6 border-t border-gray-700 bg-gray-900/50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white font-semibold transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={() => onSave(username, hostUrl)}
            className="px-6 py-2 bg-plex-orange hover:bg-yellow-600 text-black font-bold rounded shadow-lg transition-transform transform active:scale-95"
          >
            Save & Sync
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;