import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MockInterviewRecording, TranscriptItem, CodeFile, UserProfile, Channel, CodeProject } from '../types';
import { auth } from '../services/firebaseConfig';
import { saveInterviewRecording, getPublicInterviews, deleteInterview, updateUserProfile, uploadFileToStorage, getUserInterviews, updateInterviewMetadata, saveCodeProject, getCodeProject, getUserProfile } from '../services/firestoreService';
import { GeminiLiveService } from '../services/geminiLive';
import { GoogleGenAI, Type } from '@google/genai';
import { generateSecureId } from '../utils/idUtils';
import CodeStudio from './CodeStudio';
import { MarkdownView } from './MarkdownView';
import { ArrowLeft, Video, Mic, Monitor, Play, Save, Loader2, Search, Trash2, CheckCircle, X, Download, ShieldCheck, User, Users, Building, FileText, ChevronRight, Zap, SidebarOpen, SidebarClose, Code, MessageSquare, Sparkles, Languages, Clock, Camera, Bot, CloudUpload, Trophy, BarChart3, ClipboardCheck, Star, Upload, FileUp, Linkedin, FileCheck, Edit3, BookOpen, Lightbulb, Target, ListChecks, MessageCircleCode, GraduationCap, Lock, Globe, ExternalLink, PlayCircle, RefreshCw, FileDown, Briefcase, Package, Code2, StopCircle, Youtube, AlertCircle, Eye, EyeOff, SaveAll, Wifi, WifiOff, Activity, ShieldAlert, Timer, FastForward, ClipboardList, Layers, Bug, Flag, Minus, Fingerprint, FileSearch, RefreshCcw, HeartHandshake, Speech, Send, History, Compass, Square, CheckSquare, Cloud, Award, Terminal, CodeSquare, Quote, Image as ImageIcon, Sparkle, LayoutPanelTop, TerminalSquare } from 'lucide-react';
import { getGlobalAudioContext, getGlobalMediaStreamDest, warmUpAudioContext, stopAllPlatformAudio } from '../utils/audioUtils';

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
  description: "Read the content of the solution file currently in the editor. Use this to evaluate the candidate's code.",
  parameters: { 
    type: Type.OBJECT, 
    properties: {
      request_context: { type: Type.STRING, description: "Context for why the code is being read." }
    }
  }
};

const updateActiveFileTool: any = {
  name: "update_active_file",
  description: "Update the content of the active code file in the editor. Use this to modify existing work, add comments, or provide a corrected solution.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      new_content: { type: Type.STRING, description: "The full content for the file, including headers and comments." },
      summary: { type: Type.STRING, description: "Brief description of the changes." }
    },
    required: ["new_content"]
  }
};

const createInterviewFileTool: any = {
  name: "create_interview_file",
  description: "Create a new file in the environment. Use this to provide a new technical challenge, a reference solution, or a code template.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      filename: { type: Type.STRING, description: "Name of the file (e.g. 'optimized_solution.py')" },
      content: { type: Type.STRING, description: "Initial content, including the problem statement and template." }
    },
    required: ["filename", "content"]
  }
};

type VideoFilter = 'none' | 'blur' | 'sepia' | 'executive' | 'hacker';

export const MockInterview: React.FC<MockInterviewProps> = ({ onBack, userProfile, onStartLiveSession }) => {
  const currentUser = auth?.currentUser;

  const [view, setView] = useState<'hub' | 'prep' | 'interview' | 'report' | 'coaching'>('hub');
  const [hubTab, setHubTab] = useState<'history' | 'explore'>('history');
  const [myInterviews, setMyInterviews] = useState<MockInterviewRecording[]>([]);
  const [publicInterviews, setPublicInterviews] = useState<MockInterviewRecording[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [isAiConnected, setIsAiConnected] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  
  const [timeLeft, setTimeLeft] = useState<number>(0); 
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [apiLogs, setApiLogs] = useState<{timestamp: number, msg: string, type: 'info' | 'error' | 'warn'}[]>([]);
  const [coachingLogs, setCoachingLogs] = useState<{time: string, msg: string, type: 'info' | 'error' | 'warn'}[]>([]);
  const [showCoachingDiagnostics, setShowCoachingDiagnostics] = useState(false);
  
  const reconnectAttemptsRef = useRef(0);
  const activeServiceIdRef = useRef<string | null>(null);
  const isEndingRef = useRef(false);

  const [synthesisStep, setSynthesisStep] = useState<string>('');
  const [synthesisPercent, setSynthesisPercent] = useState(0);
  const synthesisIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const hasExistingCoaching = useMemo(() => {
    return (activeRecording?.coachingTranscript && activeRecording.coachingTranscript.length > 0) || (coachingTranscript && coachingTranscript.length > 0);
  }, [activeRecording, coachingTranscript]);

  const [showCodePasteOverlay, setShowCodePasteOverlay] = useState(false);
  const [pasteCodeBuffer, setPasteCodeBuffer] = useState('');
  const [pasteCodeLang, setPasteCodeLang] = useState('cpp');
  
  const [videoFilter, setVideoFilter] = useState<VideoFilter>('none');
  
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  
  // Use a Map for O(1) lookups and to prevent duplicate entries during session
  const activeCodeFilesMapRef = useRef<Map<string, CodeFile>>(new Map());

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
    setApiLogs(prev => [{timestamp: Date.now(), msg, type}, ...prev].slice(0, 50));
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
    if (view === 'report' && (activeRecording?.id || currentSessionId)) {
        const pid = activeRecording?.id || currentSessionId;
        setLoadingProject(true);
        getCodeProject(pid).then(p => {
            setSessionProject(p);
            setLoadingProject(false);
        }).catch(() => setLoadingProject(false));
    }
  }, [view, activeRecording?.id, currentSessionId]);

  useEffect(() => {
    loadInterviews();
    return () => { 
        if (timerRef.current) clearInterval(timerRef.current);
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
            await updateInterviewMetadata(targetId, {
                coachingTranscript: coachingTranscript
            });
            const localBackupsRaw = localStorage.getItem('mock_interview_backups') || '[]';
            const localBackups = JSON.parse(localBackupsRaw) as MockInterviewRecording[];
            const idx = localBackups.findIndex(b => b.id === targetId);
            if (idx !== -1) {
                localBackups[idx].coachingTranscript = coachingTranscript;
                localStorage.setItem('mock_interview_backups', JSON.stringify(localBackups));
            }
        } catch (e) {
            console.error("Coaching sync failed", e);
        } finally {
            setIsCoachingSyncing(false);
        }
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
      const localBackups = (JSON.parse(localBackupsRaw) as MockInterviewRecording[])
          .filter(b => b && b.id && b.id.trim() !== "");
      
      const myFilteredBackups = localBackups.filter(b => b.userId === (currentUser?.uid || 'guest'));
      
      const myMap = new Map<string, MockInterviewRecording>();
      userData.forEach(rec => myMap.set(rec.id, rec));
      myFilteredBackups.forEach(backup => {
          if (!myMap.has(backup.id)) {
              myMap.set(backup.id, backup);
          }
      });

      const combined = Array.from(myMap.values());
      setMyInterviews(combined.sort((a, b) => b.timestamp - a.timestamp));
      setPublicInterviews(publicData.sort((a, b) => b.timestamp - a.timestamp));
      
      if (localBackups.length !== JSON.parse(localBackupsRaw).length) {
          localStorage.setItem('mock_interview_backups', JSON.stringify(localBackups));
      }
    } catch (e) {
        console.error("Ledger retrieval error", e);
    } finally { setLoading(false); }
  };

  const handleToggleSelect = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!id || id.trim() === "") return;
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedIds(next);
  };

  const handleSelectAll = () => {
      const list = hubTab === 'history' ? myInterviews : publicInterviews;
      const validIds = list.filter(i => i.id && i.id.trim() !== "").map(i => i.id);
      
      if (selectedIds.size === validIds.length) {
          setSelectedIds(new Set());
      } else {
          setSelectedIds(new Set(validIds));
      }
  };

  const handleDeleteSelected = async () => {
      const idsToPurge = Array.from(selectedIds).filter((id): id is string => typeof id === 'string' && id.trim() !== "");
      if (idsToPurge.length === 0) return;
      
      const count = idsToPurge.length;
      const confirmMsg = `Permanently delete ${count} selected technical evaluations? This will remove records from the cloud ledger.`;
      if (!confirm(confirmMsg)) return;

      setIsBulkDeleting(true);
      let failedCount = 0;
      let permissionDeniedCount = 0;
      
      try {
          for (const id of idsToPurge) {
              try {
                  await deleteInterview(id);
              } catch (e: any) {
                  console.error(`Failed to purge doc ${id}:`, e);
                  if (e.message?.includes('permission')) permissionDeniedCount++;
                  else failedCount++;
              }
          }
          
          const localBackupsRaw = localStorage.getItem('mock_interview_backups') || '[]';
          const localBackups = JSON.parse(localBackupsRaw) as MockInterviewRecording[];
          const nextLocal = localBackups.filter(b => !selectedIds.has(b.id));
          localStorage.setItem('mock_interview_backups', JSON.stringify(nextLocal));
          
          await loadInterviews();
          setSelectedIds(new Set());
          
          if (permissionDeniedCount > 0 || failedCount > 0) {
              let msg = `Purge completed with issues.`;
              if (permissionDeniedCount > 0) msg += `\n- ${permissionDeniedCount} items denied (you aren't the owner).`;
              if (failedCount > 0) msg += `\n- ${failedCount} network errors.`;
              alert(msg);
          }
      } catch (e: any) {
          alert("Atomic purge failed: " + e.message);
      } finally {
          setIsBulkDeleting(false);
      }
  };

  const handleSendTextMessage = (text: string) => {
    if (liveServiceRef.current && isAiConnected) {
        setIsAiThinking(true);
        const userMsg: TranscriptItem = { role: 'user', text, timestamp: Date.now() };
        if (view === 'coaching') {
            setCoachingTranscript(prev => [...prev, userMsg]);
            logCoach(`TEXT_PACKET_SENT: ${text.substring(0, 30)}...`, "info");
        } else {
            setTranscript(prev => [...prev, userMsg]);
            logApi(`INTERVIEW_TEXT_SENT: ${text.substring(0, 30)}...`, "info");
        }
        liveServiceRef.current.sendText(text);
        logApi("Neural Link: Transmitted chat data packet");
    }
  };

  const handleCommitPastedCode = () => {
      if (!pasteCodeBuffer.trim()) return;
      const wrapped = `\`\`\`${pasteCodeLang}\n${pasteCodeBuffer}\n\`\`\``;
      handleSendTextMessage(wrapped);
      setPasteCodeBuffer('');
      setShowCodePasteOverlay(false);
  };

  const handleReconnectAi = async (isAuto = false) => {
    if (isEndingRef.current) return;
    
    setIsAiConnected(false);
    if (liveServiceRef.current) liveServiceRef.current.disconnect();

    const backoffTime = isAuto ? Math.min(2000 * Math.pow(2, reconnectAttemptsRef.current), 10000) : 0;
    if (isAuto) {
        logApi(`Neural Link Retrying in ${backoffTime}ms...`, "warn");
        if (view === 'coaching') logCoach(`Neural Link dropped. Retrying in ${backoffTime}ms...`, "warn");
    }

    setTimeout(async () => {
      if (isEndingRef.current) return;
      
      const currentView = view;
      const currentMode = mode;
      const currentInterviewer = interviewerInfo;
      const currentTranscriptSnapshot = [...transcript];
      const currentCoachSnapshot = [...coachingTranscript];
      const currentReport = report;
      const currentDisplayName = currentUser?.displayName || 'Candidate';

      const activeTranscriptList = currentView === 'coaching' ? currentCoachSnapshot : currentTranscriptSnapshot;
      const historyText = activeTranscriptList.map(t => `${String(t.role).toUpperCase()}: ${t.text}`).join('\n');
      
      let prompt: string = "";
      if (currentView === 'coaching') {
          prompt = `RESUMING COACHING SESSION. You are a supportive Senior Career Coach. Reviewing report for ${currentDisplayName}. Evaluation Score: ${currentReport?.score}. Summary: ${currentReport?.summary}. 
          STRICT INSTRUCTION: You are here to review the candidate's previous performance. You can see their typed code and generated solutions. You are encouraged to generate code or corrected solutions directly in the editor using tools.
          [CHAT_LEDGER]:
          ${historyText}
          
          GOAL: Continue helping the candidate understand their feedback. Watch the text channel for code they might paste.`;
          logCoach("Initiating recovery handshake...");
      } else {
          prompt = `RESUMING INTERVIEW SESSION. Role: Senior Interviewer. Mode: ${currentMode}. Candidate: ${currentDisplayName}. 
          ${currentInterviewer ? `STRICT PERSONA LOCK: You are simulating this specific interviewer: "${currentInterviewer}". Adopt their tone, expertise level, and likely priorities.` : ''}
          STRICT INSTRUCTION: You MUST stay in ${currentMode} mode. Do NOT switch to other interview types (e.g., if in behavioral, do NOT ask technical/coding questions like TinyURL). 
          TEXT AWARENESS: You are monitoring both the audio and text channels. Treat chat inputs as primary communication.
          COMPLETE HISTORY SO FAR:\n${historyText}\n\nPick up exactly where the last message ended. If a technical question was already asked, continue discussing it. If the candidate was telling a story, ask a follow-up.`;
      }
      
      const service = new GeminiLiveService();
      activeServiceIdRef.current = service.id;
      liveServiceRef.current = service;

      try {
        logApi(`Re-linking AI...`);
        await service.connect(currentView === 'coaching' ? 'Zephyr' : 'Software Interview Voice', prompt, {
          onOpen: () => {
            if (activeServiceIdRef.current !== service.id) return;
            setIsAiConnected(true);
            reconnectAttemptsRef.current = 0;
            logApi("Link Active.");
            if (currentView === 'coaching') logCoach("Neural Link Restored.", "info");
          },
          onClose: (r) => {
            if (activeServiceIdRef.current !== service.id) return;
            setIsAiConnected(false);
            if (currentView === 'coaching') logCoach(`Neural Link Severed: ${r}`, "warn");
            if (!isEndingRef.current && isAuto && reconnectAttemptsRef.current < 5) {
              reconnectAttemptsRef.current++;
              handleReconnectAi(true);
            }
          },
          onError: (e: any) => { 
            if (activeServiceIdRef.current === service.id) {
                if (currentView === 'coaching') logCoach(`Handshake Error: ${e}`, "error");
                handleReconnectAi(true); 
            }
          },
          onVolumeUpdate: () => {},
          onTranscript: (text, isUser) => {
            if (activeServiceIdRef.current !== service.id) return;
            if (!isUser) setIsAiThinking(false);
            const setter = currentView === 'coaching' ? setCoachingTranscript : setTranscript;
            setter(prev => {
              const role = isUser ? 'user' : 'ai';
              const textStr = text as string;
              if (prev.length > 0 && prev[prev.length - 1].role === role) {
                const last = prev[prev.length - 1];
                return [...prev.slice(0, -1), { ...last, text: last.text + textStr }];
              }
              return [...prev, { role, text: textStr, timestamp: Date.now() }];
            });
          },
          onToolCall: async (toolCall: any) => {
              for (const fc of toolCall.functionCalls) {
                  if (fc.name === 'get_current_code') {
                      // Fix: added explicit type assertion to satisfy TypeScript compiler
                      const code = (Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[])[0]?.content || "// No code written yet.";
                      service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: code } }]);
                      logApi("AI Read Candidate Code");
                  } else if (fc.name === 'update_active_file') {
                      const { new_content } = fc.args as any;
                      // Fix: added explicit type assertion to satisfy TypeScript compiler
                      const firstFile = (Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[])[0];
                      if (firstFile) {
                          // Fix: added spread on explicitly cast object to satisfy TypeScript compiler
                          const updated = { ...(firstFile as CodeFile), content: new_content };
                          activeCodeFilesMapRef.current.set(updated.path, updated);
                          setInitialStudioFiles(prev => prev.map(f => f.path === updated.path ? updated : f));
                      }
                      service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: "Editor updated successfully." } }]);
                      logApi("AI Updated Solution File");
                  } else if (fc.name === 'create_interview_file') {
                      const { filename, content } = fc.args as any;
                      const path = `drive://${currentSessionId}/${filename}`;
                      const newFile: CodeFile = {
                        name: filename, path, 
                        language: getLanguageFromExt(filename) as any,
                        content, loaded: true, isDirectory: false, isModified: false
                      };
                      activeCodeFilesMapRef.current.set(path, newFile);
                      setInitialStudioFiles(prev => [newFile, ...prev]);
                      service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Created and focused new file: ${filename}` } }]);
                      logApi(`AI Created New File: ${filename}`);
                  }
              }
          }
        }, [{ functionDeclarations: [getCodeTool, updateActiveFileTool, createInterviewFileTool] }]);
      } catch (err: any) { 
          logApi(`Init Failure: ${err.message}`, "error"); 
          if (currentView === 'coaching') logCoach(`Critical Init Failure: ${err.message}`, "error");
      }
    }, backoffTime);
  };

  const handleStartCoaching = async () => {
      if (!report) return;
      if (liveServiceRef.current) { await liveServiceRef.current.disconnect(); }
      
      setView('coaching');
      setCoachingLogs([]);
      const prevTranscript = activeRecording?.coachingTranscript || [];
      setCoachingTranscript(prevTranscript);
      setIsAiConnected(false);
      logCoach("Initializing AI Coaching Session...");

      const service = new GeminiLiveService();
      activeServiceIdRef.current = service.id;
      liveServiceRef.current = service;

      const historyContext = prevTranscript.length > 0
        ? `RESUMING COACHING SESSION. PREVIOUS DISCUSSION HISTORY:\n${prevTranscript.map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n')}`
        : `STARTING NEW COACHING SESSION.`;

      const coachPrompt = `Role: Senior Career Coach & Technical Architect. 
      Candidate: ${currentUser?.displayName}. 
      Context: You just finished a technical mock interview (${mode}). 
      STRICT INSTRUCTION: You have access to the code editor. You are encouraged to generate code solutions or corrected implementations using tools. 
      TEXT AWARENESS: You should pay close attention to any code or text the user types into the chat input.
      ${historyContext}
      EVALUATION REPORT:
      Score: ${report.score}/100
      Verdict: ${report.verdict}
      Summary: ${report.summary}
      Strengths: ${report.strengths.join(', ')}
      Improvement Areas: ${report.areasForImprovement.join(', ')}
      
      GOAL: Introduce yourself as their coach. Offer to discuss their performance, explain specific feedback points, and provide guidance for their career growth. Be supportive, empathetic, but technically accurate. Use 'Zephyr' voice characteristics.`;

      try {
          await service.connect('Zephyr', coachPrompt, {
              onOpen: () => {
                  setIsAiConnected(true);
                  logCoach("Coaching Link Active.", "info");
              },
              onClose: (r) => { 
                if (activeServiceIdRef.current === service.id) {
                    setIsAiConnected(false);
                    logCoach(`Link closed: ${r}`, "warn");
                }
              },
