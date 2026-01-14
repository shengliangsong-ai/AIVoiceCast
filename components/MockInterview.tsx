
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MockInterviewRecording, TranscriptItem, CodeFile, UserProfile, Channel, CodeProject } from '../types';
import { auth } from '../services/firebaseConfig';
import { saveInterviewRecording, getPublicInterviews, deleteInterview, updateUserProfile, uploadFileToStorage, getUserInterviews, updateInterviewMetadata, saveCodeProject, getCodeProject, getUserProfile } from '../services/firestoreService';
import { GeminiLiveService } from '../services/geminiLive';
import { GoogleGenAI, Type } from '@google/genai';
import { generateSecureId } from '../utils/idUtils';
import { CodeStudio } from './CodeStudio';
import { MarkdownView } from './MarkdownView';
import { ArrowLeft, Video, Mic, Monitor, Play, Save, Loader2, Search, Trash2, CheckCircle, X, Download, ShieldCheck, User, Users, Building, FileText, ChevronRight, Zap, SidebarOpen, SidebarClose, Code, MessageSquare, Sparkles, Languages, Clock, Camera, Bot, CloudUpload, Trophy, BarChart3, ClipboardCheck, Star, Upload, FileUp, Linkedin, FileCheck, Edit3, BookOpen, Lightbulb, Target, ListChecks, MessageCircleCode, GraduationCap, Lock, Globe, ExternalLink, PlayCircle, RefreshCw, FileDown, Briefcase, Package, Code2, StopCircle, Youtube, AlertCircle, Eye, EyeOff, SaveAll, Wifi, WifiOff, Activity, ShieldAlert, Timer, FastForward, ClipboardList, Layers, Bug, Flag, Minus, Fingerprint, FileSearch, RefreshCcw, HeartHandshake, Speech, Send, History, Compass, Square, CheckSquare, Cloud, Award, Terminal, CodeSquare, Quote, Image as ImageIcon, Sparkle, LayoutPanelTop, TerminalSquare, FolderOpen, HardDrive, Shield, Database, Link as LinkIcon, UserCircle } from 'lucide-react';
import { getGlobalAudioContext, getGlobalMediaStreamDest, warmUpAudioContext, stopAllPlatformAudio } from '../utils/audioUtils';
import { getDriveToken, signInWithGoogle, connectGoogleDrive } from '../services/authService';
import { ensureFolder, uploadToDrive, downloadDriveFileAsBlob, deleteDriveFile, ensureCodeStudioFolder } from '../services/googleDriveService';
import { getYouTubeVideoUrl, uploadToYouTube, getYouTubeEmbedUrl, deleteYouTubeVideo } from '../services/youtubeService';

interface OptimizedStarStory {
  title: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  coachTip: string;
}

interface MockInterviewReport {
  score: number;
  technicalSkills: string;
  communication: string;
  collaboration: string;
  strengths: string[];
  areasForImprovement: string[];
  verdict: 'Strong Hire' | 'Hire' | 'No Hire' | 'Strong No Hire' | 'Move Forward' | 'Reject';
  summary: string;
  optimizedStarStories?: OptimizedStarStory[];
  idealAnswers?: { question: string, expectedAnswer: string, rationale: string }[];
  learningMaterial: string; 
  todoList?: string[];
}

interface MockInterviewProps {
  onBack: () => void;
  userProfile: UserProfile | null;
  onStartLiveSession: (channel: Channel, context?: string, recordingEnabled?: boolean, bookingId?: string, videoEnabled?: boolean, cameraEnabled?: boolean, activeSegment?: { index: number, lectureId: string }) => void;
}

const getCodeTool: any = {
  name: "get_current_code",
  description: "Read the current state of the workspace. ALWAYS use this before judging code or providing specific line-by-line feedback.",
  parameters: { 
    type: Type.OBJECT, 
    properties: {
      filename: { type: Type.STRING, description: "Optional: The specific file to read. If omitted, reads the primary/active file." }
    }
  }
};

const updateActiveFileTool: any = {
  name: "update_active_file",
  description: "Modify the active code file. Use this for adding comments, hints, or boilerplate.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      new_content: { type: Type.STRING, description: "Full new content for the file." }
    },
    required: ["new_content"]
  }
};

const createInterviewFileTool: any = {
  name: "create_interview_file",
  description: "Generate a new problem file in the workspace. This is the primary way to present technical challenges.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      filename: { type: Type.STRING, description: "Descriptive name (e.g. 'binary_tree_sum.cpp')." },
      content: { type: Type.STRING, description: "Initial file content (problem statement + template)." }
    },
    required: ["filename", "content"]
  }
};

type VideoFilter = 'none' | 'blur' | 'sepia' | 'executive' | 'hacker';

function getLanguageFromExt(filename: string): CodeFile['language'] {
    if (!filename) return 'text';
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'jsx') return 'javascript (react)';
    if (ext === 'tsx') return 'typescript (react)';
    if (ext === 'js') return 'javascript';
    if (ext === 'ts') return 'typescript';
    if (ext === 'py') return 'python';
    if (['cpp', 'hpp', 'cc', 'cxx'].includes(ext || '')) return 'c++';
    if (ext === 'c' || ext === 'h') return 'c';
    if (ext === 'java') return 'java';
    if (ext === 'rs') return 'rust';
    if (ext === 'go') return 'go';
    if (ext === 'cs') return 'c#';
    if (ext === 'html') return 'html';
    if (ext === 'css') return 'css';
    if (ext === 'json') return 'json';
    if (ext === 'md') return 'markdown';
    if (['puml', 'plantuml'].includes(ext || '')) return 'plantuml';
    if (['draw', 'whiteboard', 'wb'].includes(ext || '')) return 'whiteboard';
    if (ext === 'pdf') return 'pdf';
    return 'text';
}

export const MockInterview: React.FC<MockInterviewProps> = ({ onBack, userProfile, onStartLiveSession }) => {
  const currentUser = auth?.currentUser;

  const [view, setView] = useState<'hub' | 'prep' | 'interview' | 'report' | 'coaching' | 'artifact_viewer'>('hub');
  const [hubTab, setHubTab] = useState<'history' | 'explore'>('history');
  const [myInterviews, setMyInterviews] = useState<MockInterviewRecording[]>([]);
  const [publicInterviews, setPublicInterviews] = useState<MockInterviewRecording[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [showCodePasteOverlay, setShowCodePasteOverlay] = useState(false);
  const [pasteCodeBuffer, setPasteCodeBuffer] = useState('');
  const [pasteCodeLang, setPasteCodeLang] = useState('cpp');

  const [isRecording, setIsRecording] = useState(false);
  const [isAiConnected, setIsAiConnected] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [driveToken, setDriveToken] = useState<string | null>(getDriveToken());
  
  const [timeLeft, setTimeLeft] = useState<number>(0); 
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkpointTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isCheckpointing, setIsCheckpointing] = useState(false);

  const [apiLogs, setApiLogs] = useState<{time: string, msg: string, type: 'info' | 'error' | 'warn'}[]>([]);
  const [coachingLogs, setCoachingLogs] = useState<{time: string, msg: string, type: 'info' | 'error' | 'warn'}[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // ADDED: Missing sync log state used by handleForceYouTubeSync
  const [syncLogs, setSyncLogs] = useState<{time: string, msg: string, type: 'info' | 'error' | 'warn' | 'success'}[]>([]);
  const [showSyncLog, setShowSyncLog] = useState(false);

  const reconnectAttemptsRef = useRef(0);
  const activeServiceIdRef = useRef<string | null>(null);
  const isEndingRef = useRef(false);

  const [synthesisStep, setSynthesisStep] = useState<string>('');
  const [synthesisPercent, setSynthesisPercent] = useState(0);

  // PREP STATE
  const [mode, setMode] = useState<'coding' | 'system_design' | 'behavioral' | 'quick_screen' | 'assessment_30' | 'assessment_60'>('coding');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [language, setLanguage] = useState(userProfile?.defaultLanguage || 'C++');
  const [jobDescType, setJobDescType] = useState<'text' | 'link'>('text');
  const [jobDesc, setJobDesc] = useState('');
  const [interviewerInfo, setInterviewerInfo] = useState('');
  const [intervieweeInfo, setIntervieweeInfo] = useState('');
  const [resumeText, setResumeText] = useState(userProfile?.resumeText || '');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const transcriptRef = useRef<TranscriptItem[]>([]); 
  const [coachingTranscript, setCoachingTranscript] = useState<TranscriptItem[]>([]);
  const [isCoachingSyncing, setIsCoachingSyncing] = useState(false);
  const [initialStudioFiles, setInitialStudioFiles] = useState<CodeFile[]>([]);

  const [activeRecording, setActiveRecording] = useState<MockInterviewRecording | null>(null);

  const [videoFilter, setVideoFilter] = useState<VideoFilter>('none');
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [sessionPrefix, setSessionPrefix] = useState<string>('');
  
  const activeCodeFilesMapRef = useRef<Map<string, CodeFile>>(new Map());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  const [report, setReport] = useState<MockInterviewReport | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [sessionProject, setSessionProject] = useState<CodeProject | null>(null);
  const [loadingProject, setLoadingProject] = useState(false);

  const liveServiceRef = useRef<GeminiLiveService | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoBlobRef = useRef<Blob | null>(null);
  
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const activeScreenStreamRef = useRef<MediaStream | null>(null);

  const logApi = (msg: string, type: 'info' | 'error' | 'warn' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setApiLogs(prev => [{time, msg, type}, ...prev].slice(0, 50));
  };

  // ADDED: Missing addSyncLog helper (similar to RecordingList.tsx)
  const addSyncLog = useCallback((msg: string, type: 'info' | 'error' | 'warn' | 'success' = 'info') => {
      const time = new Date().toLocaleTimeString();
      setSyncLogs(prev => [{ time, msg, type }, ...prev].slice(0, 50));
      console.log(`[Sync Diagnostic] ${msg}`);
  }, []);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    if (userProfile?.resumeText && !resumeText) {
      setResumeText(userProfile.resumeText);
    }
  }, [userProfile]);

  const handleSyncFromProfile = () => {
    if (userProfile) {
        let profileSummary = "";
        if (userProfile.headline) profileSummary += `Headline: ${userProfile.headline}\n`;
        if (userProfile.company) profileSummary += `Current Company: ${userProfile.company}\n`;
        if (userProfile.linkedinUrl) profileSummary += `LinkedIn: ${userProfile.linkedinUrl}\n`;
        if (profileSummary) {
            setIntervieweeInfo(prev => prev ? `${prev}\n\n${profileSummary}` : profileSummary);
            logApi("Synced candidate identity from User Profile.", "info");
        } else {
            alert("No profile data found. Go to Settings to update your professional profile.");
        }
    }
  };

  const handleConnectDrive = async () => {
    try {
        const token = await connectGoogleDrive();
        setDriveToken(token);
        logApi("Google Drive Authorized Successfully.");
    } catch(e) {
        logApi("Google Drive Auth Failed.", "error");
    }
  };

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });
  };

  const handleDeleteSelected = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!confirm(`Permanently delete ${count} selected evaluations?`)) return;
    setIsBulkDeleting(true);
    try {
        const token = getDriveToken();
        const ids = Array.from(selectedIds);
        for (const id of ids) {
            const rec = myInterviews.find(r => r.id === id);
            if (rec) {
                if (token && rec.videoUrl && rec.videoUrl.startsWith('drive://')) {
                    const fileId = rec.videoUrl.replace('drive://', '').split('&')[0];
                    try { await deleteDriveFile(token, fileId); } catch(e) {}
                }
                await deleteInterview(id);
            }
        }
        setMyInterviews(prev => prev.filter(r => !selectedIds.has(r.id)));
        setSelectedIds(new Set());
    } catch (e: any) { alert("Bulk delete failed: " + e.message); } finally { setIsBulkDeleting(false); }
  };

  const handleSendTextMessage = (text: string) => {
    if (!text.trim() || !liveServiceRef.current) return;
    setTranscript(prev => [...prev, { role: 'user', text, timestamp: Date.now() }]);
    setIsAiThinking(true);
    const currentFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
    const activeFile = currentFiles.find(f => f.path === activeFilePath) || currentFiles[0];
    const grounding = activeFile ? `\n\n[NEURAL_TRUTH] Current Workspace State (${activeFile.name}):\n\`\`\`${activeFile.language}\n${activeFile.content}\n\`\`\`` : "";
    liveServiceRef.current.sendText(text + grounding);
  };

  const handleEditorFileChange = (file: CodeFile) => {
    activeCodeFilesMapRef.current.set(file.path, file);
    setActiveFilePath(file.path);
  };

  const handleSyncWithAi = (file: CodeFile) => {
    if (!liveServiceRef.current) return;
    const msg = `[NEURAL_TRUTH] Manual Workspace Sync Requested for: ${file.name}\n\`\`\`${file.language}\n${file.content}\n\`\`\``;
    liveServiceRef.current.sendText(msg);
    logApi(`Workspace sync dispatched for ${file.name}.`, "info");
  };

  const performNeuralFlush = async () => {
    if (!currentSessionId || isEndingRef.current) return;
    
    const currentFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
    const latestTranscript = transcriptRef.current;
    
    logApi("Performing Neural Checkpoint Flush...", "info");
    
    try {
        const recording: MockInterviewRecording = { 
            id: currentSessionId, 
            userId: currentUser?.uid || 'guest', 
            userName: currentUser?.displayName || 'Guest', 
            userPhoto: currentUser?.photoURL, 
            mode, 
            language, 
            jobDescription: jobDesc, 
            interviewerInfo, 
            intervieweeInfo, 
            timestamp: Date.now(), 
            videoUrl: '', 
            transcript: latestTranscript, 
            feedback: JSON.stringify({ summary: "SESSION RECOVERED: Brain synthesis was interrupted, but transcript was saved via checkpoint." }), 
            visibility: 'private' 
        };

        if (currentUser) {
            await saveInterviewRecording(recording);
            await saveCodeProject({ 
                id: currentSessionId, 
                name: `Checkpoint_${mode}_${new Date().toLocaleDateString()}`, 
                files: currentFiles, 
                lastModified: Date.now(), 
                accessLevel: 'restricted', 
                allowedUserIds: [currentUser.uid] 
            });
        }

        const existingBackupsRaw = localStorage.getItem('mock_interview_backups') || '[]';
        let existingBackups = JSON.parse(existingBackupsRaw) as MockInterviewRecording[];
        existingBackups = existingBackups.filter(b => b.id !== currentSessionId);
        localStorage.setItem('mock_interview_backups', JSON.stringify([...existingBackups, recording]));
        
        logApi("Neural Checkpoint Flush successful.", "info");
    } catch (e) {
        logApi("Flush skipped: Offline or Restricted.", "warn");
    }
  };

  const handleEndInterview = async () => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;
    setIsStarting(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (checkpointTimerRef.current) clearInterval(checkpointTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
    if (liveServiceRef.current) { liveServiceRef.current.disconnect(); setIsAiConnected(false); }
    
    setIsGeneratingReport(true);
    setSynthesisStep('Analyzing Neural Transcript...');
    setSynthesisPercent(10);
    
    try {
        const interviewId = currentSessionId;
        const currentFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
        const latestTranscript = transcriptRef.current;
        
        setSynthesisStep('Persisting Final Workspace...');
        setSynthesisPercent(30);
        await saveCodeProject({ id: interviewId, name: `Interview_${mode}_${new Date().toLocaleDateString()}`, files: currentFiles, lastModified: Date.now(), accessLevel: 'restricted', allowedUserIds: currentUser ? [currentUser.uid] : [] });

        const historyText = latestTranscript.map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n');
        const codeText = currentFiles.map(f => `FILE: ${f.name}\nCONTENT:\n${f.content}`).join('\n\n');

        setSynthesisStep('Synthesizing Feedback...');
        setSynthesisPercent(60);
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Analyze this technical interview evaluation. Mode: ${mode}. History: ${historyText}. Workspace: ${codeText}. CRITICAL: Use a strict 0-100 integer scale. Return JSON: { "score": integer, "technicalSkills": "string", "communication": "string", "collaboration": "string", "strengths": ["string"], "areasForImprovement": ["string"], "verdict": "string", "summary": "string", "learningMaterial": "Markdown" }`;

        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt, config: { responseMimeType: 'application/json' } });
        const reportData = JSON.parse(response.text || '{}') as MockInterviewReport;
        setReport(reportData);
        
        setSynthesisStep('Archiving Video to Drive...');
        setSynthesisPercent(85);
        const videoBlob = new Blob(videoChunksRef.current, { type: 'video/webm' });
        const recording: MockInterviewRecording = { id: interviewId, userId: currentUser?.uid || 'guest', userName: currentUser?.displayName || 'Guest', userPhoto: currentUser?.photoURL, mode, language, jobDescription: jobDesc, interviewerInfo, intervieweeInfo, timestamp: Date.now(), videoUrl: '', transcript: latestTranscript, feedback: JSON.stringify(reportData), visibility };

        if (currentUser) {
            const token = getDriveToken();
            if (token) {
                const folderId = await ensureFolder(token, 'CodeStudio');
                const driveFileId = await uploadToDrive(token, await ensureFolder(token, 'Interviews', folderId), `Interview_${interviewId}.webm`, videoBlob);
                recording.videoUrl = `drive://${driveFileId}`;
            }
            await saveInterviewRecording(recording);
        }
        const existingBackupsRaw = localStorage.getItem('mock_interview_backups') || '[]';
        let existingBackups = JSON.parse(existingBackupsRaw) as MockInterviewRecording[];
        existingBackups = existingBackups.filter(b => b.id !== interviewId);
        localStorage.setItem('mock_interview_backups', JSON.stringify([...existingBackups, recording]));

        setSynthesisPercent(100);
        setSynthesisStep('Refraction Complete');
        setTimeout(() => { setIsGeneratingReport(false); setView('report'); }, 800);
    } catch (e) { 
        console.error("Report synthesis failed", e);
        setIsGeneratingReport(false); 
        setView('hub'); 
    }
  };

  const handleForceYouTubeSync = async (rec: any) => {
    if (!currentUser) return;
    
    setShowSyncLog(true);
    setSyncLogs([]);
    addSyncLog(`FORCING YouTube Transfer: ${rec.userName}`, 'info');

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

    const isDriveUrl = (url: string) => url?.startsWith('drive://') || url?.includes('drive.google.com');

    setSyncingId(rec.id);
    try {
        let videoBlob: Blob;
        const isFromDrive = isDriveUrl(rec.videoUrl);
        const originalDriveUrl = isFromDrive ? rec.videoUrl : rec.driveUrl;
        
        if (rec.blob instanceof Blob) {
            addSyncLog("Loading local buffer (Source: Local)...", 'info');
            videoBlob = rec.blob;
        } else if (isFromDrive) {
            addSyncLog("Downloading source from Google Drive...", 'info');
            const fileId = rec.videoUrl.replace('drive://', '').split('&')[0];
            videoBlob = await downloadDriveFileAsBlob(token!, fileId);
            addSyncLog("Drive download successful.", 'success');
        } else {
            throw new Error("Recording source not found locally or on Drive.");
        }

        addSyncLog("Step 1: Initiating YouTube Handshake...", 'info');
        let videoUrl = "";
        try {
            const ytId = await uploadToYouTube(token!, videoBlob, {
                title: `${rec.userName} - ${rec.mode} Interview (Neural Archive)`,
                description: `Transferred via AIVoiceCast.\nOriginal Source: ${rec.videoUrl}`,
                privacyStatus: 'unlisted'
            });
            videoUrl = getYouTubeVideoUrl(ytId);
            addSyncLog(`YouTube Upload Success: ${ytId}`, 'success');
        } catch (ytErr: any) { 
            // FIXED: Explicitly handle ytErr as any to avoid 'unknown' type errors (Fix Error 1)
            const msg = (ytErr as any)?.message || String(ytErr);
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

        addSyncLog("Step 2: Updating neural ledger references...", 'info');
        await updateInterviewMetadata(rec.id, { videoUrl });
        addSyncLog("Neural ledger updated to new URI.", 'success');
        
        setTimeout(() => {
            loadInterviewsInternal();
            setSyncingId(null);
        }, 800);
        
    } catch (e: any) {
        addSyncLog(`CRITICAL SYNC ERROR: ${e.message}`, 'error');
        setSyncingId(null);
    }
  };

  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleStartInterview = async () => {
    if (!driveToken) return alert("Please connect to Google Drive first.");
    setIsStarting(true); isEndingRef.current = false;
    const uuid = generateSecureId();
    const prefix = generateSecureId().substring(0, 5).toLowerCase();
    setCurrentSessionId(uuid);
    setSessionPrefix(prefix);

    let camStream: MediaStream | null = null;
    let screenStream: MediaStream | null = null;
    try { screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); } catch(e) {}
    try { camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); } catch(e) { alert("Camera/Mic mandatory."); setIsStarting(false); return; }

    const audioCtx = getGlobalAudioContext();
    await warmUpAudioContext(audioCtx);
    setTranscript([]); setReport(null); setApiLogs([]); videoChunksRef.current = []; activeCodeFilesMapRef.current.clear();
    setTimeLeft(durationMinutes * 60);

    try {
      const recordingDest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaStreamSource(camStream).connect(recordingDest);
      activeStreamRef.current = camStream; activeScreenStreamRef.current = screenStream;

      const ext = language.toLowerCase() === 'python' ? 'py' : (language.toLowerCase().includes('java') ? 'java' : 'cpp');
      const initialFilename = `${prefix}_problem1.${ext}`;
      const filesToInit: CodeFile[] = [{ name: initialFilename, path: `drive://${uuid}/${initialFilename}`, language: language.toLowerCase() as any, content: `/* \n * Interview: ${mode}\n * Waiting for interviewer to provide problem 1...\n */\n\n`, loaded: true, isDirectory: false, isModified: false }];
      filesToInit.forEach(f => activeCodeFilesMapRef.current.set(f.path, f));
      setInitialStudioFiles(filesToInit);
      setActiveFilePath(filesToInit[0].path);
      await saveCodeProject({ id: uuid, name: `Interview_${mode}_${new Date().toLocaleDateString()}`, files: filesToInit, lastModified: Date.now(), accessLevel: 'restricted', allowedUserIds: currentUser ? [currentUser.uid] : [] });

      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const drawCtx = canvas.getContext('2d', { alpha: false })!;
      const camVideo = document.createElement('video'); camVideo.srcObject = camStream; camVideo.muted = true; camVideo.play();
      const screenVideo = document.createElement('video'); if (screenStream) { screenVideo.srcObject = screenStream; screenVideo.muted = true; screenVideo.play(); }

      const drawFrame = () => {
        if (isEndingRef.current) return;
        drawCtx.fillStyle = '#020617'; drawCtx.fillRect(0, 0, canvas.width, canvas.height);
        if (screenStream && screenVideo.readyState >= 2) {
            const scale = Math.min(canvas.width / screenVideo.videoWidth, canvas.height / screenVideo.videoHeight);
            const w = screenVideo.videoWidth * scale; const h = screenVideo.videoHeight * scale;
            drawCtx.drawImage(screenVideo, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        }
        if (camVideo.readyState >= 2) {
          const pipW = 320; const realH = (pipW * camVideo.videoHeight) / camVideo.videoWidth;
          drawCtx.strokeStyle = '#6366f1'; drawCtx.lineWidth = 4;
          drawCtx.strokeRect(canvas.width - pipW - 24, canvas.height - realH - 24, pipW, realH);
          drawCtx.drawImage(camVideo, canvas.width - pipW - 24, canvas.height - realH - 24, pipW, realH);
        }
        requestAnimationFrame(drawFrame);
      };
      drawFrame();

      const combinedStream = canvas.captureStream(30);
      recordingDest.stream.getAudioTracks().forEach(t => combinedStream.addTrack(t));
      const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 2500000 });
      recorder.ondataavailable = e => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
      mediaRecorderRef.current = recorder; recorder.start(1000);
      setIsRecording(true);

      const service = new GeminiLiveService();
      activeServiceIdRef.current = service.id; liveServiceRef.current = service;
      
      const sysPrompt = `Role: Senior Interviewer. Mode: ${mode}. Duration: ${durationMinutes}m. Candidate: ${currentUser?.displayName}. RESUME_TEXT: "${resumeText}". TARGET_JOB_DESC: "${jobDesc}". INTERVIEWEE_BIO_CONTEXT: "${intervieweeInfo}". INTERVIEWER_PERSONA_CONTEXT: "${interviewerInfo}". STRICT ANTI-SPOILING RULE: DO NOT AUTO-GENERATE SOLUTIONS. Present problem first. NEURAL TRUTH RULE: Trust blocks marked [NEURAL_TRUTH].`;
      
      await service.connect(mode === 'behavioral' ? 'Zephyr' : 'Software Interview Voice', sysPrompt, {
        onOpen: () => {
          setIsAiConnected(true);
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => { setTimeLeft(prev => { if (prev <= 1) { handleEndInterview(); return 0; } return prev - 1; }); }, 1000);
          if (checkpointTimerRef.current) clearInterval(checkpointTimerRef.current);
          checkpointTimerRef.current = setInterval(() => { 
              if (isAiConnected && !isEndingRef.current) { 
                  setIsCheckpointing(true); 
                  performNeuralFlush();
                  handleReconnectAi(true); 
              } 
          }, 15 * 60 * 1000);
        },
        onClose: () => { if (activeServiceIdRef.current === service.id) { setIsAiConnected(false); handleReconnectAi(true); } },
        onError: () => { if (activeServiceIdRef.current === service.id) handleReconnectAi(true); },
        onVolumeUpdate: () => {},
        onTranscript: (text, isUser) => {
          if (activeServiceIdRef.current !== service.id) return;
          if (!isUser) setIsAiThinking(false);
          const role = isUser ? 'user' : 'ai';
          setTranscript((prev: TranscriptItem[]) => {
            if (prev.length > 0 && prev[prev.length - 1].role === role) return [...prev.slice(0, -1), { ...prev[prev.length - 1], text: prev[prev.length - 1].text + text }];
            return [...prev, { role, text: text as string, timestamp: Date.now() }];
          });
        },
        onToolCall: async (toolCall: any) => {
          for (const fc of toolCall.functionCalls) {
            if (fc.name === 'get_current_code') {
              const { filename } = fc.args as any;
              const allFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
              let targetFile = filename ? allFiles.find(f => f.name === filename) : (allFiles.find(f => f.path === activeFilePath) || allFiles[0]);
              service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: targetFile?.content || "// No code." } }]);
            } else if (fc.name === 'update_active_file') {
              const { new_content } = fc.args as any;
              const allFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
              const targetFile = allFiles.find(f => f.path === activeFilePath) || allFiles[0];
              if (targetFile) {
                const updated = { ...targetFile, content: new_content };
                activeCodeFilesMapRef.current.set(updated.path, updated);
                setInitialStudioFiles(prev => prev.map(f => f.path === updated.path ? updated : f));
                service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Success: Updated ${targetFile.name}.` } }]);
              } else service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: "Error: No target." } }]);
            } else if (fc.name === 'create_interview_file') {
              const { filename, content } = fc.args as any;
              let finalFilename = filename;
              if (prefix) { const base = filename.split('/').pop(); if (!base.startsWith(prefix)) finalFilename = `${prefix}_${base}`; }
              const path = `drive://${uuid}/${finalFilename}`;
              const newFile: CodeFile = { name: finalFilename, path, language: getLanguageFromExt(finalFilename) as any, content, loaded: true, isDirectory: false, isModified: false };
              activeCodeFilesMapRef.current.set(path, newFile);
              setInitialStudioFiles(prev => [...prev.filter(f => f.path !== path), newFile]);
              service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Success: '${finalFilename}' created.` } }]);
            }
          }
        }
      }, [{ functionDeclarations: [getCodeTool, updateActiveFileTool, createInterviewFileTool] }]);
      setView('interview');
    } catch (e: any) { alert("Startup failed."); setView('hub'); } finally { setIsStarting(false); }
  };

  const handleReconnectAi = async (isAuto = false) => {
    if (isEndingRef.current) return;
    setIsAiConnected(false);
    if (liveServiceRef.current) liveServiceRef.current.disconnect();
    const backoffTime = isAuto ? Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000) : 0;
    setTimeout(async () => {
      if (isEndingRef.current) return;
      const activeTranscriptList = transcriptRef.current;
      const historyText = activeTranscriptList.map(t => `${String(t.role).toUpperCase()}: ${t.text}`).join('\n');
      const currentFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
      const workspaceManifest = currentFiles.map(f => `FILE: ${f.name}\nCONTENT:\n${f.content}`).join('\n\n---\n\n');
      const prompt = `RESUMING INTERVIEW SESSION. Workspace: ${workspaceManifest}. History: ${historyText}. Pick up exactly where left off.`;
      const service = new GeminiLiveService();
      activeServiceIdRef.current = service.id; liveServiceRef.current = service;
      try {
        await service.connect(mode === 'behavioral' ? 'Zephyr' : 'Software Interview Voice', prompt, {
          onOpen: () => { if (activeServiceIdRef.current === service.id) { setIsAiConnected(true); setIsCheckpointing(false); reconnectAttemptsRef.current = 0; } },
          onClose: () => { if (activeServiceIdRef.current === service.id) { setIsAiConnected(false); if (!isEndingRef.current && isAuto && reconnectAttemptsRef.current < 5) { reconnectAttemptsRef.current++; handleReconnectAi(true); } } },
          onError: () => { if (activeServiceIdRef.current === service.id) handleReconnectAi(true); },
          onVolumeUpdate: () => {},
          onTranscript: (text, isUser) => {
            if (activeServiceIdRef.current !== service.id) return;
            if (!isUser) setIsAiThinking(false);
            const role = isUser ? 'user' : 'ai';
            setTranscript((prev: TranscriptItem[]) => {
              if (prev.length > 0 && prev[prev.length - 1].role === role) return [...prev.slice(0, -1), { ...prev[prev.length - 1], text: prev[prev.length - 1].text + text }];
              return [...prev, { role, text: text as string, timestamp: Date.now() }];
            });
          },
          onToolCall: async (toolCall: any) => {
              for (const fc of toolCall.functionCalls) {
                  if (fc.name === 'get_current_code') {
                      const allFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
                      let targetFile = allFiles.find(f => f.path === activeFilePath) || allFiles[0];
                      service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: targetFile?.content || "// File empty." } }]);
                  } else if (fc.name === 'update_active_file') {
                      const allFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
                      const targetFile = allFiles.find(f => f.path === activeFilePath) || allFiles[0];
                      if (targetFile) {
                        const updated = { ...targetFile, content: fc.args.new_content };
                        activeCodeFilesMapRef.current.set(updated.path, updated);
                        setInitialStudioFiles(prev => prev.map(f => f.path === updated.path ? updated : f));
                        service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: "Updated." } }]);
                      }
                  } else if (fc.name === 'create_interview_file') {
                      const path = `drive://${currentSessionId}/${fc.args.filename}`;
                      const newFile: CodeFile = { name: fc.args.filename, path, language: getLanguageFromExt(fc.args.filename) as any, content: fc.args.content, loaded: true, isDirectory: false, isModified: false };
                      activeCodeFilesMapRef.current.set(path, newFile);
                      setInitialStudioFiles(prev => [...prev.filter(f => f.path !== path), newFile]);
                      service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: "Created." } }]);
                  }
              }
          }
        }, [{ functionDeclarations: [getCodeTool, updateActiveFileTool, createInterviewFileTool] }]);
      } catch (err: any) { logApi(`Init Failure: ${err.message}`, "error"); }
    }, backoffTime);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const loadInterviewsInternal = async () => {
    setLoading(true);
    try {
      const [publicData, userData] = await Promise.all([
        getPublicInterviews(),
        currentUser ? getUserInterviews(currentUser.uid) : Promise.resolve([])
      ]);
      const localBackupsRaw = localStorage.getItem('mock_interview_backups') || '[]';
      const localBackups = (JSON.parse(localBackupsRaw) as MockInterviewRecording[]).filter(b => b && b.id);
      const myFilteredBackups = localBackups.filter(b => b.userId === (currentUser?.uid || 'guest'));
      const myMap = new Map<string, MockInterviewRecording>();
      userData.forEach(rec => myMap.set(rec.id, rec));
      myFilteredBackups.forEach(backup => { if (!myMap.has(backup.id)) myMap.set(backup.id, backup); });
      const combined = Array.from(myMap.values());
      setMyInterviews(combined.sort((a, b) => b.timestamp - a.timestamp));
      setPublicInterviews(publicData.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) { console.error("Ledger retrieval error", e); } finally { setLoading(false); }
  };

  useEffect(() => { loadInterviewsInternal(); }, [currentUser]);

  // ADDED: Missing renderInterviewsList function (Fix Error 2)
  const renderInterviewsList = (list: MockInterviewRecording[], isMyHistory: boolean) => {
    if (list.length === 0) {
        return (
            <div className="py-20 text-center text-slate-500 bg-slate-900/30 rounded-[3rem] border-2 border-dashed border-slate-800">
                <PlayCircle size={64} className="mx-auto mb-6 opacity-5" />
                <p className="text-lg font-bold text-slate-400">No evaluations found.</p>
                <p className="text-sm mt-2 opacity-60">Complete an interview session to see it here.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {list.map((rec) => (
                <div 
                    key={rec.id} 
                    onClick={() => { setActiveRecording(rec); setView('artifact_viewer'); }}
                    className="bg-slate-900 border border-slate-800 rounded-3xl p-6 hover:border-indigo-500/50 transition-all cursor-pointer group relative shadow-xl overflow-hidden"
                >
                    <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                            onClick={(e) => handleToggleSelect(rec.id, e)}
                            className={`p-2 rounded-xl border transition-all ${selectedIds.has(rec.id) ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                        >
                            {selectedIds.has(rec.id) ? <CheckSquare size={16}/> : <Square size={16}/>}
                        </button>
                    </div>
                    
                    <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-950 flex items-center justify-center text-indigo-400 border border-indigo-500/20 group-hover:scale-110 transition-transform">
                            <GraduationCap size={24} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="font-bold text-white text-lg truncate italic uppercase tracking-tighter">{rec.mode.replace('_', ' ')}</h3>
                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">{new Date(rec.timestamp).toLocaleDateString()}</p>
                        </div>
                    </div>

                    <div className="space-y-3 mb-6">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <User size={14} className="text-slate-600"/>
                            <span className="truncate">@{rec.userName}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <Languages size={14} className="text-slate-600"/>
                            <span>{rec.language || 'English'}</span>
                        </div>
                    </div>

                    <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${rec.visibility === 'public' ? 'bg-emerald-900/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                            {rec.visibility || 'private'}
                        </span>
                        <div className="flex items-center gap-1 text-indigo-400 text-xs font-bold group-hover:translate-x-1 transition-transform">
                            View Report <ChevronRight size={14}/>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden relative">
      <header className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 backdrop-blur-md shrink-0 z-40">
        <div className="flex items-center gap-4">
          <button onClick={() => view === 'hub' ? onBack() : view === 'artifact_viewer' ? setView('hub') : setView('hub')} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><ArrowLeft size={20} /></button>
          <div><h1 className="text-lg font-bold text-white flex items-center gap-2"><Video className="text-red-500" size={20} /> {view === 'artifact_viewer' ? 'Artifact Viewer' : 'Mock Interview'}</h1>{(view === 'interview' || view === 'coaching' || view === 'artifact_viewer') && (<div className="flex items-center gap-1.5 text-[9px] font-black text-indigo-400 uppercase tracking-widest mt-0.5"><Fingerprint size={10}/> Session: {(activeRecording?.id || currentSessionId).substring(0, 8)}</div>)}</div>
        </div>
        <div className="flex items-center gap-3">
            {view === 'interview' && (<div className={`px-4 py-1.5 rounded-2xl border bg-slate-950/50 flex items-center gap-2 ${timeLeft < 300 ? 'border-red-500/50 text-red-400 animate-pulse' : 'border-indigo-500/30 text-indigo-400'}`}><Timer size={14}/><span className="font-mono text-base font-black tabular-nums">{formatTime(timeLeft)}</span></div>)}
            {(view === 'report' || view === 'coaching' || view === 'artifact_viewer') && (<button onClick={() => { setView('hub'); loadInterviewsInternal(); }} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black uppercase tracking-widest border border-slate-700"><History size={14}/><span>History</span></button>)}
            {view === 'interview' && (<button onClick={handleEndInterview} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg active:scale-95">End Session</button>)}
        </div>
      </header>
      <main className="flex-1 overflow-hidden relative">
        {isCheckpointing && (<div className="absolute inset-0 z-[110] bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center gap-6 animate-fade-in"><div className="p-8 bg-slate-900 border border-indigo-500/30 rounded-[3rem] flex flex-col items-center shadow-2xl"><div className="w-20 h-20 bg-indigo-600/10 rounded-3xl flex items-center justify-center mb-6 border border-indigo-500/20"><Database size={40} className="text-indigo-400 animate-pulse"/></div><h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">Neural Checkpoint</h3><p className="text-xs text-slate-500 uppercase font-black text-center max-w-xs">Rotating AI connection & Archiving Progress...</p></div></div>)}
        {view === 'hub' && (
          <div className="max-w-6xl mx-auto p-8 space-y-12 animate-fade-in overflow-y-auto h-full scrollbar-hide">
            <div className="bg-indigo-600 rounded-[3rem] p-12 shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center gap-10"><div className="relative z-10 flex-1 space-y-6"><h2 className="text-5xl font-black text-white italic tracking-tighter uppercase leading-none">Validate your<br/>Potential.</h2><button onClick={() => setView('prep')} className="px-10 py-5 bg-white text-indigo-600 font-black uppercase tracking-widest rounded-2xl shadow-2xl hover:scale-105 transition-all flex items-center gap-3"><Zap size={20} fill="currentColor"/> Begin Preparation</button></div><div className="relative z-10 hidden lg:block"><Bot size={100} className="text-indigo-400 animate-pulse"/></div></div>
            <div className="space-y-8">
                <div className="flex justify-between items-center">
                    <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800 w-fit shadow-lg">
                        <button onClick={() => setHubTab('history')} className={`px-6 py-2 rounded-xl text-xs font-black uppercase transition-all ${hubTab === 'history' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500'}`}>History</button>
                        <button onClick={() => setHubTab('explore')} className={`px-6 py-2 rounded-xl text-xs font-black uppercase transition-all ${hubTab === 'explore' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500'}`}>Discovery</button>
                    </div>
                    {selectedIds.size > 0 && (
                        <button onClick={handleDeleteSelected} disabled={isBulkDeleting} className="flex items-center gap-2 px-4 py-2 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all">{isBulkDeleting ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>} Purge {selectedIds.size}</button>
                    )}
                </div>
                {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-indigo-400" size={32}/></div> : renderInterviewsList(hubTab === 'history' ? myInterviews : publicInterviews, hubTab === 'history')}
            </div>
          </div>
        )}
        {view === 'prep' && (
          <div className="max-w-6xl mx-auto p-8 animate-fade-in-up h-full overflow-y-auto scrollbar-hide">
            <div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl space-y-10">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <div className="space-y-8">
                    <div className={`p-6 rounded-3xl border flex items-center justify-between transition-all ${driveToken ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-red-900/10 border-red-500/30 animate-pulse'}`}>
                        <div className="flex items-center gap-3"><HardDrive className={driveToken ? 'text-emerald-400' : 'text-red-400'} size={24}/><div><p className="text-xs font-bold text-white uppercase tracking-widest">Neural Cloud Link</p><p className="text-[10px] text-slate-500 uppercase font-black">{driveToken ? 'Authorized' : 'Action Required'}</p></div></div>
                        {!driveToken && <button onClick={handleConnectDrive} className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase shadow-lg">Authorize Drive</button>}
                    </div>
                    <div className="bg-slate-950 p-6 rounded-[2rem] border border-slate-800 space-y-6 shadow-inner">
                        <div className="flex items-center justify-between px-1"><h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2"><UserCircle size={16}/> Candidate Context</h3><button onClick={handleSyncFromProfile} className="text-[10px] font-black text-indigo-400 hover:text-white transition-all flex items-center gap-1 uppercase tracking-widest"><RefreshCw size={10}/> Sync Profile</button></div>
                        <div className="space-y-4">
                            <div><label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2 px-1">Interviewee Profile (Bio/LinkedIn)</label><textarea value={intervieweeInfo} onChange={e => setIntervieweeInfo(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-indigo-200 outline-none focus:border-indigo-500 resize-none h-24" placeholder="Professional summary..."/></div>
                            <div><label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block mb-2 px-1">Target Interviewer Persona</label><textarea value={interviewerInfo} onChange={e => setInterviewerInfo(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white outline-none focus:border-indigo-500 resize-none h-24" placeholder="Principal Engineer from Netflix..."/></div>
                        </div>
                    </div>
                </div>
                <div className="space-y-8">
                    <div className="bg-slate-950 p-6 rounded-[2rem] border border-slate-800 space-y-6 shadow-inner">
                        <div className="flex items-center justify-between px-1"><h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2"><FileSearch size={16}/> Target Specification</h3></div>
                        <textarea value={jobDesc} onChange={e => setJobDesc(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs text-emerald-100 outline-none focus:border-emerald-500 resize-none h-48" placeholder="Paste job description..."/>
                    </div>
                    <div className="bg-slate-950 p-6 rounded-[2rem] border border-slate-800 space-y-6 shadow-inner">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Timer size={16}/> Session Chronometry</h3>
                        <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800">
                            {[15, 25, 30, 45, 60].map(m => (
                                <button key={m} onClick={() => setDurationMinutes(m)} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${durationMinutes === m ? 'bg-indigo-600 text-white shadow-xl' : 'text-slate-500 hover:text-slate-300'}`}>{m}m</button>
                            ))}
                        </div>
                    </div>
                </div>
              </div>
              <div className="pt-8">
                <button onClick={handleStartInterview} disabled={isStarting || !driveToken} className="w-full py-6 bg-gradient-to-r from-red-600 to-indigo-600 text-white font-black uppercase tracking-[0.3em] rounded-3xl shadow-2xl transition-all hover:scale-[1.01] active:scale-95 disabled:opacity-30">
                    {isStarting ? <Loader2 className="animate-spin mx-auto" /> : `Launch ${durationMinutes}min Evaluation Protocol`}
                </button>
              </div>
            </div>
          </div>
        )}
        {view === 'interview' && (
          <div className="h-full flex flex-col overflow-hidden relative">
            <div className="flex-1 bg-slate-950 relative flex flex-col md:flex-row overflow-hidden">
                <div className="flex-1 overflow-hidden relative flex flex-col bg-slate-950">
                    <CodeStudio onBack={() => {}} currentUser={currentUser} userProfile={userProfile} onSessionStart={() => {}} onSessionStop={() => {}} onStartLiveSession={onStartLiveSession as any} initialFiles={initialStudioFiles} externalChatContent={transcript.map(t => ({ role: t.role, text: t.text }))} onSendExternalMessage={handleSendTextMessage} isInterviewerMode={true} isAiThinking={isAiThinking} onFileChange={handleEditorFileChange} onSyncCodeWithAi={handleSyncWithAi}/>
                </div>
            </div>
            <div className={`absolute bottom-20 right-4 w-64 aspect-video rounded-3xl overflow-hidden border-4 ${isAiConnected ? 'border-indigo-500/50' : 'border-red-500/50 animate-pulse'} shadow-2xl z-[100] bg-black group transition-all`}>
                <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover"/>
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3"><button onClick={() => setShowCodePasteOverlay(true)} className="p-1.5 bg-indigo-600 rounded-lg text-white"><Code size={14}/></button></div>
            </div>
          </div>
        )}
        {view === 'report' && (
          <div className="max-w-4xl mx-auto p-8 animate-fade-in-up space-y-12 pb-32 overflow-y-auto h-full scrollbar-hide">
            <div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 flex flex-col items-center text-center space-y-6 shadow-2xl">
              <Trophy className="text-amber-500" size={64}/><h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">Evaluation Finished</h2>
              {report ? (
                <div className="flex flex-col items-center gap-6 w-full">
                    <div className="flex flex-wrap justify-center gap-4"><div className="px-8 py-4 bg-slate-950 rounded-2xl border border-slate-800"><p className="text-[10px] text-slate-500 uppercase">Score</p><p className="text-4xl font-black text-indigo-400">{report.score}</p></div><div className="px-8 py-4 bg-slate-950 rounded-2xl border border-slate-800"><p className="text-[10px] text-slate-500 uppercase">Verdict</p><p className={`text-xl font-black ${report.verdict.includes('Hire') ? 'text-emerald-400' : 'text-red-400'}`}>{report.verdict}</p></div></div>
                    <div className="w-full text-left w-full bg-slate-950 p-8 rounded-[2rem] border border-slate-800"><h3 className="font-bold text-white mb-4"><Sparkles className="text-indigo-400" size={18}/> Summary</h3><p className="text-sm text-slate-400 leading-relaxed">{report.summary}</p></div>
                    <div className="text-left w-full bg-slate-950 p-8 rounded-[2rem] border border-slate-800"><h3 className="font-bold text-white mb-4"><BookOpen className="text-indigo-400" size={18}/> Growth Path</h3><div className="prose prose-invert prose-sm max-w-none"><MarkdownView content={report.learningMaterial} /></div></div>
                </div>
              ) : <Loader2 size={32} className="animate-spin text-indigo-400" />}
            </div>
          </div>
        )}
        {/* ADDED: Missing Artifact Viewer block */}
        {view === 'artifact_viewer' && activeRecording && (
          <div className="h-full flex flex-col bg-slate-950 animate-fade-in overflow-hidden">
             <div className="flex-1 overflow-y-auto p-8 space-y-12 scrollbar-hide pb-32">
                <div className="max-w-4xl mx-auto space-y-8">
                    <div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-12 bg-indigo-500/10 blur-[100px] rounded-full"></div>
                        <div className="relative z-10 space-y-4">
                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em]">Historical Artifact</span>
                            <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">{activeRecording.mode.replace('_', ' ')} Evaluation</h2>
                            <div className="flex items-center gap-6 text-sm text-slate-500">
                                <span className="flex items-center gap-2"><User size={16}/> @{activeRecording.userName}</span>
                                <span className="flex items-center gap-2"><Calendar size={16}/> {new Date(activeRecording.timestamp).toLocaleDateString()}</span>
                                <span className="flex items-center gap-2"><Globe size={16}/> {activeRecording.visibility || 'private'}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-xl">
                            <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2"><FileSearch size={20} className="text-emerald-400"/> Context Refraction</h3>
                            <div className="space-y-6">
                                <div><p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Target Role</p><p className="text-sm text-slate-300 leading-relaxed italic line-clamp-4">{activeRecording.jobDescription || 'N/A'}</p></div>
                                <div><p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Interviewer Profile</p><p className="text-sm text-slate-300 leading-relaxed italic">{activeRecording.interviewerInfo || 'N/A'}</p></div>
                            </div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-xl">
                            <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2"><Video size={20} className="text-red-400"/> Neural Playback</h3>
                            {activeRecording.videoUrl ? (
                                <div className="space-y-4">
                                    <p className="text-xs text-slate-500">Evaluation session archived. Primary URI: <code className="text-[10px] text-indigo-400 bg-black/20 p-1 rounded">{activeRecording.videoUrl}</code></p>
                                    <button 
                                        onClick={async () => {
                                            const token = getDriveToken();
                                            if (token && activeRecording.videoUrl.startsWith('drive://')) {
                                                const fileId = activeRecording.videoUrl.replace('drive://', '').split('&')[0];
                                                const blob = await downloadDriveFileAsBlob(token, fileId);
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a'); a.href = url; a.download = `Interview_${activeRecording.id}.webm`; a.click();
                                            } else {
                                                alert("Drive link unavailable or unauthorized. Connect Google Drive in Prep tab.");
                                            }
                                        }}
                                        className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 transition-all"
                                    >
                                        <Download size={20}/> Download Assessment Clip
                                    </button>
                                </div>
                            ) : (
                                <div className="p-8 text-center border-2 border-dashed border-slate-800 rounded-3xl text-slate-600 italic text-sm">Video asset not available.</div>
                            )}
                        </div>
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl">
                        <h3 className="text-xl font-bold text-white mb-8 flex items-center gap-2"><History size={24} className="text-indigo-400"/> Session Transcript</h3>
                        <div className="space-y-6">
                            {activeRecording.transcript?.map((item, idx) => (
                                <div key={idx} className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <span className="text-[10px] font-black text-slate-600 uppercase mb-1">{item.role === 'user' ? activeRecording.userName : 'AI INTERVIEWER'}</span>
                                    <div className={`max-w-[90%] p-4 rounded-2xl text-sm leading-relaxed ${item.role === 'user' ? 'bg-indigo-600/10 text-indigo-100 border border-indigo-500/20' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
                                        {item.text}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
             </div>
          </div>
        )}
      </main>
      {isGeneratingReport && (<div className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center gap-8 animate-fade-in"><div className="relative"><div className="w-32 h-32 border-4 border-indigo-500/10 rounded-full"></div><div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"/><Activity className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-400" size={40}/><div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-3xl font-black text-white">{Math.round(synthesisPercent)}%</div></div><h3 className="text-xl font-black text-white uppercase">{synthesisStep}</h3></div>)}
      
      {/* Sync Log Overlay (Mock Interview specifics) */}
      {showSyncLog && (
          <div className="fixed bottom-6 left-6 w-96 z-[100] bg-slate-900 border border-slate-700 rounded-3xl overflow-hidden flex flex-col shadow-2xl animate-fade-in-up max-h-[400px]">
              <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center shrink-0">
                  <div className="flex items-center gap-3">
                      <Activity size={18} className="text-indigo-400"/>
                      <div>
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Evaluation Sync Log</h3>
                      </div>
                  </div>
                  <button onClick={() => setShowSyncLog(false)} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 hover:text-white transition-colors"><X size={18}/></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[10px] bg-slate-950/50">
                  {syncLogs.length === 0 ? (
                      <p className="text-slate-700 italic">Listening for neural events...</p>
                  ) : syncLogs.map((log, i) => (
                      <div key={i} className={`flex gap-2 ${log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-amber-400' : log.type === 'success' ? 'text-emerald-400' : 'text-slate-500'}`}>
                          <span className="opacity-40 shrink-0">[{log.time}]</span>
                          <span className="break-words">{log.msg}</span>
                      </div>
                  ))}
              </div>
          </div>
      )}
    </div>
  );
};

export default MockInterview;
