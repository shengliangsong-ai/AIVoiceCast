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
  
  // Use a Map for O(1) lookups and to guarantee uniqueness by path
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

  /**
   * CRITICAL FIX: Universal onFileChange handler.
   * Updates BOTH the Ref Map (for final save) AND the initialStudioFiles state.
   * This ensures that when the AI tool 'update_active_file' causes a re-render, 
   * the child component receives the LATEST user edits instead of resetting to old state.
   */
  const handleEditorFileChange = useCallback((file: CodeFile) => {
    activeCodeFilesMapRef.current.set(file.path, file);
    setInitialStudioFiles(prev => prev.map(f => f.path === file.path ? file : f));
  }, []);

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

      const activeTranscriptList = (currentView === 'coaching' ? currentCoachSnapshot : currentTranscriptSnapshot) as TranscriptItem[];
      const historyText = activeTranscriptList.map(t => `${String(t.role).toUpperCase()}: ${t.text}`).join('\n');
      
      let prompt: string = "";
      if (currentView === 'coaching') {
          prompt = `RESUMING COACHING SESSION. You are a supportive Senior Career Coach. Reviewing report for ${currentDisplayName}. Evaluation Score: ${currentReport?.score}. Summary: ${currentReport?.summary}. 
          STRICT INSTRUCTION: You are here to review the candidate's previous performance. You can see their typed code and generated solutions. You are encouraged to generate code or corrected solutions directly in the editor using tools.
          TEXT AWARENESS: Pay close attention to any code or text the user has provided in the chat history.
          [CHAT_LEDGER]:
          ${historyText}
          
          GOAL: Continue helping the candidate understand their feedback. Watch the text channel for code they might paste.`;
          logCoach("Initiating recovery handshake...");
      } else {
          prompt = `RESUMING INTERVIEW SESSION. Role: Senior Interviewer. Mode: ${currentMode}. Candidate: ${currentDisplayName}. 
          ${currentInterviewer ? `STRICT PERSONA LOCK: You are simulating this specific interviewer: "${currentInterviewer}". Adopt their tone, expertise level, and likely priorities.` : ''}
          STRICT INSTRUCTION: You MUST stay in ${currentMode} mode. Do NOT switch to other interview types (e.g., if in behavioral, do NOT ask technical/coding questions like TinyURL). 
          TEXT AWARENESS: You are monitoring both the audio and text channels. Treat chat inputs (including pasted code blocks) as primary communication.
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
            
            const role = isUser ? 'user' : 'ai';
            const textStr = text as string;
            
            if (currentView === 'coaching') {
              setCoachingTranscript((prev: TranscriptItem[]) => {
                if (prev.length > 0 && prev[prev.length - 1].role === role) {
                  const last = prev[prev.length - 1];
                  return [...prev.slice(0, -1), { ...last, text: last.text + textStr }];
                }
                return [...prev, { role, text: textStr, timestamp: Date.now() }];
              });
            } else {
              setTranscript((prev: TranscriptItem[]) => {
                if (prev.length > 0 && prev[prev.length - 1].role === role) {
                  const last = prev[prev.length - 1];
                  return [...prev.slice(0, -1), { ...last, text: last.text + textStr }];
                }
                return [...prev, { role, text: textStr, timestamp: Date.now() }];
              });
            }
          },
          onToolCall: async (toolCall: any) => {
              for (const fc of toolCall.functionCalls) {
                  if (fc.name === 'get_current_code') {
                      const firstFile = Array.from(activeCodeFilesMapRef.current.values())[0] as CodeFile | undefined;
                      const code = firstFile?.content || "// No code written yet.";
                      service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: code } }]);
                      logApi("AI Read Candidate Code");
                  } else if (fc.name === 'update_active_file') {
                      const { new_content } = fc.args as any;
                      const firstFile = Array.from(activeCodeFilesMapRef.current.values())[0] as CodeFile | undefined;
                      if (firstFile) {
                        const updatedFile = { ...firstFile, content: new_content };
                        activeCodeFilesMapRef.current.set(updatedFile.path, updatedFile);
                        setInitialStudioFiles(prev => prev.map(f => f.path === updatedFile.path ? updatedFile : f));
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
      TEXT AWARENESS: You should pay close attention to any code or text the user types into the chat input or has provided in history.
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
              onError: (e) => { 
                if (activeServiceIdRef.current === service.id) {
                    setIsAiConnected(false);
                    logCoach(`WebSocket Error: ${e}`, "error");
                }
              },
              onVolumeUpdate: () => {},
              onTranscript: (text, isUser) => {
                  if (activeServiceIdRef.current !== service.id) return;
                  if (!isUser) setIsAiThinking(false);
                  
                  const role = isUser ? 'user' : 'ai';
                  const textStr = text as string;
                  
                  setCoachingTranscript((prev: TranscriptItem[]) => {
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
                          const firstFile = Array.from(activeCodeFilesMapRef.current.values())[0] as CodeFile | undefined;
                          const code = firstFile?.content || "// No code written yet.";
                          service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: code } }]);
                      } else if (fc.name === 'update_active_file') {
                          const { new_content } = fc.args as any;
                          const firstFile = Array.from(activeCodeFilesMapRef.current.values())[0] as CodeFile | undefined;
                          if (firstFile) {
                            const updatedFile = { ...firstFile, content: new_content };
                            activeCodeFilesMapRef.current.set(updatedFile.path, updatedFile);
                            setInitialStudioFiles(prev => prev.map(f => f.path === updatedFile.path ? updatedFile : f));
                          }
                          service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: "Editor updated." } }]);
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
                          service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Created new file: ${filename}` } }]);
                      }
                  }
              }
          }, [{ functionDeclarations: [getCodeTool, updateActiveFileTool, createInterviewFileTool] }]);
      } catch (e: any) {
          logCoach(`Fatal connection failure: ${e.message}`, "error");
          setView('report');
      }
  };

  const startSmoothProgress = useCallback(() => {
    setSynthesisPercent(0);
    if (synthesisIntervalRef.current) clearInterval(synthesisIntervalRef.current);
    synthesisIntervalRef.current = setInterval(() => {
      setSynthesisPercent(prev => {
        if (prev >= 98) return prev;
        return prev + (100 - prev) * 0.05;
      });
    }, 500);
  }, []);

  const handleStartInterview = async () => {
    setIsStarting(true);
    isEndingRef.current = false;
    const uuid = generateSecureId();
    setCurrentSessionId(uuid);

    let camStream: MediaStream | null = null;
    let screenStream: MediaStream | null = null;
    
    try {
        logApi("Capturing Screen...");
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" } as any, audio: true });
    } catch(e) { logApi("Screen capture declined.", "warn"); }

    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
    } catch(e) { alert("Camera/Mic mandatory."); setIsStarting(false); return; }

    const audioCtx = getGlobalAudioContext();
    await warmUpAudioContext(audioCtx);

    reconnectAttemptsRef.current = 0;
    setTranscript([]);
    setCoachingTranscript([]);
    setReport(null);
    setApiLogs([]);
    videoChunksRef.current = [];
    activeCodeFilesMapRef.current.clear();

    const duration = getDurationSeconds(mode);
    setTimeLeft(duration);

    try {
      const recordingDest = getGlobalMediaStreamDest();
      const micSource = audioCtx.createMediaStreamSource(camStream);
      micSource.connect(recordingDest);
      activeStreamRef.current = camStream;
      activeScreenStreamRef.current = screenStream;

      const filesToInit: CodeFile[] = [];
      if (mode === 'coding' || mode === 'quick_screen' || mode.startsWith('assessment')) {
          const ext = language.toLowerCase() === 'python' ? 'py' : (language.toLowerCase().includes('java') ? 'java' : 'cpp');
          filesToInit.push({
              name: `solution.${ext}`, path: `drive://${uuid}/solution.${ext}`, language: language.toLowerCase() as any,
              content: `/* \n * Interview: ${mode}\n * Waiting for interviewer to post problem...\n */\n\n`, loaded: true, isDirectory: false, isModified: false
          });
      } else if (mode === 'system_design') {
          filesToInit.push({
              name: 'architecture.draw', path: `drive://${uuid}/architecture.draw`, language: 'whiteboard',
              content: '[]', loaded: true, isDirectory: false, isModified: false
          }, {
              name: 'design_spec.md', path: `drive://${uuid}/design_spec.md`, language: 'markdown',
              content: `# System Design: ${jobDesc || 'New Architecture'}\n`, loaded: true, isDirectory: false, isModified: false
          });
      } else {
          filesToInit.push({
              name: 'scratchpad.md', path: `drive://${uuid}/scratchpad.md`, language: 'markdown',
              content: `# Scratchpad\n`, loaded: true, isDirectory: false, isModified: false
          });
      }

      filesToInit.forEach(f => activeCodeFilesMapRef.current.set(f.path, f));
      setInitialStudioFiles([...filesToInit]);

      await saveCodeProject({
          id: uuid, name: `Interview_${mode}_${new Date().toLocaleDateString()}`,
          files: filesToInit, lastModified: Date.now(), accessLevel: 'restricted',
          allowedUserIds: currentUser ? [currentUser.uid] : []
      });

      const isPortrait = window.innerHeight > window.innerWidth;
      const canvas = document.createElement('canvas');
      canvas.width = isPortrait ? 720 : 1280; canvas.height = isPortrait ? 1280 : 720;
      const drawCtx = canvas.getContext('2d', { alpha: false })!;
      const camVideo = document.createElement('video'); camVideo.srcObject = camStream; camVideo.muted = true; camVideo.play();
      const screenVideo = document.createElement('video'); if (screenStream) { screenVideo.srcObject = screenStream; screenVideo.muted = true; screenVideo.play(); }

      const drawFrame = () => {
        if (isEndingRef.current) return;
        
        if (screenStream && screenVideo.readyState >= 2) {
            drawCtx.fillStyle = '#020617'; drawCtx.fillRect(0, 0, canvas.width, canvas.height);
            const scale = Math.min(canvas.width / screenVideo.videoWidth, canvas.height / screenVideo.videoHeight);
            const w = screenVideo.videoWidth * scale; const h = screenVideo.videoHeight * scale;
            drawCtx.drawImage(screenVideo, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        } else { drawCtx.fillStyle = '#020617'; drawCtx.fillRect(0, 0, canvas.width, canvas.height); }
        
        if (camVideo.readyState >= 2) {
          const pipW = isPortrait ? canvas.width * 0.5 : 320;
          const realH = (pipW * camVideo.videoHeight) / camVideo.videoWidth;
          const pipX = isPortrait ? (canvas.width - pipW) / 2 : canvas.width - pipW - 24;
          const pipY = isPortrait ? canvas.height - realH - 120 : canvas.height - realH - 24;
          
          drawCtx.save();
          drawCtx.strokeStyle = '#6366f1'; drawCtx.lineWidth = 4; drawCtx.strokeRect(pipX, pipY, pipW, realH); 
          drawCtx.drawImage(camVideo, pipX, pipY, pipW, realH);
          drawCtx.restore();
        }
        requestAnimationFrame(drawFrame);
      };
      drawFrame();

      const combinedStream = canvas.captureStream(30);
      recordingDest.stream.getAudioTracks().forEach(t => combinedStream.addTrack(t));
      const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 2500000 });
      recorder.ondataavailable = e => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
      mediaRecorderRef.current = recorder;
      recorder.start(1000);
      setIsRecording(true);

      const service = new GeminiLiveService();
      activeServiceIdRef.current = service.id;
      liveServiceRef.current = service;
      
      const sysPrompt = `Role: Senior Interviewer. Mode: ${mode}. Candidate: ${currentUser?.displayName}. Resume: ${resumeText}. Job: ${jobDesc}. 
      ${interviewerInfo ? `STRICT PERSONA LOCK: You are simulating this specific interviewer: "${interviewerInfo}". Adopt their tone, expertise level, and likely priorities.` : ''}
      STRICT MODE LOCK: You are currently in ${mode} mode. Do NOT switch to technical coding questions if you are in behavioral mode. If you are in system design mode, focus on architecture.
      TEXT AWARENESS: You are monitoring both the audio and text channels. Treat chat inputs (including pasted code blocks) as primary communication.
      GOAL: Greet the candidate. For ${mode} mode, begin your evaluation sequence.
      INSTRUCTIONS: For technical modes, you MUST write the technical challenge directly into a solution file using 'update_active_file' or 'create_interview_file'. For behavioral mode, do NOT use the coding files unless the user wants to take notes.`;
      
      await service.connect(mode === 'behavioral' ? 'Zephyr' : 'Software Interview Voice', sysPrompt, {
        onOpen: () => {
          setIsAiConnected(true);
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            setTimeLeft(prev => { if (prev <= 1) { handleEndInterview(); return 0; } return prev - 1; });
          }, 1000);
        },
        onClose: (r) => { if (activeServiceIdRef.current === service.id) { setIsAiConnected(false); handleReconnectAi(true); } },
        onError: (e) => { if (activeServiceIdRef.current === service.id) { setIsAiConnected(false); handleReconnectAi(true); } },
        onVolumeUpdate: () => {},
        onTranscript: (text, isUser) => {
          const role = isUser ? 'user' : 'ai';
          const textStr = text as string;
          
          setTranscript((prev: TranscriptItem[]) => {
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
              const firstFile = Array.from(activeCodeFilesMapRef.current.values())[0] as CodeFile | undefined;
              const code = firstFile?.content || "// No code written yet.";
              service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: code } }]);
            } else if (fc.name === 'update_active_file') {
              const { new_content } = fc.args as any;
              const firstFile = Array.from(activeCodeFilesMapRef.current.values())[0] as CodeFile | undefined;
              if (firstFile) {
                const updatedFile = { ...firstFile, content: new_content };
                activeCodeFilesMapRef.current.set(updatedFile.path, updatedFile);
                setInitialStudioFiles(prev => prev.map(f => f.path === updatedFile.path ? updatedFile : f));
              }
              service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: "Editor updated." } }]);
            } else if (fc.name === 'create_interview_file') {
              const { filename, content } = fc.args as any;
              const path = `drive://${uuid}/${filename}`;
              const newFile: CodeFile = {
                name: filename, path, 
                language: getLanguageFromExt(filename) as any,
                content, loaded: true, isDirectory: false, isModified: false
              };
              activeCodeFilesMapRef.current.set(path, newFile);
              setInitialStudioFiles(prev => [newFile, ...prev]);
              service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Created new file: ${filename}` } }]);
            }
          }
        }
      }, [{ functionDeclarations: [getCodeTool, updateActiveFileTool, createInterviewFileTool] }]);
      
      setView('interview');
    } catch (e: any) { alert("Startup failed."); setView('hub'); } finally { setIsStarting(false); }
  };

  const handleEndInterview = async () => {
    if (isEndingRef.current) return;

    const confirmEnd = window.confirm("Finalize and generate report? This will audit all code, diagrams, and transcripts.");
    if (!confirmEnd) return;

    isEndingRef.current = true;
    setIsGeneratingReport(true);
    startSmoothProgress();
    
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    setSynthesisStep('De-linking Neural Core...');
    if (liveServiceRef.current) { await liveServiceRef.current.disconnect(); }
    setIsAiConnected(false);
    setIsRecording(false);

    setSynthesisStep('Syncing Artifacts...');
    // Ensure we are using the LATEST content from our Ref Map
    const finalFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
    try {
        await saveCodeProject({
            id: currentSessionId, name: `Interview_${mode}_${new Date().toLocaleDateString()}`,
            files: finalFiles, lastModified: Date.now(), accessLevel: 'restricted',
            allowedUserIds: currentUser ? [currentUser.uid] : []
        });
    } catch (e) {}

    setSynthesisStep('Closing Video Channel...');
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        const blobPromise = new Promise<Blob>((resolve) => {
            const rec = mediaRecorderRef.current!;
            rec.onstop = () => resolve(new Blob(videoChunksRef.current, { type: 'video/webm' }));
            rec.stop();
        });
        videoBlobRef.current = await blobPromise;
    }

    try {
        activeStreamRef.current?.getTracks().forEach(t => t.stop());
        activeScreenStreamRef.current?.getTracks().forEach(t => t.stop());
    } catch (e) {}

    setSynthesisStep('Analyzing Cognitive Performance...');
    const projectFilesContext = finalFiles.map(f => `FILE: ${f.name}\nCONTENT:\n${f.content}`).join('\n\n---\n\n');
    const transcriptText = transcript.map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n');

    const tryEvaluate = async (attempt: number): Promise<MockInterviewReport | null> => {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const prompt = `AUDIT REPORT: Technical Mock Interview Evaluation. 
            MODE: ${mode} 
            JOB_SPEC: ${jobDesc}
            INTERVIEWER_PROFILE: ${interviewerInfo}
            TRANSCRIPT: ${transcriptText}
            ARTIFACTS (CODE/DOCS): ${projectFilesContext}

            EVALUATION CRITERIA:
            1. CRITICAL: If mode is 'behavioral', ignore the lack of code artifacts. Evaluate SOLELY based on the candidate's conversation, STAR method adherence, and communication skills.
            2. SCORE RANGE: 0-100. A score of 0 is reserved for NO engagement. If the candidate spoke meaningfully, they must receive a representative score based on their answers.
            3. ANALYSIS: For technical modes, evaluate both code quality and verbal reasoning.
            4. STAR EXTRACTION: Scan the transcript for any specific stories or anecdotes shared by the candidate. Re-structure them into highly optimized STAR (Situation, Task, Action, Result) answers. These should represent the 'ideal' version of the candidate's own experience.
            5. PERSONA ADAPTATION: If an Interviewer Profile was provided, evaluate how well the candidate tailored their answers to that specific interviewer's likely expectations or technical focus.
            
            Return ONLY JSON: score(0-100), technicalSkills, communication, collaboration, strengths[], areasForImprovement[], verdict, summary, learningMaterial(Markdown), 
            optimizedStarStories: Array<{ title: string, situation: string, task: string, action: string, result: string, coachTip: string }>.`;

            const response = await ai.models.generateContent({
                model: attempt === 1 ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview',
                contents: prompt,
                config: { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: attempt === 1 ? 4000 : 0 } }
            });
            return JSON.parse(response.text || "null");
        } catch (e) { return null; }
    };

    let reportData = await tryEvaluate(1);
    if (!reportData) { setSynthesisStep('Re-scanning neural trace...'); reportData = await tryEvaluate(2); }

    if (reportData) {
      setReport(reportData);
      setSynthesisStep('Saving to Cloud Ledger...');
      const rec: MockInterviewRecording = {
        id: currentSessionId, userId: currentUser?.uid || 'guest', userName: currentUser?.displayName || 'Guest',
        mode, language, jobDescription: jobDesc, interviewerInfo, timestamp: Date.now(), videoUrl: "", 
        transcript: transcript.map(t => ({ role: t.role, text: t.text, timestamp: t.timestamp })),
        coachingTranscript: [],
        feedback: JSON.stringify(reportData), visibility
      };
      
      const localBackupsRaw = localStorage.getItem('mock_interview_backups') || '[]';
      const localBackups = JSON.parse(localBackupsRaw) as MockInterviewRecording[];
      const existingIdx = localBackups.findIndex(b => b.id === rec.id);
      if (existingIdx !== -1) {
          localBackups[existingIdx] = rec;
      } else {
          localBackups.push(rec);
      }
      
      localStorage.setItem('mock_interview_backups', JSON.stringify(localBackups.slice(-20))); 
      await saveInterviewRecording(rec);
      
      setSynthesisPercent(100);
      setView('report');
      loadInterviews();
    } else {
        alert("Evaluation failed. Session archived to local history.");
        setView('hub');
    }
    
    setIsGeneratingReport(false);
    if (synthesisIntervalRef.current) clearInterval(synthesisIntervalRef.current);
  };

  const renderInterviewsList = (list: MockInterviewRecording[], isMine: boolean) => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {list.map(rec => {
            const isSelected = selectedIds.has(rec.id);
            return (
                <div key={rec.id} onClick={() => { setActiveRecording(rec); setReport(JSON.parse(rec.feedback || '{}')); setView('report'); }} className={`bg-slate-900 border ${isSelected ? 'border-indigo-500 bg-indigo-900/10' : 'border-slate-800'} rounded-[2.5rem] p-6 hover:border-indigo-500/50 transition-all group cursor-pointer shadow-xl relative overflow-hidden`}>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            {isMine && (
                                <button 
                                    onClick={(e) => handleToggleSelect(rec.id, e)}
                                    className={`p-1 rounded transition-colors ${isSelected ? 'text-indigo-400' : 'text-slate-700 hover:text-slate-500'}`}
                                >
                                    {isSelected ? <CheckSquare size={18}/> : <Square size={18}/>}
                                </button>
                            )}
                            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">{rec.userName[0]}</div>
                            <div className="min-w-0">
                                <h4 className="font-bold text-white text-sm truncate max-w-[100px]">@{rec.userName}</h4>
                                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">{new Date(rec.timestamp).toLocaleDateString()}</p>
                            </div>
                        </div>
                        {rec.visibility === 'public' && <Globe size={14} className="text-emerald-400"/>}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black uppercase bg-indigo-900/20 text-indigo-400 px-3 py-1 rounded-full border border-indigo-500/30">{rec.mode.replace('_', ' ')}</span>
                        <span className="text-[9px] font-mono text-slate-700">ID: {rec.id.substring(0, 6)}</span>
                    </div>
                </div>
            );
        })}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden relative">
      <header className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 backdrop-blur-md shrink-0 z-40">
        <div className="flex items-center gap-4">
          <button onClick={() => view === 'hub' ? onBack() : setView('hub')} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <Video className="text-red-500" size={20} /> 
                Mock Interview
            </h1>
            {(view === 'interview' || view === 'coaching') && (
                <div className="flex items-center gap-1.5 text-[9px] font-black text-indigo-400 uppercase tracking-widest mt-0.5">
                    <Fingerprint size={10}/> Session Ledger: {(activeRecording?.id || currentSessionId).substring(0, 12)}...
                </div>
            )}
          </div>
        </div>
        {(view === 'report' || view === 'coaching') && (
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => { setView('hub'); loadInterviews(); }}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black uppercase tracking-widest border border-slate-700 active:scale-95 transition-all"
                >
                    <History size={14}/>
                    <span>History Hub</span>
                </button>
            </div>
        )}
        {view === 'interview' && (
          <div className="flex items-center gap-4">
            <div className={`px-4 py-1.5 rounded-2xl border bg-slate-950/50 flex items-center gap-2 ${timeLeft < 300 ? 'border-red-500/50 text-red-400 animate-pulse' : 'border-indigo-500/30 text-indigo-400'}`}>
                <Timer size={14}/><span className="font-mono text-base font-black tabular-nums">{formatTime(timeLeft)}</span>
            </div>
            <button onClick={handleEndInterview} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-red-900/20 active:scale-95 transition-all">End Session</button>
          </div>
        )}
      </header>

      <main className="flex-1 overflow-hidden relative">
        {view === 'hub' && (
          <div className="max-w-6xl mx-auto p-8 space-y-12 animate-fade-in overflow-y-auto h-full scrollbar-hide">
            <div className="bg-indigo-600 rounded-[3rem] p-12 shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center gap-10">
              <div className="absolute top-0 right-0 p-32 bg-white/10 blur-[100px] rounded-full"></div>
              <div className="relative z-10 flex-1 space-y-6">
                <h2 className="text-5xl font-black text-white italic tracking-tighter uppercase leading-none">Verify your<br/>Potential.</h2>
                <p className="text-indigo-100 text-lg max-w-sm">Rigorous AI-driven technical evaluations for senior software engineering roles.</p>
                <button onClick={() => setView('prep')} className="px-10 py-5 bg-white text-indigo-600 font-black uppercase tracking-widest rounded-2xl shadow-2xl hover:scale-105 transition-all flex items-center gap-3"><Zap size={20} fill="currentColor"/> Begin Preparation</button>
              </div>
              <div className="relative z-10 hidden lg:block"><div className="w-64 h-64 bg-slate-950 rounded-[3rem] border-8 border-indigo-400/30 flex items-center justify-center rotate-3 shadow-2xl"><Bot size={100} className="text-indigo-400 animate-pulse"/></div></div>
            </div>

            <div className="space-y-8">
              <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800 w-fit mx-auto sm:mx-0 shadow-lg">
                <button onClick={() => { setHubTab('history'); setSelectedIds(new Set()); }} className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest rounded-xl transition-all ${hubTab === 'history' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-white'}`}><History size={14}/> My History</button>
                <button onClick={() => { setHubTab('explore'); setSelectedIds(new Set()); }} className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest rounded-xl transition-all ${hubTab === 'explore' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:text-white'}`}><Compass size={14}/> Global Discovery</button>
              </div>
              
              <div className="animate-fade-in-up">
                {hubTab === 'history' ? (
                  <>
                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
                        <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">Verified Session History</h3>
                        
                        <div className="flex items-center gap-2">
                            {myInterviews.length > 0 && (
                                <div className={`flex items-center gap-3 p-2 rounded-2xl border transition-all duration-300 ${selectedIds.size > 0 ? 'bg-indigo-600 border-indigo-400 shadow-xl' : 'bg-slate-900 border-slate-800'}`}>
                                    <button onClick={handleSelectAll} className="flex items-center gap-2 text-[10px] font-black text-white uppercase tracking-widest px-2 hover:opacity-80">
                                        {selectedIds.size === myInterviews.length ? <CheckSquare size={18}/> : <Square size={18}/>}
                                        <span>{selectedIds.size === myInterviews.length ? 'Deselect' : 'All'}</span>
                                    </button>
                                    {selectedIds.size > 0 && (
                                        <button 
                                            onClick={handleDeleteSelected} 
                                            disabled={isBulkDeleting}
                                            className="flex items-center gap-1.5 px-4 py-1 bg-white text-indigo-600 hover:bg-red-50 hover:text-red-600 rounded-xl text-[10px] font-black uppercase transition-all disabled:opacity-50"
                                        >
                                            {isBulkDeleting ? <Loader2 size={12} className="animate-spin"/> : <Trash2 size={12}/>}
                                            <span>Purge ({selectedIds.size})</span>
                                        </button>
                                    )}
                                </div>
                            )}
                            <button onClick={loadInterviews} className="p-3 bg-slate-900 border border-slate-800 rounded-2xl text-slate-400 hover:text-indigo-400 transition-colors">
                                <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>
                            </button>
                        </div>
                    </div>
                    {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-indigo-400" size={32}/></div> : myInterviews.length === 0 ? <div className="py-20 text-center text-slate-500 border border-dashed border-slate-800 rounded-3xl">No archived ledger entries.</div> : renderInterviewsList(myInterviews, true)}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">Global Community Evaluations</h3>
                        <button onClick={loadInterviews} className="text-[10px] font-black text-indigo-400 flex items-center gap-1.5 hover:text-white transition-colors uppercase tracking-widest">
                            <RefreshCw size={12} className={loading ? 'animate-spin' : ''}/> Refresh Discovery
                        </button>
                    </div>
                    {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-indigo-400" size={32}/></div> : publicInterviews.length === 0 ? <div className="py-20 text-center text-slate-500 border border-dashed border-slate-800 rounded-3xl">No public evaluations discovered yet.</div> : renderInterviewsList(publicInterviews, false)}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {view === 'prep' && (
          <div className="max-w-4xl mx-auto p-12 animate-fade-in-up">
            <div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-4 shadow-inner">
                    <h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2"><FileSearch size={14}/> Job Specification</h3>
                    <textarea value={jobDesc} onChange={e => setJobDesc(e.target.value)} placeholder="Paste Job Description for targeted evaluation..." className="w-full h-32 bg-slate-950 border border-slate-700 rounded-2xl p-4 text-xs text-slate-300 outline-none resize-none focus:border-emerald-500/50 transition-all"/>
                  </div>
                  <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-4 shadow-inner">
                    <div className="flex justify-between items-center px-1">
                        <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2"><User size={14}/> Portfolio</h3>
                        <button onClick={handleSyncResume} className="text-[10px] font-black text-slate-500 hover:text-indigo-400 flex items-center gap-1 transition-colors uppercase tracking-widest"><RefreshCcw size={12}/> Sync Profile</button>
                    </div>
                    <textarea value={resumeText} onChange={e => setResumeText(e.target.value)} placeholder="Paste resume or sync from profile..." className="w-full h-48 bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 outline-none resize-none focus:border-indigo-500/50 transition-all"/>
                  </div>
                </div>
                <div className="space-y-6">
                  <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-4 shadow-inner">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Target size={14}/> Evaluation Scope</h3>
                    <div className="grid grid-cols-1 gap-2">
                      {[{ id: 'coding', icon: Code, label: 'Algorithm & DS' }, { id: 'system_design', icon: Layers, label: 'System Design' }, { id: 'behavioral', icon: MessageSquare, label: 'Behavioral' }].map(m => (<button key={m.id} onClick={() => setMode(m.id as any)} className={`p-4 rounded-2xl border text-left flex items-center justify-between transition-all ${mode === m.id ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-slate-950 border border-slate-800 text-slate-50'}`}><div className="flex items-center gap-2"><m.icon size={14}/><span className="text-[10px] font-bold uppercase">{m.label}</span></div>{mode === m.id && <CheckCircle size={14}/>}</button>))}
                    </div>
                  </div>
                  <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-4 shadow-inner">
                    <h3 className="text-xs font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2"><Briefcase size={14}/> Simulated Interviewer Profile</h3>
                    <textarea value={interviewerInfo} onChange={e => setInterviewerInfo(e.target.value)} placeholder="Simulate a specific interviewer (e.g. 'I will have an interview with John Doe at Google. He is a Staff Engineer with expertise in SRE...')" className="w-full h-24 bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 outline-none resize-none focus:border-indigo-500/50 transition-all shadow-inner"/>
                    <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest px-1 italic">AI adopts this persona's tone, title, and expertise focus</p>
                  </div>
                  <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-4 shadow-inner">
                    <h3 className="text-xs font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2"><Globe size={14}/> Visibility</h3>
                    <div className="flex gap-2">
                        <button onClick={() => setVisibility('public')} className={`flex-1 py-3 rounded-xl border text-[10px] font-bold uppercase transition-all ${visibility === 'public' ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg' : 'bg-slate-900 border-slate-800 text-slate-500'}`}>Public Ledger</button>
                        <button onClick={() => setVisibility('private')} className={`flex-1 py-3 rounded-xl border text-[10px] font-bold uppercase transition-all ${visibility === 'private' ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-slate-900 border-slate-800 text-slate-500'}`}>Private Link</button>
                    </div>
                  </div>
                </div>
              </div>
              <button onClick={handleStartInterview} disabled={isStarting} className="w-full py-5 bg-gradient-to-r from-red-600 to-indigo-600 text-white font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-indigo-900/20 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-30">{isStarting ? <Loader2 className="animate-spin" /> : 'Start Technical Evaluation'}</button>
            </div>
          </div>
        )}

        {view === 'interview' && (
          <div className="h-full flex flex-col overflow-hidden relative">
            <div className="flex-1 bg-slate-950 relative flex flex-col md:flex-row overflow-hidden">
                <div className="flex-1 overflow-hidden relative flex flex-col bg-slate-950">
                    <CodeStudio 
                        onBack={() => {}} currentUser={currentUser} userProfile={userProfile} onSessionStart={() => {}} onSessionStop={() => {}} onStartLiveSession={onStartLiveSession as any} 
                        initialFiles={initialStudioFiles} externalChatContent={transcript.map(t => ({ role: t.role, text: t.text }))}
                        onSendExternalMessage={handleSendTextMessage} isInterviewerMode={true} isAiThinking={isAiThinking}
                        onFileChange={handleEditorFileChange}
                    />
                </div>
            </div>
            
            <div className={`absolute bottom-20 right-4 w-64 aspect-video rounded-3xl overflow-hidden border-4 ${videoFilter === 'none' ? 'border-indigo-500/50' : 'border-emerald-500/50'} shadow-2xl z-[100] bg-black group transition-all`}>
                <video 
                    ref={localVideoRef} 
                    autoPlay 
                    muted 
                    playsInline 
                    className={`w-full h-full object-cover transition-all ${
                        videoFilter === 'blur' ? 'blur-md' : 
                        videoFilter === 'sepia' ? 'sepia contrast-125' : 
                        videoFilter === 'executive' ? 'brightness-110 contrast-125' :
                        videoFilter === 'hacker' ? 'hue-rotate-90 brightness-75' : ''
                    }`} 
                />
                
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3">
                    <div className="flex justify-between items-start">
                        <span className="bg-black/60 px-2 py-0.5 rounded text-[8px] font-black uppercase text-white">Neural Backdrop</span>
                        <button onClick={() => setShowCodePasteOverlay(true)} className="p-1.5 bg-indigo-600 rounded-lg text-white shadow-lg" title="Inject Code Snippet"><Code size={14}/></button>
                    </div>
                    <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1">
                        {[
                            { id: 'none', icon: ImageIcon },
                            { id: 'blur', icon: Sparkle },
                            { id: 'executive', icon: Briefcase },
                            { id: 'hacker', icon: Terminal }
                        ].map(f => (
                            <button 
                                key={f.id} 
                                onClick={() => setVideoFilter(f.id as VideoFilter)}
                                className={`p-1.5 rounded-lg border transition-all ${videoFilter === f.id ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-black/60 border-white/10 text-white/60 hover:text-white'}`}
                            >
                                <f.icon size={12}/>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
          </div>
        )}

        {view === 'report' && (
          <div className="max-w-4xl mx-auto p-8 animate-fade-in-up space-y-12 pb-32 overflow-y-auto h-full scrollbar-hide">
            <div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 flex flex-col items-center text-center space-y-6 shadow-2xl">
              <Trophy className="text-amber-500" size={64}/><h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">Evaluation Result</h2>
              {report ? (
                <div className="flex flex-col items-center gap-6 w-full">
                    <div className="flex flex-wrap justify-center gap-4"><div className="px-8 py-4 bg-slate-950 rounded-2xl border border-slate-800"><p className="text-[10px] text-slate-500 font-bold uppercase">Score</p><p className="text-4xl font-black text-indigo-400">{report.score}/100</p></div><div className="px-8 py-4 bg-slate-950 rounded-2xl border border-slate-800"><p className="text-[10px] text-slate-500 font-bold uppercase">Verdict</p><p className={`text-xl font-black uppercase ${report.verdict.includes('Hire') ? 'text-emerald-400' : 'text-red-400'}`}>{report.verdict}</p></div></div>
                    <div className="bg-indigo-600/10 border border-indigo-500/30 rounded-3xl p-6 w-full flex flex-col md:flex-row items-center gap-6">
                        <div className="p-4 bg-indigo-600 text-white rounded-2xl shadow-xl shadow-indigo-900/40"><Speech size={32} /></div>
                        <div className="flex-1 text-center md:text-left"><h3 className="text-lg font-bold text-white mb-1">{hasExistingCoaching ? 'Resume AI Coaching' : 'Discuss with AI Coach'}</h3><p className="text-sm text-slate-400 leading-relaxed">Deeper dive into specific technical artifacts or behavioral refinement.</p></div>
                        <button onClick={handleStartCoaching} className="px-8 py-3 bg-white text-indigo-600 font-black uppercase tracking-widest rounded-xl hover:scale-105 transition-all shadow-xl active:scale-95">{hasExistingCoaching ? 'Resume Session' : 'Begin Coaching'}</button>
                    </div>
                    
                    <div className="text-left w-full bg-slate-950 p-8 rounded-[2rem] border border-slate-800"><h3 className="font-bold text-white mb-4 flex items-center gap-2"><Sparkles className="text-indigo-400" size={18}/> Summary</h3><p className="text-sm text-slate-400 leading-relaxed">{report.summary}</p></div>
                    
                    <div className="w-full space-y-4">
                        <h3 className="text-xl font-black text-white italic tracking-tighter uppercase flex items-center gap-3">
                            <TerminalSquare className="text-indigo-400" size={24}/> Session Artifacts
                        </h3>
                        <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-12 bg-indigo-500/5 blur-3xl rounded-full"></div>
                            <div className="relative z-10 space-y-6">
                                <div className="flex flex-col md:flex-row items-center gap-6">
                                    <div className="p-5 bg-indigo-600 text-white rounded-3xl shadow-2xl"><LayoutPanelTop size={40}/></div>
                                    <div className="flex-1 text-center md:text-left">
                                        <h4 className="text-lg font-bold text-white mb-1">Neural Workspace Snapshot</h4>
                                        <p className="text-sm text-slate-500">All code, architecture diagrams, and technical specifications generated during this interview.</p>
                                    </div>
                                    <button 
                                        onClick={() => window.open(`${window.location.origin}${window.location.pathname}?view=code_studio&id=${activeRecording?.id || currentSessionId}`, '_blank')}
                                        className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black uppercase tracking-widest border border-slate-700 flex items-center gap-2 transition-all active:scale-95"
                                    >
                                        <ExternalLink size={16}/>
                                        Launch Builder Studio
                                    </button>
                                </div>
                                
                                {loadingProject ? (
                                    <div className="flex items-center justify-center py-4 text-slate-600 gap-2">
                                        <Loader2 size={16} className="animate-spin"/>
                                        <span className="text-[10px] font-bold uppercase tracking-widest">Hydrating File Index...</span>
                                    </div>
                                ) : sessionProject?.files && sessionProject.files.length > 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-slate-800">
                                        {sessionProject.files.map((file, fIdx) => (
                                            <div key={fIdx} className="flex items-center gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800 group/file hover:border-indigo-500/30 transition-all">
                                                <div className="p-1.5 bg-slate-900 rounded-lg text-indigo-400"><Code2 size={14}/></div>
                                                <span className="text-xs font-mono text-slate-400 group-hover/file:text-indigo-200 transition-colors truncate flex-1">{file.name}</span>
                                                <button 
                                                    onClick={() => window.open(`${window.location.origin}${window.location.pathname}?view=code_studio&id=${activeRecording?.id || currentSessionId}`, '_blank')}
                                                    className="p-1.5 opacity-0 group-hover/file:opacity-100 transition-opacity text-slate-500 hover:text-white"
                                                >
                                                    <Eye size={14}/>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-center text-slate-600 text-xs italic py-4">No code artifacts were persisted during this session.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {report.optimizedStarStories && report.optimizedStarStories.length > 0 && (
                        <div className="w-full space-y-6">
                            <h3 className="text-xl font-black text-white italic tracking-tighter uppercase flex items-center gap-3">
                                <Award className="text-amber-500" size={24}/> Neural STAR Refinement
                            </h3>
                            <div className="grid grid-cols-1 gap-6">
                                {report.optimizedStarStories.map((story, idx) => (
                                    <div key={idx} className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-xl space-y-6 relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-12 bg-indigo-500/5 blur-3xl rounded-full"></div>
                                        <div className="relative z-10">
                                            <h4 className="text-lg font-bold text-indigo-300 mb-6 flex items-center gap-2">
                                                <span className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-black">{idx + 1}</span>
                                                {story.title}
                                            </h4>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="space-y-4">
                                                    <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800">
                                                        <span className="text-[10px] font-black text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded uppercase tracking-widest mb-2 inline-block">Situation</span>
                                                        <p className="text-xs text-slate-300 leading-relaxed">{story.situation}</p>
                                                    </div>
                                                    <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800">
                                                        <span className="text-[10px] font-black text-indigo-400 bg-indigo-950/50 px-2 py-0.5 rounded uppercase tracking-widest mb-2 inline-block">Task</span>
                                                        <p className="text-xs text-slate-300 leading-relaxed">{story.task}</p>
                                                    </div>
                                                </div>
                                                <div className="space-y-4">
                                                    <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800">
                                                        <span className="text-[10px] font-black text-purple-400 bg-purple-950/50 px-2 py-0.5 rounded uppercase tracking-widest mb-2 inline-block">Action</span>
                                                        <p className="text-xs text-slate-300 leading-relaxed">{story.action}</p>
                                                    </div>
                                                    <div className="bg-slate-950/50 p-4 rounded-2xl border border-slate-800">
                                                        <span className="text-[10px] font-black text-amber-400 bg-purple-950/50 px-2 py-0.5 rounded uppercase tracking-widest mb-2 inline-block">Result</span>
                                                        <p className="text-xs text-slate-300 leading-relaxed font-bold">{story.result}</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="mt-6 p-4 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl flex items-start gap-3">
                                                <Lightbulb className="text-indigo-400 shrink-0 mt-0.5" size={18}/>
                                                <div>
                                                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Coach's Optimization</p>
                                                    <p className="text-xs text-slate-400 italic leading-relaxed">{story.coachTip}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full text-left">
                        <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800"><h4 className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Trophy size={14}/> Key Strengths</h4><ul className="space-y-2">{report.strengths.map((s, i) => (<li key={i} className="text-xs text-slate-300 flex items-start gap-2"><CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5"/> {s}</li>))}</ul></div>
                        <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800"><h4 className="text-xs font-black text-amber-400 uppercase tracking-widest mb-4 flex items-center gap-2"><AlertCircle size={14}/> Growth Areas</h4><ul className="space-y-2">{report.areasForImprovement.map((s, i) => (<li key={i} className="text-xs text-slate-300 flex items-start gap-2"><Minus size={14} className="text-amber-500 shrink-0 mt-0.5"/> {s}</li>))}</ul></div>
                    </div>
                    <div className="text-left w-full bg-slate-950 p-8 rounded-[2rem] border border-slate-800"><h3 className="font-bold text-white mb-4 flex items-center gap-2"><BookOpen className="text-indigo-400" size={18}/> Learning Path</h3><div className="prose prose-invert prose-sm max-w-none"><MarkdownView content={report.learningMaterial} /></div></div>
                    <button onClick={() => { setView('hub'); loadInterviews(); }} className="px-10 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all">Return to Hub</button>
                </div>
              ) : <Loader2 size={32} className="animate-spin text-indigo-400" />}
            </div>
          </div>
        )}

        {view === 'coaching' && (
            <div className="h-full flex flex-col md:flex-row overflow-hidden bg-slate-950 relative">
                <div className="w-full md:w-1/3 bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden shrink-0">
                    <div className="p-6 border-b border-slate-800 bg-slate-950/50">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em]">Evaluation Reference</h3>
                            <div className="flex items-center gap-3">
                                {isCoachingSyncing && (
                                    <div className="flex items-center gap-1 text-[8px] font-black text-emerald-400 uppercase animate-pulse">
                                        <Cloud size={10}/> Syncing...
                                    </div>
                                )}
                                <button onClick={() => setShowCoachingDiagnostics(!showCoachingDiagnostics)} className={`p-1.5 rounded transition-all ${showCoachingDiagnostics ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`} title="Handshake Logs">
                                    <Terminal size={14}/>
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 mb-6"><div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-sm">{report?.score}</div><div><p className="text-xs font-bold text-white uppercase">{report?.verdict}</p><p className="text-[10px] text-slate-500">Discussion Context</p></div></div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
                        <section><h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2"><Sparkles size={12}/> Summary</h4><p className="text-xs text-slate-400 leading-relaxed italic">"{report?.summary}"</p></section>
                        <section><h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Trophy size={12}/> Strengths</h4><ul className="space-y-1.5">{report?.strengths.map((s, i) => (<li key={i} className="text-[10px] text-slate-300 flex items-start gap-2"><CheckCircle size={12} className="text-emerald-500 shrink-0 mt-0.5"/> {s}</li>))}</ul></section>
                        <section><h4 className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-3 flex items-center gap-2"><AlertCircle size={12}/> Growth</h4><ul className="space-y-1.5">{report?.areasForImprovement.map((s, i) => (<li key={i} className="text-[10px] text-slate-300 flex items-start gap-2"><Minus size={12} className="text-amber-500 shrink-0 mt-0.5"/> {s}</li>))}</ul></section>
                    </div>
                </div>
                <div className="flex-1 flex flex-col overflow-hidden relative">
                    <div className="flex-1 bg-slate-950 flex flex-col overflow-hidden">
                        <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide">
                            {coachingTranscript.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                                    <div className="p-6 bg-indigo-600/10 rounded-full border border-indigo-500/20 text-indigo-400 animate-pulse"><Bot size={48} /></div>
                                    <div><h3 className="text-xl font-bold text-white uppercase tracking-tighter italic">AI Coaching Active</h3><p className="text-sm text-slate-500 max-w-xs mx-auto">Ask about your technical performance or growth path.</p></div>
                                </div>
                            )}
                            {coachingTranscript.map((item, index) => (
                                <div key={index} className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in-up`}>
                                    <span className={`text-[9px] uppercase font-black tracking-widest mb-1 ${item.role === 'user' ? 'text-indigo-400' : 'text-emerald-400'}`}>{item.role === 'user' ? 'You' : 'AI Coach'}</span>
                                    <div className={`max-w-[80%] px-5 py-3 rounded-2xl text-sm leading-relaxed ${item.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm shadow-xl' : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700 shadow-md'}`}><MarkdownView content={item.text} /></div>
                                </div>
                            ))}
                            {isAiThinking && <div className="flex flex-col items-start animate-fade-in"><span className="text-[9px] uppercase font-black tracking-widest mb-1 text-emerald-400">AI Coach Thinking...</span><div className="bg-slate-800 text-slate-200 rounded-2xl rounded-tl-sm p-4 border border-slate-700"><Loader2 className="animate-spin text-indigo-400" size={18} /></div></div>}
                        </div>
                        
                        <div className="p-4 border-t border-slate-800 bg-slate-900/80 backdrop-blur-sm">
                            <div className="h-[300px] mb-4 rounded-2xl overflow-hidden border border-slate-800 shadow-inner">
                                <CodeStudio 
                                    onBack={() => {}} currentUser={currentUser} userProfile={userProfile} onSessionStart={() => {}} onSessionStop={() => {}} onStartLiveSession={onStartLiveSession as any} 
                                    initialFiles={initialStudioFiles} isInterviewerMode={true} isAiThinking={isAiThinking}
                                    onFileChange={handleEditorFileChange}
                                />
                            </div>

                            <form className="flex items-center gap-3 max-w-4xl mx-auto" onSubmit={(e) => { e.preventDefault(); const form = e.target as HTMLFormElement; const input = form.elements.namedItem('message') as HTMLInputElement; if(input.value && input.value.trim()) { handleSendTextMessage(input.value); input.value = ''; } }}>
                                <div className="flex-1 flex items-center bg-slate-950 border border-slate-800 rounded-2xl px-4 shadow-inner group focus-within:border-indigo-500/50 transition-all">
                                    <button type="button" onClick={() => setShowCodePasteOverlay(true)} className="p-2 text-slate-500 hover:text-indigo-400 transition-colors" title="Paste Code Snippet"><Code size={20}/></button>
                                    <input name="message" type="text" className="flex-1 bg-transparent border-none py-4 text-sm text-white focus:ring-0 outline-none" placeholder="Discuss feedback or ask for a correct implementation..."/>
                                    <button type="button" onClick={() => handleSendTextMessage("Please review my current code in the editor.")} className="p-2 text-slate-500 hover:text-emerald-400 transition-colors" title="Scan Current Code"><Activity size={20}/></button>
                                </div>
                                <button type="submit" disabled={!isAiConnected} className="p-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:grayscale text-white rounded-2xl shadow-xl transition-all active:scale-95 flex items-center justify-center"><Send size={24}/></button>
                            </form>
                            
                            <div className="mt-4 flex justify-center items-center gap-6">
                                <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${isAiConnected ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-red-500'}`}></div><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Neural Link: {isAiConnected ? 'Active' : 'Offline'}</span></div>
                                <button onClick={() => handleReconnectAi(false)} className="text-[9px] font-black text-indigo-400 hover:text-white uppercase tracking-widest flex items-center gap-1.5"><RefreshCcw size={10}/> Reset Link</button>
                            </div>
                        </div>
                    </div>
                </div>

                {showCodePasteOverlay && (
                    <div className="absolute inset-0 z-[150] flex items-center justify-center p-8 bg-slate-950/80 backdrop-blur-md animate-fade-in">
                        <div className="bg-slate-900 border border-slate-700 rounded-[2.5rem] w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden animate-fade-in-up">
                            <div className="p-6 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg"><Code size={20}/></div>
                                    <div>
                                        <h3 className="text-sm font-bold text-white uppercase tracking-widest">Neural Code Injection</h3>
                                        <p className="text-[10px] text-slate-500 uppercase font-black">Paste code to share with your AI Coach</p>
                                    </div>
                                </div>
                                <button onClick={() => setShowCodePasteOverlay(false)} className="p-1 hover:bg-slate-800 rounded-full"><X size={24}/></button>
                            </div>
                            <div className="p-8 space-y-6">
                                <div className="flex gap-2">
                                    {['cpp', 'python', 'javascript', 'typescript', 'java'].map(l => (
                                        <button key={l} onClick={() => setPasteCodeLang(l)} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${pasteCodeLang === l ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>{l}</button>
                                    ))}
                                </div>
                                <textarea 
                                    value={pasteCodeBuffer}
                                    onChange={e => setPasteCodeBuffer(e.target.value)}
                                    className="w-full h-64 bg-slate-950 border border-slate-800 rounded-2xl p-6 text-sm font-mono text-indigo-300 outline-none focus:ring-2 focus:ring-indigo-500/30 resize-none shadow-inner leading-relaxed"
                                    placeholder="// Paste your logic here..."
                                />
                                <div className="flex gap-3">
                                    <button onClick={() => setShowCodePasteOverlay(false)} className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold text-xs uppercase tracking-widest transition-all">Cancel</button>
                                    <button onClick={handleCommitPastedCode} disabled={!pasteCodeBuffer.trim()} className="flex-[2] py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                                        <Send size={18}/>
                                        Inject into Conversation
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {showCoachingDiagnostics && (
                    <div className="absolute inset-0 z-[100] flex items-center justify-center p-8 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
                        <div className="bg-slate-900 border border-slate-700 rounded-[2rem] w-full max-w-2xl h-[500px] flex flex-col shadow-2xl overflow-hidden">
                            <div className="p-5 border-b border-slate-800 bg-slate-950/50 flex justify-between items-center">
                                <h3 className="text-sm font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2"><Activity size={16}/> Handshake Diagnostics</h3>
                                <button onClick={() => setShowCoachingDiagnostics(false)} className="p-1 hover:bg-slate-800 rounded-full"><X size={20}/></button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-6 space-y-2 font-mono text-[11px] scrollbar-hide bg-black/40">
                                {coachingLogs.length === 0 ? (
                                    <p className="text-slate-700 italic">No events logged in current handshake period.</p>
                                ) : (
                                    coachingLogs.map((log, i) => (
                                        <div key={i} className={`flex gap-3 leading-relaxed ${log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-amber-400' : 'text-slate-50'}`}>
                                            <span className="opacity-40 shrink-0 font-bold">[{log.time}]</span>
                                            <span className="break-words">
                                                {log.type === 'error' && <ShieldAlert size={12} className="inline mr-2 -mt-0.5"/>}
                                                {log.msg}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                            <div className="p-4 border-t border-slate-800 bg-slate-950/50 flex justify-between items-center">
                                <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Protocol: Gemini-Live-v1</span>
                                <button onClick={() => setCoachingLogs([])} className="text-[10px] font-black text-indigo-400 hover:text-white uppercase tracking-widest underline">Clear Buffer</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )}
      </main>

      {isGeneratingReport && (
        <div className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center gap-8">
            <div className="relative">
                <div className="w-32 h-32 border-4 border-indigo-500/10 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" style={{ clipPath: `conic-gradient(from 0deg, white ${synthesisPercent}%, transparent ${synthesisPercent}%)` }} />
                <Activity className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-400" size={40}/>
                <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-3xl font-black text-white">{Math.round(synthesisPercent)}%</div>
            </div>
            <div className="text-center space-y-2">
                <h3 className="text-xl font-black text-white uppercase tracking-widest">{synthesisStep}</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest opacity-60">Finalizing Verified Session Ledger</p>
            </div>
        </div>
      )}
    </div>
  );
};

function getLanguageFromExt(filename: string): string {
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
    return 'text';
}

export default MockInterview;