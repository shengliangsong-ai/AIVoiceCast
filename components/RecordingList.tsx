import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RecordingSession, Channel, TranscriptItem, UserProfile } from '../types';
import { getUserRecordings, deleteRecordingReference, saveRecordingReference, getUserProfile } from '../services/firestoreService';
import { getLocalRecordings, deleteLocalRecording } from '../utils/db';
import { Play, FileText, Trash2, Calendar, Clock, Loader2, Video, X, HardDriveDownload, Sparkles, Mic, Monitor, CheckCircle, Languages, AlertCircle, ShieldOff, Volume2, Camera, Youtube, ExternalLink, HelpCircle, Info, Link as LinkIcon, Copy, CloudUpload, HardDrive, LogIn, Check, Terminal, Activity, ShieldAlert, History, Zap, Download, Share2, Square, CheckSquare, Pause, Search, Plus } from 'lucide-react';
import { auth } from '../services/firebaseConfig';
import { getYouTubeEmbedUrl, uploadToYouTube, getYouTubeVideoUrl, deleteYouTubeVideo } from '../services/youtubeService';
import { getDriveToken, signInWithGoogle, connectGoogleDrive } from '../services/authService';
import { ensureCodeStudioFolder, uploadToDrive, downloadDriveFileAsBlob, deleteDriveFile, getDriveFileStreamUrl } from '../services/googleDriveService';
import { ShareModal } from './ShareModal';
import { HANDCRAFTED_CHANNELS } from '../utils/initialData';

interface RecordingListProps {
  onBack?: () => void;
  onStartLiveSession?: (
    channel: Channel, 
    context?: string, 
    recordingEnabled?: boolean, 
    bookingId?: string, 
    videoEnabled?: boolean, 
    cameraEnabled?: boolean,
    activeSegment?: { index: number, lectureId: string }
  ) => void;
}

interface SyncLog {
    time: string;
    msg: string;
    type: 'info' | 'error' | 'warn' | 'success';
}

// Added missing return statement and completed truncated logic
export const RecordingList: React.FC<RecordingListProps> = ({ onBack, onStartLiveSession }) => {
  const [recordings, setRecordings] = useState<RecordingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null);
  const [resolvedMediaUrl, setResolvedMediaUrl] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [isRecorderModalOpen, setIsRecorderModalOpen] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [recordCamera, setRecordCamera] = useState(true);
  const [recordScreen, setRecordScreen] = useState(true);

  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [sharingTitle, setSharingTitle] = useState('');

  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [showSyncLog, setShowSyncLog] = useState(false);

  const currentUser = auth?.currentUser;

  const addSyncLog = (msg: string, type: SyncLog['type'] = 'info') => {
      const time = new Date().toLocaleTimeString();
      setSyncLogs(prev => [{ time, msg, type }, ...prev].slice(0, 50));
      console.log(`[Sync Diagnostic] ${msg}`);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let all: RecordingSession[] = [];
      const local = await getLocalRecordings();
      
      const localWithFreshUrls = local.map(rec => {
          if ((rec as any).blob instanceof Blob) {
              return { 
                  ...rec, 
                  mediaUrl: URL.createObjectURL((rec as any).blob) 
              };
          }
          return rec;
      });
      
      all = [...localWithFreshUrls];
      
      if (currentUser?.uid) {
          try {
              const cloud = await getUserRecordings(currentUser.uid);
              all = [...all, ...cloud];
          } catch (e: any) {
              console.warn("Cloud recordings unavailable:", e);
          }
      }
      
      const unique = Array.from(new Map(all.map(item => [item.id, item])).values());
      setRecordings(unique.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e: any) {
      console.error("Failed to load recording archive:", e);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const isYouTubeUrl = (url: string) => url?.includes('youtube.com') || url?.includes('youtu.be');
  const isDriveUrl = (url: string) => url?.startsWith('drive://') || url?.includes('drive.google.com');

  const extractYouTubeId = (url: string): string | null => {
      try {
          const urlObj = new URL(url);
          if (urlObj.hostname.includes('youtube.com')) {
              return urlObj.searchParams.get('v');
          } else if (urlObj.hostname.includes('youtu.be')) {
              return urlObj.pathname.slice(1);
          }
      } catch (e: any) {
          const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
          return match ? match[1] : null;
      }
      return null;
  };

  const handleCopyLink = (url: string, id: string) => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopyingId(id);
    setTimeout(() => setCopyingId(null), 2000);
  };

  const handleShare = (rec: RecordingSession) => {
    const url = isYouTubeUrl(rec.mediaUrl) ? rec.mediaUrl : `${window.location.origin}${window.location.pathname}?view=recordings&id=${rec.id}`;
    setShareUrl(url);
    setSharingTitle(rec.channelTitle);
    setShowShareModal(true);
  };

  const handleDownloadToDevice = async (rec: any) => {
      setDownloadingId(rec.id);
      try {
          let blob: Blob;
          if (rec.blob instanceof Blob) {
              blob = rec.blob;
          } else if (isDriveUrl(rec.mediaUrl)) {
              const token = getDriveToken() || await signInWithGoogle().then(() => getDriveToken());
              if (!token) throw new Error("Google access required.");
              const fileId = rec.mediaUrl.replace('drive://', '').split('&')[0];
              blob = await downloadDriveFileAsBlob(token, fileId);
          } else if (isYouTubeUrl(rec.mediaUrl)) {
              window.open(rec.mediaUrl, '_blank');
              setDownloadingId(null);
              return;
          } else {
              throw new Error("Source file not available for direct download.");
          }

          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${rec.channelTitle.replace(/\s+/g, '_')}_${rec.id}.webm`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
      } catch (e: any) {
          alert("Download failed: " + e.message);
      } finally {
          setDownloadingId(null);
      }
  };

  const handlePlayback = async (rec: RecordingSession) => {
      if (activeMediaId === rec.id) {
          setActiveMediaId(null);
          if (resolvedMediaUrl?.startsWith('blob:')) URL.revokeObjectURL(resolvedMediaUrl);
          setResolvedMediaUrl(null);
          return;
      }

      if (isYouTubeUrl(rec.mediaUrl)) {
          setResolvedMediaUrl(rec.mediaUrl);
          setActiveMediaId(rec.id);
          return;
      }

      if (isDriveUrl(rec.mediaUrl) || (rec.driveUrl && isDriveUrl(rec.driveUrl))) {
          setResolvingId(rec.id);
          try {
              const token = getDriveToken() || await connectGoogleDrive();
              const driveUri = isDriveUrl(rec.mediaUrl) ? rec.mediaUrl : rec.driveUrl!;
              const fileId = driveUri.replace('drive://', '').split('&')[0];
              const streamUrl = getDriveFileStreamUrl(token, fileId);
              setResolvedMediaUrl(streamUrl);
              setActiveMediaId(rec.id);
          } catch (e: any) {
              alert("Drive Access Denied: " + e.message);
          } finally {
              setResolvingId(null);
          }
      } else {
          setResolvedMediaUrl(rec.mediaUrl);
          setActiveMediaId(rec.id);
      }
  };

  const handleForceYouTubeSync = async (rec: any) => {
    if (!currentUser) return;
    
    setShowSyncLog(true);
    setSyncLogs([]);
    addSyncLog(`FORCING YouTube Transfer: ${rec.channelTitle}`, 'info');

    let token = getDriveToken();
    if (!token) {
        addSyncLog("OAuth missing. Requesting new session...", 'warn');
        const user = await signInWithGoogle();
        if (!user) {
            addSyncLog("Login canceled.", 'error');
            return;
        }
        token = getDriveToken();
    }

    setSyncingId(rec.id);
    try {
        let videoBlob: Blob;
        const isFromDrive = isDriveUrl(rec.mediaUrl);
        const originalDriveUrl = isFromDrive ? rec.mediaUrl : rec.driveUrl;
        
        if (rec.blob instanceof Blob) {
            addSyncLog("Loading local buffer (Source: Local)...", 'info');
            videoBlob = rec.blob;
        } else if (isFromDrive) {
            addSyncLog("Downloading source from Google Drive...", 'info');
            const fileId = rec.mediaUrl.replace('drive://', '').split('&')[0];
            videoBlob = await downloadDriveFileAsBlob(token!, fileId);
            addSyncLog("Drive download successful.", 'success');
        } else {
            throw new Error("Recording source not found locally or on Drive.");
        }

        addSyncLog("Phase 1: Obtaining Upload Location...", 'info');
        let videoUrl = "";
        try {
            const ytId = await uploadToYouTube(token!, videoBlob, {
                title: `${rec.channelTitle} (Neural Archive)`,
                description: `Transferred via AIVoiceCast.\nOriginal Source: ${rec.mediaUrl}`,
                privacyStatus: 'unlisted'
            });
            videoUrl = getYouTubeVideoUrl(ytId);
            addSyncLog(`YouTube Upload Success: ${ytId}`, 'success');
        } catch (ytErr: any) { 
            const msg = ytErr.message || String(ytErr);
            addSyncLog(`YouTube FAILED: ${msg}`, 'error');
            
            if (isFromDrive) {
                addSyncLog("RETENTION POLICY: Source is already on Drive. If YouTube fails, we keep the original Drive link active.", 'warn');
                setSyncingId(null);
                return; 
            }

            addSyncLog("FALLBACK: Saving local buffer to Drive instead...", 'warn');
            const folderId = await ensureCodeStudioFolder(token!);
            const driveFileId = await uploadToDrive(token!, folderId, `${rec.id}.webm`, videoBlob);
            videoUrl = `drive://${driveFileId}`;
            addSyncLog(`Drive Fallback Success: ${driveFileId}`, 'success');
        }

        addSyncLog("Phase 2: Updating neural ledger references...", 'info');
        const sessionData: RecordingSession = {
            ...rec,
            userId: currentUser.uid,
            mediaUrl: videoUrl,
            driveUrl: originalDriveUrl 
        };
        
        if (!isDriveUrl(rec.transcriptUrl)) {
            const transcriptText = `Neural Transcript: ${rec.channelTitle}\nID: ${rec.id}`;
            const transcriptBlob = new Blob([transcriptText], { type: 'text/plain' });
            const folderId = await ensureCodeStudioFolder(token!);
            const tFileId = await uploadToDrive(token!, folderId, `${rec.id}_transcript.txt`, transcriptBlob);
            sessionData.transcriptUrl = `drive://${tFileId}`;
        }
        
        await saveRecordingReference(sessionData);
        addSyncLog("Neural ledger updated to new URI.", 'success');
        
        setTimeout(() => {
            loadData();
            setSyncingId(null);
        }, 800);
        
    } catch (e: any) {
        addSyncLog(`CRITICAL SYNC ERROR: ${e.message}`, 'error');
        setSyncingId(null);
    }
  };

  const handleManualSync = async (rec: any) => {
    if (!currentUser || !rec.blob) return;
    
    setShowSyncLog(true);
    setSyncLogs([]);
    addSyncLog(`Auto-Sync: ${rec.channelTitle}`, 'info');

    let token = getDriveToken();
    if (!token) {
        addSyncLog("OAuth missing. Re-authenticating...", 'warn');
        const user = await signInWithGoogle();
        if (!user) {
            addSyncLog("Action canceled.", 'error');
            return;
        }
        token = getDriveToken();
    }

    setSyncingId(rec.id);
    try {
        const profile = await getUserProfile(currentUser.uid);
        const pref = profile?.preferredRecordingTarget || 'drive';
        addSyncLog(`Target: ${pref.toUpperCase()}`, 'info');

        const folderId = await ensureCodeStudioFolder(token!);
        const videoBlob = rec.blob;
        const transcriptText = `Neural Transcript: ${rec.channelTitle}\nID: ${rec.id}`;
        const transcriptBlob = new Blob([transcriptText], { type: 'text/plain' });

        let mediaUrl = "";
        let driveUrl = "";

        addSyncLog("Syncing to Google Drive...", 'info');
        const driveFileId = await uploadToDrive(token!, folderId, `${rec.id}.webm`, videoBlob);
        driveUrl = `drive://${driveFileId}`;
        addSyncLog("Drive Sync Success.", 'success');

        if (pref === 'youtube') {
            addSyncLog("Syncing to YouTube...", 'info');
            try {
                const ytId = await uploadToYouTube(token!, videoBlob, {
                    title: `${rec.channelTitle} (AI)`,
                    description: `Recorded via AIVoiceCast.`,
                    privacyStatus: 'unlisted'
                });
                mediaUrl = getYouTubeVideoUrl(ytId);
                addSyncLog(`YouTube Success: ${ytId}`, 'success');
            } catch (ytErr: any) { 
                addSyncLog(`YouTube Sync Failed. Using Drive as primary URI.`, 'warn');
            }
        }

        if (!mediaUrl) mediaUrl = driveUrl;

        addSyncLog("Archiving transcript...");
        const tFileId = await uploadToDrive(token!, folderId, `${rec.id}_transcript.txt`, transcriptBlob);
        
        const sessionData: RecordingSession = {
            id: rec.id, userId: currentUser.uid, channelId: rec.channelId,
            channelTitle: rec.channelTitle, channelImage: rec.channelImage,
            timestamp: rec.timestamp, 
            mediaUrl: mediaUrl,
            driveUrl: driveUrl,
            mediaType: rec.mediaType, 
            transcriptUrl: `drive://${tFileId}`
        };
        
        await saveRecordingReference(sessionData);
        addSyncLog("Neural ledger updated.", 'success');
        
        setTimeout(() => { loadData(); setSyncingId(null); }, 800);
        
    } catch (e: any) {
        addSyncLog(`SYNC FAILED: ${e.message}`, 'error');
        setSyncingId(null);
    }
  };

  const purgeRecordingAssets = async (rec: RecordingSession, token: string | null) => {
    const isCloud = !rec.mediaUrl.startsWith('blob:') && !rec.mediaUrl.startsWith('data:');
    if (!isCloud) {
        await deleteLocalRecording(rec.id);
        return;
    }

    const ytUri = isYouTubeUrl(rec.mediaUrl) ? rec.mediaUrl : (isYouTubeUrl(rec.driveUrl || '') ? rec.driveUrl : '');
    const driveUri = isDriveUrl(rec.mediaUrl) ? rec.mediaUrl : (isDriveUrl(rec.driveUrl || '') ? rec.driveUrl : '');
    const transcriptUri = isDriveUrl(rec.transcriptUrl) ? rec.transcriptUrl : '';

    if (ytUri && token) {
        const videoId = extractYouTubeId(ytUri);
        if (videoId) {
            try { 
                addSyncLog(`Removing YouTube Asset: ${videoId}...`, 'info');
                await deleteYouTubeVideo(token, videoId); 
                addSyncLog(`YouTube asset purged.`, 'success');
            } catch (e: any) {
                addSyncLog(`YouTube Purge FAILED: ${e.message}`, 'error');
            }
        }
    }

    if (driveUri && token) {
        const fileId = driveUri.replace('drive://', '').split('&')[0];
        if (fileId) {
            try { 
                addSyncLog(`Removing Drive Asset: ${fileId}...`, 'info');
                await deleteDriveFile(token, fileId); 
                addSyncLog(`Drive asset purged.`, 'success');
            } catch (e: any) {
                addSyncLog(`Drive Purge FAILED: ${e.message}`, 'error');
            }
        }
    }

    if (transcriptUri && token) {
        const tFileId = transcriptUri.replace('drive://', '').split('&')[0];
        if (tFileId) {
            try { await deleteDriveFile(token, tFileId); } catch (e: any) {}
        }
    }

    await deleteRecordingReference(rec.id, rec.mediaUrl, rec.transcriptUrl);
  };

  // Fixed the truncated handleDelete function
  const handleDelete = async (rec: RecordingSession) => {
    if (!confirm(`Are you sure you want to permanently delete "${rec.channelTitle}"? This will remove the video from YouTube and Google Drive if synced.`)) return;
    
    setDeletingId(rec.id);
    try {
        const token = getDriveToken();
        await purgeRecordingAssets(rec, token);
        setRecordings(prev => prev.filter(r => r.id !== rec.id));
    } catch (e: any) {
        alert("Delete failed: " + e.message);
    } finally {
        setDeletingId(null);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Permanently delete ${selectedIds.size} recordings and their assets?`)) return;

    setIsBulkDeleting(true);
    const token = getDriveToken();
    try {
      for (const id of Array.from(selectedIds)) {
        const rec = recordings.find(r => r.id === id);
        if (rec) {
          await purgeRecordingAssets(rec, token);
        }
      }
      setRecordings(prev => prev.filter(r => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleStartQuickRecording = () => {
    const defaultChannel: Channel = HANDCRAFTED_CHANNELS[0]; 
    if (onStartLiveSession) {
        onStartLiveSession(defaultChannel, meetingTitle || "Manual Recording", true, undefined, recordScreen, recordCamera);
    }
    setIsRecorderModalOpen(false);
  };

  // Added missing return statement and JSX implementation
  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="w-2 h-6 bg-red-500 rounded-full"></span>
            <span>Recording Archive</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">Review and manage your past AI interaction sessions.</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsRecorderModalOpen(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors text-xs font-bold shadow-lg"
          >
            <Plus size={14} /><span>New Record</span>
          </button>
          {selectedIds.size > 0 && (
            <button 
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white rounded-lg transition-all text-xs font-bold border border-red-500/20"
            >
              {isBulkDeleting ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>}
              <span>Delete {selectedIds.size}</span>
            </button>
          )}
          <button onClick={loadData} className="p-2 text-slate-400 hover:text-white transition-colors bg-slate-900 rounded-lg border border-slate-800">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-red-400 gap-4">
          <Loader2 className="animate-spin" size={32} />
          <span className="text-xs font-bold uppercase tracking-widest animate-pulse">Syncing Archive...</span>
        </div>
      ) : recordings.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-500 bg-slate-900/30 rounded-3xl border-2 border-dashed border-slate-800">
          <Video size={48} className="mb-4 opacity-10" />
          <p className="font-bold">The archive is empty.</p>
          <p className="text-xs mt-2">Sessions you record will appear here for review and sharing.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {recordings.map((rec) => {
            const isSelected = selectedIds.has(rec.id);
            return (
              <div key={rec.id} className={`bg-slate-900 border ${isSelected ? 'border-red-500' : 'border-slate-800'} rounded-2xl overflow-hidden hover:border-red-500/50 transition-all group flex flex-col shadow-xl relative`}>
                {/* Checkbox Overlay */}
                <button 
                  onClick={(e) => { e.stopPropagation(); toggleSelection(rec.id); }}
                  className={`absolute top-4 left-4 z-20 p-1.5 rounded-lg border transition-all ${isSelected ? 'bg-red-600 border-red-500 text-white' : 'bg-black/40 border-white/20 text-white opacity-0 group-hover:opacity-100'}`}
                >
                  <Check size={14} strokeWidth={4}/>
                </button>

                {/* Thumbnail / Playback Overlay */}
                <div className="aspect-video relative bg-black group/player overflow-hidden">
                  {activeMediaId === rec.id ? (
                    resolvedMediaUrl ? (
                      isYouTubeUrl(resolvedMediaUrl) ? (
                        <iframe 
                          src={getYouTubeEmbedUrl(extractYouTubeId(resolvedMediaUrl)!)} 
                          className="w-full h-full border-none"
                          allowFullScreen
                        />
                      ) : (
                        <video 
                          src={resolvedMediaUrl} 
                          controls 
                          autoPlay 
                          className="w-full h-full object-contain"
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-950">
                        <Loader2 size={32} className="animate-spin text-red-500" />
                      </div>
                    )
                  ) : (
                    <>
                      {rec.channelImage ? (
                        <img src={rec.channelImage} alt="" className="w-full h-full object-cover opacity-60 group-hover/player:scale-105 transition-transform duration-700" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-800">
                          <Video size={48} />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/20 group-hover/player:bg-black/0 transition-colors"></div>
                      <button 
                        onClick={() => handlePlayback(rec)}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        <div className="w-14 h-14 bg-red-600/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-2xl group-hover/player:scale-110 transition-transform">
                          <Play size={28} fill="white" className="text-white ml-1" />
                        </div>
                      </button>
                    </>
                  )}
                  
                  {/* Status Badges */}
                  <div className="absolute top-4 right-4 flex gap-1">
                    {isYouTubeUrl(rec.mediaUrl) && <div className="bg-red-600 text-white p-1 rounded shadow-lg"><Youtube size={12}/></div>}
                    {isDriveUrl(rec.mediaUrl) && <div className="bg-indigo-600 text-white p-1 rounded shadow-lg"><HardDrive size={12}/></div>}
                  </div>
                </div>

                {/* Content */}
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <div className="min-w-0">
                      <h3 className="font-bold text-white leading-tight truncate pr-2" title={rec.channelTitle}>{rec.channelTitle}</h3>
                      <div className="flex items-center gap-3 mt-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        <span className="flex items-center gap-1"><Calendar size={10}/> {new Date(rec.timestamp).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1"><Clock size={10}/> {new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button 
                        onClick={() => handleShare(rec)}
                        className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-white transition-colors"
                        title="Share Recording"
                      >
                        <Share2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDelete(rec)}
                        disabled={deletingId === rec.id}
                        className="p-2 hover:bg-red-950/30 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
                        title="Delete Recording"
                      >
                        {deletingId === rec.id ? <Loader2 size={16} className="animate-spin"/> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Storage Management */}
                  <div className="mt-auto space-y-3">
                    <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-xl border border-slate-800">
                      <div className="flex flex-col">
                        <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest mb-0.5">Archive Origin</span>
                        <div className="flex items-center gap-2">
                          {isYouTubeUrl(rec.mediaUrl) ? (
                            <span className="text-[10px] font-black text-red-500 uppercase">YouTube Post</span>
                          ) : isDriveUrl(rec.mediaUrl) ? (
                            <span className="text-[10px] font-black text-indigo-400 uppercase">Cloud Drive</span>
                          ) : (
                            <span className="text-[10px] font-black text-amber-500 uppercase flex items-center gap-1"><ShieldAlert size={10}/> Local Buffer</span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {!(isYouTubeUrl(rec.mediaUrl) || isDriveUrl(rec.mediaUrl)) && (
                          <button 
                            onClick={() => handleManualSync(rec)}
                            disabled={syncingId === rec.id}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-black uppercase rounded-lg shadow-lg disabled:opacity-50 transition-all active:scale-95"
                          >
                            {syncingId === rec.id ? <Loader2 size={10} className="animate-spin"/> : <CloudUpload size={10} className="inline mr-1"/>}
                            {syncingId === rec.id ? 'Syncing' : 'Sync'}
                          </button>
                        )}
                        {isDriveUrl(rec.mediaUrl) && !isYouTubeUrl(rec.mediaUrl) && (
                           <button 
                              onClick={() => handleForceYouTubeSync(rec)}
                              disabled={syncingId === rec.id}
                              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-[9px] font-black uppercase rounded-lg shadow-lg disabled:opacity-50 transition-all active:scale-95"
                           >
                              {syncingId === rec.id ? <Loader2 size={10} className="animate-spin"/> : <Youtube size={10} className="inline mr-1"/>}
                              {syncingId === rec.id ? 'Posting' : 'Post'}
                           </button>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleDownloadToDevice(rec)}
                        disabled={downloadingId === rec.id}
                        className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] flex items-center justify-center gap-2 border border-slate-700 transition-all active:scale-95 disabled:opacity-50"
                      >
                        {downloadingId === rec.id ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>}
                        Device
                      </button>
                      <a 
                        href={rec.transcriptUrl.startsWith('drive://') ? '#' : rec.transcriptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-[0.1em] flex items-center justify-center gap-2 border border-slate-700 transition-all active:scale-95"
                      >
                        <FileText size={14}/>
                        Script
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sync Diagnostic Overlay */}
      {showSyncLog && (
          <div className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
              <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col animate-fade-in-up">
                  <div className="p-6 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                          <Activity size={20} className="text-red-500"/>
                          <h3 className="font-bold text-white uppercase tracking-[0.2em] text-sm">Neural Sync Diagnostics</h3>
                      </div>
                      <button onClick={() => setShowSyncLog(false)} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 hover:text-white transition-colors"><X size={20}/></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6 space-y-3 font-mono text-[10px] bg-black/40 min-h-[300px] scrollbar-hide">
                      {syncLogs.length === 0 ? (
                          <div className="h-full flex items-center justify-center text-slate-700 italic">Listening for ledger handshake events...</div>
                      ) : syncLogs.map((log, i) => (
                          <div key={i} className={`flex gap-3 leading-relaxed ${log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-amber-400' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-500'}`}>
                              <span className="opacity-30 shrink-0">[{log.time}]</span>
                              <span className="break-words">{log.msg}</span>
                          </div>
                      ))}
                  </div>
                  <div className="p-4 bg-slate-950 border-t border-slate-800 text-center">
                      <p className="text-[8px] text-slate-600 font-black uppercase tracking-[0.4em]">AIVoiceCast Transfer Protocol v5.0.0</p>
                  </div>
              </div>
          </div>
      )}

      {/* Recorder Modal */}
      {isRecorderModalOpen && (
          <div className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in">
              <div className="max-w-lg w-full bg-slate-900 border border-slate-700 rounded-[3rem] p-10 shadow-2xl space-y-8 animate-fade-in-up">
                  <div className="text-center">
                      <div className="inline-flex p-4 bg-red-600/10 rounded-full text-red-500 mb-4 border border-red-500/20">
                          <Mic size={32}/>
                      </div>
                      <h2 className="text-3xl font-black text-white italic tracking-tighter uppercase">Start New Record</h2>
                      <p className="text-slate-400 text-sm mt-2 font-medium">Initialize persistent neural scribe for manual activity.</p>
                  </div>

                  <div className="space-y-6">
                      <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">Session Identity</label>
                          <input 
                              type="text" 
                              value={meetingTitle}
                              onChange={e => setMeetingTitle(e.target.value)}
                              placeholder="e.g. Brainstorming System Design"
                              className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-red-500/30 transition-all shadow-inner"
                          />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                          <button 
                            onClick={() => setRecordCamera(!recordCamera)}
                            className={`p-5 rounded-[2rem] border-2 flex flex-col items-center gap-3 transition-all ${recordCamera ? 'bg-red-600 border-red-500 text-white shadow-xl shadow-red-900/20' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                          >
                            <Camera size={24}/>
                            <span className="text-[10px] font-black uppercase tracking-widest">Camera</span>
                          </button>
                          <button 
                            onClick={() => setRecordScreen(!recordScreen)}
                            className={`p-5 rounded-[2rem] border-2 flex flex-col items-center gap-3 transition-all ${recordScreen ? 'bg-red-600 border-red-500 text-white shadow-xl shadow-red-900/20' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                          >
                            <Monitor size={24}/>
                            <span className="text-[10px] font-black uppercase tracking-widest">Screen</span>
                          </button>
                      </div>
                  </div>

                  <div className="flex gap-4">
                      <button onClick={() => setIsRecorderModalOpen(false)} className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-2xl font-black uppercase tracking-widest text-xs transition-all">Cancel</button>
                      <button onClick={handleStartQuickRecording} className="flex-[2] py-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-red-900/40 transition-all active:scale-95">Link Neural Scribe</button>
                  </div>
              </div>
          </div>
      )}

      {showShareModal && (
          <ShareModal 
            isOpen={true} 
            onClose={() => setShowShareModal(false)} 
            link={shareUrl} 
            title={sharingTitle}
            onShare={async () => {}}
            currentUserUid={currentUser?.uid}
          />
      )}
    </div>
  );
};