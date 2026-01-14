import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MockInterviewRecording, TranscriptItem, CodeFile, UserProfile, Channel, CodeProject } from '../types';
import { auth } from '../services/firebaseConfig';
import { saveInterviewRecording, getPublicInterviews, deleteInterview, updateUserProfile, uploadFileToStorage, getUserInterviews, updateInterviewMetadata, saveCodeProject, getCodeProject, getUserProfile } from '../services/firestoreService';
import { GeminiLiveService } from '../services/geminiLive';
import { GoogleGenAI, Type } from '@google/genai';
import { generateSecureId } from '../utils/idUtils';
import { CodeStudio } from './CodeStudio';
import { MarkdownView } from './MarkdownView';
import { ArrowLeft, Video, Mic, Monitor, Play, Save, Loader2, Search, Trash2, CheckCircle, X, Download, ShieldCheck, User, Users, Building, FileText, ChevronRight, Zap, SidebarOpen, SidebarClose, Code, MessageSquare, Sparkles, Languages, Clock, Camera, Bot, CloudUpload, Trophy, BarChart3, ClipboardCheck, Star, Upload, FileUp, Linkedin, FileCheck, Edit3, BookOpen, Lightbulb, Target, ListChecks, MessageCircleCode, GraduationCap, Lock, Globe, ExternalLink, PlayCircle, RefreshCw, FileDown, Briefcase, Package, Code2, StopCircle, Youtube, AlertCircle, Eye, EyeOff, SaveAll, Wifi, WifiOff, Activity, ShieldAlert, Timer, FastForward, ClipboardList, Layers, Bug, Flag, Minus, Fingerprint, FileSearch, RefreshCcw, HeartHandshake, Speech, Send, History, Compass, Square, CheckSquare, Cloud, Award, Terminal, CodeSquare, Quote, Image as ImageIcon, Sparkle, LayoutPanelTop, TerminalSquare, FolderOpen, HardDrive, Shield, Database } from 'lucide-react';
import { getGlobalAudioContext, getGlobalMediaStreamDest, warmUpAudioContext, stopAllPlatformAudio } from '../utils/audioUtils';
import { getDriveToken, signInWithGoogle, connectGoogleDrive } from '../services/authService';
import { ensureFolder, uploadToDrive, downloadDriveFileAsBlob, deleteDriveFile } from '../services/googleDriveService';

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
  
  const reconnectAttemptsRef = useRef(0);
  const activeServiceIdRef = useRef<string | null>(null);
  const isEndingRef = useRef(false);

  const [synthesisStep, setSynthesisStep] = useState<string>('');
  const [synthesisPercent, setSynthesisPercent] = useState(0);

  const [mode, setMode] = useState<'coding' | 'system_design' | 'behavioral' | 'quick_screen' | 'assessment_30' | 'assessment_60'>('coding');
  const [language, setLanguage] = useState(userProfile?.defaultLanguage || 'C++');
  const [jobDesc, setJobDesc] = useState('');
  const [interviewerInfo, setInterviewerInfo] = useState('');
  const [resumeText, setResumeText] = useState(userProfile?.resumeText || '');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
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

  const logCoach = (msg: string, type: 'info' | 'error' | 'warn' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setCoachingLogs(prev => [{time, msg, type}, ...prev].slice(0, 50));
  };

  useEffect(() => {
    if (userProfile?.resumeText && !resumeText) {
      setResumeText(userProfile.resumeText);
    }
  }, [userProfile]);

  const handleConnectDrive = async () => {
    try {
        const token = await connectGoogleDrive();
        setDriveToken(token);
        logApi("Google Drive Authorized Successfully.");
    } catch(e) {
        logApi("Google Drive Auth Failed.", "error");
    }
  };

  const handleSyncResume = () => {
    if (userProfile?.resumeText) {
      setResumeText(userProfile.resumeText);
    } else {
      alert("No resume found in your profile. Go to Settings to upload one.");
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getDurationSeconds = (m: string) => {
    if (m === 'quick_screen') return 15 * 60;
    if (m === 'behavioral') return 30 * 60;
    if (m === 'assessment_30') return 30 * 60;
    if (m === 'assessment_60') return 60 * 60;
    return 45 * 60; 
  };

  useEffect(() => {
    if (view === 'interview' && activeStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = activeStreamRef.current;
    }
  }, [view]);

  useEffect(() => {
    if ((view === 'report' || view === 'artifact_viewer' || view === 'coaching') && (activeRecording?.id || currentSessionId)) {
        const pid = activeRecording?.id || currentSessionId;
        setLoadingProject(true);
        getCodeProject(pid).then(p => {
            if (p && p.files) {
                setSessionProject(p);
                setInitialStudioFiles(p.files);
                activeCodeFilesMapRef.current.clear();
                p.files.forEach(f => activeCodeFilesMapRef.current.set(f.path, f));
            }
            setLoadingProject(false);
        }).catch(() => setLoadingProject(false));
    }
  }, [view, activeRecording?.id, currentSessionId]);

  useEffect(() => {
    loadInterviews();
    return () => { 
        if (timerRef.current) clearInterval(timerRef.current);
        if (checkpointTimerRef.current) clearInterval(checkpointTimerRef.current);
        if (liveServiceRef.current) liveServiceRef.current.disconnect();
    };
  }, [currentUser]);

  useEffect(() => {
    if (view !== 'coaching' || coachingTranscript.length === 0) return;
    const targetId = activeRecording?.id || currentSessionId;
    if (!targetId) return;

    const syncCoachingTranscript = async () => {
        setIsCoachingSyncing(true);
        try {
            await updateInterviewMetadata(targetId, { coachingTranscript: coachingTranscript });
            const localBackupsRaw = localStorage.getItem('mock_interview_backups') || '[]';
            const localBackups = JSON.parse(localBackupsRaw) as MockInterviewRecording[];
            const idx = localBackups.findIndex(b => b.id === targetId);
            if (idx !== -1) {
                localBackups[idx].coachingTranscript = coachingTranscript;
                localStorage.setItem('mock_interview_backups', JSON.stringify(localBackups));
            }
        } catch (e) { console.error("Coaching sync failed", e); } finally { setIsCoachingSyncing(false); }
    };
    const timer = setTimeout(syncCoachingTranscript, 2000);
    return () => clearTimeout(timer);
  }, [coachingTranscript, view, activeRecording?.id, currentSessionId]);

  const loadInterviews = async () => {
    setLoading(true);
    try {
      const [publicData, userData] = await Promise.all([
        getPublicInterviews(),
        currentUser ? getUserInterviews(currentUser.uid) : Promise.resolve([])
      ]);
      const localBackupsRaw = localStorage.getItem('mock_interview_backups') || '[]';
      const localBackups = (JSON.parse(localBackupsRaw) as MockInterviewRecording[]).filter(b => b && b.id && b.id.trim() !== "");
      const myFilteredBackups = localBackups.filter(b => b.userId === (currentUser?.uid || 'guest'));
      const myMap = new Map<string, MockInterviewRecording>();
      userData.forEach(rec => myMap.set(rec.id, rec));
      myFilteredBackups.forEach(backup => { if (!myMap.has(backup.id)) myMap.set(backup.id, backup); });
      const combined = Array.from(myMap.values());
      setMyInterviews(combined.sort((a, b) => b.timestamp - a.timestamp));
      setPublicInterviews(publicData.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) { console.error("Ledger retrieval error", e); } finally { setLoading(false); }
  };

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!id || id.trim() === "") return;
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelectedIds(next);
  };

  const handleSelectAll = () => {
      const list = hubTab === 'history' ? myInterviews : publicInterviews;
      const validIds = list.filter(i => i.id && i.id.trim() !== "").map(i => i.id);
      if (selectedIds.size === validIds.length) setSelectedIds(new Set());
      else setSelectedIds(new Set(validIds));
  };

  const handleDeleteSelected = async () => {
      const idsToPurge = Array.from(selectedIds).filter((id): id is string => typeof id === 'string' && id.trim() !== "");
      if (idsToPurge.length === 0) return;
      if (!confirm(`Permanently delete ${idsToPurge.length} selected technical evaluations?`)) return;
      setIsBulkDeleting(true);
      try {
          for (const id of idsToPurge) await deleteInterview(id);
          const localBackupsRaw = localStorage.getItem('mock_interview_backups') || '[]';
          const localBackups = JSON.parse(localBackupsRaw) as MockInterviewRecording[];
          localStorage.setItem('mock_interview_backups', JSON.stringify(localBackups.filter(b => !selectedIds.has(b.id))));
          await loadInterviews();
          setSelectedIds(new Set());
      } catch (e: any) { alert("Purge failed: " + e.message); } finally { setIsBulkDeleting(false); }
  };

  const handleSendTextMessage = (text: string) => {
    if (liveServiceRef.current && isAiConnected) {
        setIsAiThinking(true);
        const userMsg: TranscriptItem = { role: 'user', text, timestamp: Date.now() };
        if (view === 'coaching') setCoachingTranscript(prev => [...prev, userMsg]);
        else setTranscript(prev => [...prev, userMsg]);
        
        // NEURAL TRUTH: In technical modes, always bundle a code snapshot with the message
        let augmentedText = text;
        if (mode === 'coding' || mode === 'system_design') {
             const activeFile = activeFilePath ? activeCodeFilesMapRef.current.get(activeFilePath) : Array.from(activeCodeFilesMapRef.current.values())[0];
             if (activeFile) {
                 augmentedText = `[CANDIDATE_MSG]: ${text}\n\n[LATEST_EDITOR_CONTENT ("${activeFile.name}")]:\n\`\`\`\n${activeFile.content}\n\`\`\``;
             }
        }
            
        liveServiceRef.current.sendText(augmentedText);
    }
  };

  const handleSyncWithAi = useCallback((file: CodeFile) => {
    if (liveServiceRef.current && isAiConnected) {
        setIsAiThinking(true);
        // NEURAL FORCE SYNC: Send the full code content to ensure context window is updated
        const syncMsg = `[CRITICAL_CONTEXT_UPDATE]: The candidate has performed a manual sync of "${file.name}". 
        BELOW IS THE EXACT CURRENT CONTENT. USE THIS AS THE SOURCE OF TRUTH.
        
        \`\`\`
        ${file.content}
        \`\`\``;
        liveServiceRef.current.sendText(syncMsg);
        logApi(`Neural Force-Sync for ${file.name} pushed to conversation history.`, "info");
    }
  }, [isAiConnected]);

  const handleEditorFileChange = useCallback((file: CodeFile) => {
    activeCodeFilesMapRef.current.set(file.path, file);
    setActiveFilePath(file.path);
    setInitialStudioFiles(prev => {
        const exists = prev.some(f => f.path === file.path);
        if (exists) return prev.map(f => f.path === file.path ? file : f);
        return [...prev, file];
    });
  }, []);

  const handleReconnectAi = async (isAuto = false) => {
    if (isEndingRef.current) return;
    setIsAiConnected(false);
    if (liveServiceRef.current) liveServiceRef.current.disconnect();

    const backoffTime = isAuto ? Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000) : 0;
    setTimeout(async () => {
      if (isEndingRef.current) return;
      const currentView = view;
      const activeTranscriptList = (currentView === 'coaching' ? coachingTranscript : transcript) as TranscriptItem[];
      const historyText = activeTranscriptList.map(t => `${String(t.role).toUpperCase()}: ${t.text}`).join('\n');
      const currentFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
      const workspaceManifest = currentFiles.map(f => `FILE: ${f.name}\nCONTENT:\n${f.content}`).join('\n\n---\n\n');
      
      let prompt = "";
      if (currentView === 'coaching') {
          prompt = `RESUMING COACHING SESSION. Role: Senior Coach. Candidate: ${currentUser?.displayName || 'Candidate'}. WORKSPACE CONTEXT:\n${workspaceManifest}\nTRANSCRIPT HISTORY:\n${historyText}\nGOAL: Restore coaching atmosphere.`;
      } else {
          prompt = `RESUMING INTERVIEW SESSION. Role: Senior Interviewer. Mode: ${mode}. Candidate: ${currentUser?.displayName || 'Candidate'}. 
          ${interviewerInfo ? `STRICT PERSONA LOCK: You are simulating: "${interviewerInfo}".` : ''}
          WORKSPACE STATE:\n${workspaceManifest}\nHISTORY:\n${historyText}\n
          STRICT ANTI-SPOILING RULE: NEVER solve the problem for the candidate. Provide hints only if they are stuck.
          STRICT VISIBILITY RULE: You must ALWAYS verify the candidate's code using the provided history or 'get_current_code' tool before making assumptions.
          STRICT INSTRUCTION: Pick up exactly where the last message ended. Do NOT restart the greeting.`;
      }
      
      const service = new GeminiLiveService();
      activeServiceIdRef.current = service.id;
      liveServiceRef.current = service;

      try {
        await service.connect(currentView === 'coaching' ? 'Zephyr' : 'Software Interview Voice', prompt, {
          onOpen: () => { if (activeServiceIdRef.current === service.id) { setIsAiConnected(true); setIsCheckpointing(false); reconnectAttemptsRef.current = 0; } },
          onClose: () => { if (activeServiceIdRef.current === service.id) { setIsAiConnected(false); if (!isEndingRef.current && isAuto && reconnectAttemptsRef.current < 5) { reconnectAttemptsRef.current++; handleReconnectAi(true); } } },
          onError: () => { if (activeServiceIdRef.current === service.id) handleReconnectAi(true); },
          onVolumeUpdate: () => {},
          onTranscript: (text, isUser) => {
            if (activeServiceIdRef.current !== service.id) return;
            if (!isUser) setIsAiThinking(false);
            const role = isUser ? 'user' : 'ai';
            const setter = currentView === 'coaching' ? setCoachingTranscript : setTranscript;
            setter((prev: TranscriptItem[]) => {
              if (prev.length > 0 && prev[prev.length - 1].role === role) {
                const last = prev[prev.length - 1];
                return [...prev.slice(0, -1), { ...last, text: last.text + text }];
              }
              return [...prev, { role, text: text as string, timestamp: Date.now() }];
            });
          },
          onToolCall: async (toolCall: any) => {
              for (const fc of toolCall.functionCalls) {
                  if (fc.name === 'get_current_code') {
                      const { filename } = fc.args as any;
                      const allFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
                      let targetFile;
                      if (filename) targetFile = allFiles.find(f => f.name === filename);
                      else targetFile = allFiles.find(f => f.path === activeFilePath) || allFiles[0];
                      
                      service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: targetFile?.content || "// File not found or empty." } }]);
                  } else if (fc.name === 'update_active_file') {
                      const { new_content } = fc.args as any;
                      const allFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
                      const targetFile = allFiles.find(f => f.path === activeFilePath) || allFiles[0];
                      if (targetFile) {
                        const updatedFile = { ...targetFile, content: new_content };
                        activeCodeFilesMapRef.current.set(updatedFile.path, updatedFile);
                        setInitialStudioFiles(prev => prev.map(f => f.path === updatedFile.path ? updatedFile : f));
                        service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `[NEURAL_SYNC_SUCCESS]: "${targetFile.name}" updated with your changes.` } }]);
                      } else {
                        service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: "Error: No active file." } }]);
                      }
                  } else if (fc.name === 'create_interview_file') {
                      const { filename, content } = fc.args as any;
                      let finalFilename = filename;
                      if (sessionPrefix) {
                          const baseName = filename.split('/').pop();
                          if (!baseName.startsWith(sessionPrefix)) finalFilename = `${sessionPrefix}_${baseName}`;
                      }
                      const path = `drive://${currentSessionId}/${finalFilename}`;
                      const newFile: CodeFile = { name: finalFilename, path, language: getLanguageFromExt(finalFilename) as any, content, loaded: true, isDirectory: false, isModified: false };
                      activeCodeFilesMapRef.current.set(path, newFile);
                      setInitialStudioFiles(prev => [...prev.filter(f => f.path !== path), newFile]);
                      service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `[NEURAL_SYNC_SUCCESS]: "${finalFilename}" created in workspace.` } }]);
                  }
              }
          }
        }, [{ functionDeclarations: [getCodeTool, updateActiveFileTool, createInterviewFileTool] }]);
      } catch (err: any) { logApi(`Init Failure: ${err.message}`, "error"); }
    }, backoffTime);
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
        
        setSynthesisStep('Persisting Final Workspace...');
        setSynthesisPercent(30);
        
        await saveCodeProject({ 
            id: interviewId, 
            name: `Interview_${mode}_${new Date().toLocaleDateString()}`, 
            files: currentFiles, 
            lastModified: Date.now(), 
            accessLevel: 'restricted', 
            allowedUserIds: currentUser ? [currentUser.uid] : [] 
        });

        const historyText = transcript.map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n');
        const codeText = currentFiles.map(f => `FILE: ${f.name}\nCONTENT:\n${f.content}`).join('\n\n');

        setSynthesisStep('Synthesizing Feedback...');
        setSynthesisPercent(60);

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Analyze this technical interview evaluation. Mode: ${mode}. History: ${historyText}. Workspace: ${codeText}. 
        CRITICAL: Use a strict 0-100 integer scale for the score. DO NOT use 1-10.
        Return JSON: { "score": integer (0 to 100), "technicalSkills": "string", "communication": "string", "collaboration": "string", "strengths": ["string"], "areasForImprovement": ["string"], "verdict": "string", "summary": "string", "learningMaterial": "Markdown" }`;

        const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt, config: { responseMimeType: 'application/json' } });
        const reportData = JSON.parse(response.text || '{}') as MockInterviewReport;
        setReport(reportData);
        
        setSynthesisStep('Archiving Video to Drive...');
        setSynthesisPercent(85);

        const videoBlob = new Blob(videoChunksRef.current, { type: 'video/webm' });
        const recording: MockInterviewRecording = { id: interviewId, userId: currentUser?.uid || 'guest', userName: currentUser?.displayName || 'Guest', userPhoto: currentUser?.photoURL, mode, language, jobDescription: jobDesc, interviewerInfo, timestamp: Date.now(), videoUrl: '', transcript, feedback: JSON.stringify(reportData), visibility };

        if (currentUser) {
            const token = getDriveToken();
            if (token) {
                const folderId = await ensureFolder(token, 'CodeStudio');
                const driveFileId = await uploadToDrive(token, await ensureFolder(token, 'Interviews', folderId), `Interview_${interviewId}.webm`, videoBlob);
                recording.videoUrl = `drive://${driveFileId}`;
            }
            await saveInterviewRecording(recording);
        }
        
        const existingBackupsRaw = localStorage.getItem('mock_interview_backups');
        let existingBackups: MockInterviewRecording[] = [];
        if (existingBackupsRaw) {
            try {
                const parsed = JSON.parse(existingBackupsRaw);
                if (Array.isArray(parsed)) {
                    existingBackups = parsed as MockInterviewRecording[];
                }
            } catch (e) {
                console.warn("Failed to parse interview backups", e);
            }
        }
        
        const newBackups: MockInterviewRecording[] = [...existingBackups, recording];
        localStorage.setItem('mock_interview_backups', JSON.stringify(newBackups));

        setSynthesisPercent(100);
        setSynthesisStep('Refraction Complete');
        setTimeout(() => { setIsGeneratingReport(false); setView('report'); }, 800);
    } catch (e) { 
        console.error("Report synthesis failed", e);
        setIsGeneratingReport(false); 
        setView('hub'); 
    }
  };

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
    setTranscript([]); setCoachingTranscript([]); setReport(null); setApiLogs([]); videoChunksRef.current = []; activeCodeFilesMapRef.current.clear();
    setTimeLeft(getDurationSeconds(mode));

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
      
      const sysPrompt = `Role: Senior Interviewer. Mode: ${mode}. Candidate: ${currentUser?.displayName}. Resume: ${resumeText}. Job: ${jobDesc}. 
      STRICT ANTI-SPOILING RULE: DO NOT AUTO-GENERATE SOLUTIONS. Present the problem statement first. Observe the candidate. Provide hints ONLY if requested or if they are significantly struggling.
      FILE NAMING RULE: Always use unique, descriptive file names for new problems (e.g., '${prefix}_binary_search.cpp'). DO NOT overwrite existing problem files.
      VISIBILITY RULE: When the user trigger a sync or sends a message, use the code snapshot provided in the prompt or 'get_current_code' tool to see the actual implementation.
      GOAL: Greet and begin the evaluation. Inject problem 1 into the sidebar using tools.`;
      
      await service.connect(mode === 'behavioral' ? 'Zephyr' : 'Software Interview Voice', sysPrompt, {
        onOpen: () => {
          setIsAiConnected(true);
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => { setTimeLeft(prev => { if (prev <= 1) { handleEndInterview(); return 0; } return prev - 1; }); }, 1000);
          if (checkpointTimerRef.current) clearInterval(checkpointTimerRef.current);
          checkpointTimerRef.current = setInterval(() => { if (isAiConnected && !isEndingRef.current) { setIsCheckpointing(true); handleReconnectAi(true); } }, 15 * 60 * 1000);
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
              let targetFile;
              if (filename) targetFile = allFiles.find(f => f.name === filename);
              else targetFile = allFiles.find(f => f.path === activeFilePath) || allFiles[0];
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
              } else {
                service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: "Error: No target file." } }]);
              }
            } else if (fc.name === 'create_interview_file') {
              const { filename, content } = fc.args as any;
              let finalFilename = filename;
              if (prefix) {
                  const base = filename.split('/').pop();
                  if (!base.startsWith(prefix)) finalFilename = `${prefix}_${base}`;
              }
              const path = `drive://${uuid}/${finalFilename}`;
              const newFile: CodeFile = { name: finalFilename, path, language: getLanguageFromExt(finalFilename) as any, content, loaded: true, isDirectory: false, isModified: false };
              activeCodeFilesMapRef.current.set(path, newFile);
              setInitialStudioFiles(prev => [...prev.filter(f => f.path !== path), newFile]);
              service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Success: '${finalFilename}' created for candidate.` } }]);
            }
          }
        }
      }, [{ functionDeclarations: [getCodeTool, updateActiveFileTool, createInterviewFileTool] }]);
      setView('interview');
    } catch (e: any) { alert("Startup failed."); setView('hub'); } finally { setIsStarting(false); }
  };

  const handleCommitPastedCode = () => {
    if (!pasteCodeBuffer.trim()) return;
    const filename = `${sessionPrefix}_manual_${Date.now()}.${pasteCodeLang}`;
    const path = `drive://${currentSessionId}/${filename}`;
    const newFile: CodeFile = { name: filename, path, language: getLanguageFromExt(filename) as any, content: pasteCodeBuffer, loaded: true, isDirectory: false, isModified: true };
    activeCodeFilesMapRef.current.set(path, newFile);
    setInitialStudioFiles(prev => [...prev.filter(f => f.path !== path), newFile]);
    setPasteCodeBuffer(''); setShowCodePasteOverlay(false);
  };

  const renderInterviewsList = (list: MockInterviewRecording[], isHistory: boolean) => {
    if (list.length === 0) {
        return (
            <div className="py-20 text-center text-slate-500 border-2 border-dashed border-slate-800 rounded-[2rem] bg-slate-900/30">
                <p>{isHistory ? "No interview history yet." : "No public evaluations found."}</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {list.map((rec) => {
                const isSelected = selectedIds.has(rec.id);
                return (
                    <div 
                        key={rec.id} 
                        onClick={() => {
                            setActiveRecording(rec);
                            const parsedFeedback = rec.feedback ? JSON.parse(rec.feedback) : null;
                            setReport(parsedFeedback);
                            setView('report');
                        }}
                        className={`bg-slate-900 border ${isSelected ? 'border-indigo-500 bg-indigo-900/5' : 'border-slate-800'} rounded-[2.5rem] p-6 hover:border-indigo-500/50 transition-all cursor-pointer group relative overflow-hidden flex flex-col justify-between`}
                    >
                        {isHistory && (
                            <button 
                                onClick={(e) => handleToggleSelect(rec.id, e)}
                                className="absolute top-4 left-4 z-20 text-slate-600 hover:text-indigo-400 transition-colors"
                            >
                                {isSelected ? <CheckSquare size={20}/> : <Square size={20}/>}
                            </button>
                        )}
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-indigo-400">
                                    <Video size={20}/>
                                </div>
                                <div className="min-w-0">
                                    <h4 className="font-bold text-white text-sm line-clamp-1">{rec.mode.replace('_', ' ').toUpperCase()}</h4>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase">{new Date(rec.timestamp).toLocaleDateString()}</p>
                                </div>
                            </div>
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-2 italic mb-6">"{rec.jobDescription || 'Technical evaluation session'}"</p>
                        <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                            <div className="flex items-center gap-2">
                                <User size={12} className="text-slate-500"/>
                                <span className="text-[10px] font-bold text-slate-500 uppercase">{rec.userName}</span>
                            </div>
                            <button className="text-indigo-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                                Results <ChevronRight size={12}/>
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden relative">
      <header className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 backdrop-blur-md shrink-0 z-40">
        <div className="flex items-center gap-4">
          <button onClick={() => view === 'hub' ? onBack() : view === 'artifact_viewer' ? setView('report') : setView('hub')} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><ArrowLeft size={20} /></button>
          <div><h1 className="text-lg font-bold text-white flex items-center gap-2"><Video className="text-red-500" size={20} /> {view === 'artifact_viewer' ? 'Artifact Viewer' : 'Mock Interview'}</h1>{(view === 'interview' || view === 'coaching' || view === 'artifact_viewer') && (<div className="flex items-center gap-1.5 text-[9px] font-black text-indigo-400 uppercase tracking-widest mt-0.5"><Fingerprint size={10}/> Session: {(activeRecording?.id || currentSessionId).substring(0, 8)}</div>)}</div>
        </div>
        <div className="flex items-center gap-3">
            {view === 'interview' && (<div className={`px-4 py-1.5 rounded-2xl border bg-slate-950/50 flex items-center gap-2 ${timeLeft < 300 ? 'border-red-500/50 text-red-400 animate-pulse' : 'border-indigo-500/30 text-indigo-400'}`}><Timer size={14}/><span className="font-mono text-base font-black tabular-nums">{formatTime(timeLeft)}</span></div>)}
            {view !== 'artifact_viewer' && (<button onClick={() => setShowDiagnostics(!showDiagnostics)} className={`p-2 rounded-lg transition-colors ${showDiagnostics ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}><Terminal size={18}/></button>)}
            {(view === 'report' || view === 'coaching') && (<button onClick={() => { setView('hub'); loadInterviews(); }} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black uppercase tracking-widest border border-slate-700"><History size={14}/><span>History</span></button>)}
            {view === 'interview' && (<button onClick={handleEndInterview} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg active:scale-95">End Session</button>)}
        </div>
      </header>
      <main className="flex-1 overflow-hidden relative">
        {isCheckpointing && (<div className="absolute inset-0 z-[110] bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center gap-6 animate-fade-in"><div className="p-8 bg-slate-900 border border-indigo-500/30 rounded-[3rem] flex flex-col items-center shadow-2xl"><div className="w-20 h-20 bg-indigo-600/10 rounded-3xl flex items-center justify-center mb-6 border border-indigo-500/20"><Database size={40} className="text-indigo-400 animate-pulse"/></div><h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">Neural Checkpoint</h3><p className="text-xs text-slate-500 uppercase font-black text-center max-w-xs">Rotating AI connection...</p></div></div>)}
        {view === 'hub' && (
          <div className="max-w-6xl mx-auto p-8 space-y-12 animate-fade-in overflow-y-auto h-full scrollbar-hide">
            <div className="bg-indigo-600 rounded-[3rem] p-12 shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center gap-10"><div className="relative z-10 flex-1 space-y-6"><h2 className="text-5xl font-black text-white italic tracking-tighter uppercase leading-none">Validate your<br/>Potential.</h2><button onClick={() => setView('prep')} className="px-10 py-5 bg-white text-indigo-600 font-black uppercase tracking-widest rounded-2xl shadow-2xl hover:scale-105 transition-all flex items-center gap-3"><Zap size={20} fill="currentColor"/> Begin Preparation</button></div><div className="relative z-10 hidden lg:block"><Bot size={100} className="text-indigo-400 animate-pulse"/></div></div>
            <div className="space-y-8"><div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800 w-fit shadow-lg"><button onClick={() => setHubTab('history')} className={`px-6 py-2 rounded-xl text-xs font-black uppercase transition-all ${hubTab === 'history' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500'}`}>History</button><button onClick={() => setHubTab('explore')} className={`px-6 py-2 rounded-xl text-xs font-black uppercase transition-all ${hubTab === 'explore' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500'}`}>Discovery</button></div>{loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-indigo-400" size={32}/></div> : renderInterviewsList(hubTab === 'history' ? myInterviews : publicInterviews, hubTab === 'history')}</div>
          </div>
        )}
        {view === 'prep' && (
          <div className="max-w-4xl mx-auto p-12 animate-fade-in-up"><div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl space-y-8"><div className="grid grid-cols-1 md:grid-cols-2 gap-8"><div className="space-y-6"><div className={`p-6 rounded-3xl border flex items-center justify-between transition-all ${driveToken ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-red-900/10 border-red-500/30 animate-pulse'}`}><div className="flex items-center gap-3"><HardDrive className={driveToken ? 'text-emerald-400' : 'text-red-400'} size={24}/><div><p className="text-xs font-bold text-white uppercase">Cloud Link</p></div></div>{!driveToken && <button onClick={handleConnectDrive} className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase">Link Drive</button>}</div><div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-4"><h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2"><FileSearch size={14}/> Job Desc</h3><textarea value={jobDesc} onChange={e => setJobDesc(e.target.value)} className="w-full h-32 bg-slate-950 border border-slate-700 rounded-2xl p-4 text-xs text-slate-300 outline-none resize-none"/></div></div><div className="space-y-6"><div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-4"><h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Target size={14}/> Scope</h3><div className="grid grid-cols-1 gap-2">{[{ id: 'coding', icon: Code, label: 'Algorithms' }, { id: 'system_design', icon: Layers, label: 'System Design' }, { id: 'behavioral', icon: MessageSquare, label: 'Behavioral' }].map(m => (<button key={m.id} onClick={() => setMode(m.id as any)} className={`p-4 rounded-2xl border text-left flex items-center justify-between transition-all ${mode === m.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-50'}`}><div className="flex items-center gap-2"><m.icon size={14}/><span className="text-[10px] font-bold uppercase">{m.label}</span></div></button>))}</div></div></div></div><button onClick={handleStartInterview} disabled={isStarting} className="w-full py-5 bg-gradient-to-r from-red-600 to-indigo-600 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl transition-all active:scale-95 disabled:opacity-30">Start Evaluation</button></div></div>
        )}
        {view === 'interview' && (
          <div className="h-full flex flex-col overflow-hidden relative"><div className="flex-1 bg-slate-950 relative flex flex-col md:flex-row overflow-hidden"><div className="flex-1 overflow-hidden relative flex flex-col bg-slate-950"><CodeStudio onBack={() => {}} currentUser={currentUser} userProfile={userProfile} onSessionStart={() => {}} onSessionStop={() => {}} onStartLiveSession={onStartLiveSession as any} initialFiles={initialStudioFiles} externalChatContent={transcript.map(t => ({ role: t.role, text: t.text }))} onSendExternalMessage={handleSendTextMessage} isInterviewerMode={true} isAiThinking={isAiThinking} onFileChange={handleEditorFileChange} onSyncCodeWithAi={handleSyncWithAi}/></div></div><div className={`absolute bottom-20 right-4 w-64 aspect-video rounded-3xl overflow-hidden border-4 ${isAiConnected ? 'border-indigo-500/50' : 'border-red-500/50 animate-pulse'} shadow-2xl z-[100] bg-black group transition-all`}><video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover"/><div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3"><button onClick={() => setShowCodePasteOverlay(true)} className="p-1.5 bg-indigo-600 rounded-lg text-white"><Code size={14}/></button></div></div></div>
        )}
        {view === 'report' && (
          <div className="max-w-4xl mx-auto p-8 animate-fade-in-up space-y-12 pb-32 overflow-y-auto h-full scrollbar-hide">
            <div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 flex flex-col items-center text-center space-y-6 shadow-2xl">
              <Trophy className="text-amber-500" size={64}/><h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">Evaluation Finished</h2>
              {report ? (
                <div className="flex flex-col items-center gap-6 w-full">
                    <div className="flex flex-wrap justify-center gap-4"><div className="px-8 py-4 bg-slate-950 rounded-2xl border border-slate-800"><p className="text-[10px] text-slate-500 uppercase">Score</p><p className="text-4xl font-black text-indigo-400">{report.score}</p></div><div className="px-8 py-4 bg-slate-950 rounded-2xl border border-slate-800"><p className="text-[10px] text-slate-500 uppercase">Verdict</p><p className={`text-xl font-black uppercase ${report.verdict.includes('Hire') ? 'text-emerald-400' : 'text-red-400'}`}>{report.verdict}</p></div></div>
                    <div className="w-full text-left"><div onClick={() => setView('artifact_viewer')} className="flex items-center justify-between cursor-pointer group mb-4"><h3 className="text-xl font-black text-white italic uppercase tracking-tighter flex items-center gap-3"><FolderOpen className="text-indigo-400"/> Workspace Artifacts</h3><span className="text-xs text-indigo-400 font-bold">Explore All <ChevronRight size={14}/></span></div><div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-inner" onClick={() => setView('artifact_viewer')}>{sessionProject?.files?.map((f, idx) => (<div key={idx} className="flex items-center justify-between p-3 border-b border-slate-900 last:border-0"><div className="flex items-center gap-3"><FileText size={16} className="text-indigo-500"/><span className="text-xs font-mono text-slate-400">{f.name}</span></div></div>))}</div></div>
                    <div className="text-left w-full bg-slate-950 p-8 rounded-[2rem] border border-slate-800"><h3 className="font-bold text-white mb-4"><Sparkles className="text-indigo-400" size={18}/> Summary</h3><p className="text-sm text-slate-400 leading-relaxed">{report.summary}</p></div>
                    <div className="text-left w-full bg-slate-950 p-8 rounded-[2rem] border border-slate-800"><h3 className="font-bold text-white mb-4"><BookOpen className="text-indigo-400" size={18}/> Growth Path</h3><div className="prose prose-invert prose-sm max-w-none"><MarkdownView content={report.learningMaterial} /></div></div>
                </div>
              ) : <Loader2 size={32} className="animate-spin text-indigo-400" />}
            </div>
          </div>
        )}
        {view === 'artifact_viewer' && (<div className="h-full flex flex-col bg-slate-950 animate-fade-in relative"><div className="flex-1"><CodeStudio onBack={() => setView('report')} currentUser={currentUser} userProfile={userProfile} onSessionStart={() => {}} onSessionStop={() => {}} onStartLiveSession={() => {}} initialFiles={sessionProject?.files || []} isInterviewerMode={true} isAiThinking={false}/></div><div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50"><button onClick={() => setView('report')} className="px-12 py-3 bg-indigo-600 text-white font-black uppercase tracking-widest rounded-2xl shadow-2xl">Return to Report</button></div></div>)}
      </main>
      {isGeneratingReport && (<div className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center gap-8 animate-fade-in"><div className="relative"><div className="w-32 h-32 border-4 border-indigo-500/10 rounded-full"></div><div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"/><Activity className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-400" size={40}/><div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-3xl font-black text-white">{Math.round(synthesisPercent)}%</div></div><h3 className="text-xl font-black text-white uppercase">{synthesisStep}</h3></div>)}
      {showCodePasteOverlay && (<div className="fixed inset-0 z-[150] flex items-center justify-center p-8 bg-slate-950/80 backdrop-blur-md animate-fade-in"><div className="bg-slate-900 border border-slate-700 rounded-[2.5rem] w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden animate-fade-in-up"><div className="p-6 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center"><h3 className="text-sm font-bold text-white uppercase">Code Injection</h3><button onClick={() => setShowCodePasteOverlay(false)}><X size={24}/></button></div><div className="p-8 space-y-6"><textarea value={pasteCodeBuffer} onChange={e => setPasteCodeBuffer(e.target.value)} className="w-full h-64 bg-slate-950 border border-slate-700 rounded-2xl p-6 text-sm font-mono text-indigo-300 outline-none resize-none shadow-inner" placeholder="// Paste logic..."/><button onClick={handleCommitPastedCode} disabled={!pasteCodeBuffer.trim()} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase shadow-xl flex items-center justify-center gap-2"><Send size={18}/>Inject</button></div></div></div>)}
    </div>
  );
};

export default MockInterview;
