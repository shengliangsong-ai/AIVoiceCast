import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MockInterviewRecording, TranscriptItem, CodeFile, UserProfile, Channel, CodeProject, RecordingSession } from '../types';
import { auth } from '../services/firebaseConfig';
import { saveInterviewRecording, getPublicInterviews, deleteInterview, updateUserProfile, uploadFileToStorage, getUserInterviews, updateInterviewMetadata, saveCodeProject, getCodeProject, getUserProfile, saveRecordingReference } from '../services/firestoreService';
import { GeminiLiveService } from '../services/geminiLive';
import { GoogleGenAI, Type } from '@google/genai';
import { generateSecureId } from '../utils/idUtils';
import { CodeStudio } from './CodeStudio';
import { MarkdownView } from './MarkdownView';
import { Visualizer } from './Visualizer';
import { 
  ArrowLeft, Video, Mic, Monitor, Play, Save, Loader2, Search, Trash2, CheckCircle, X, 
  Download, ShieldCheck, User, Users, Building, FileText, ChevronRight, Zap, SidebarOpen, 
  SidebarClose, Code, MessageSquare, Sparkles, Languages, Clock, Camera, Bot, CloudUpload, 
  Trophy, BarChart3, ClipboardCheck, Star, Upload, FileUp, Linkedin, FileCheck, Edit3, 
  BookOpen, Lightbulb, Target, ListChecks, MessageCircleCode, GraduationCap, Lock, Globe, 
  ExternalLink, PlayCircle, RefreshCw, FileDown, Briefcase, Package, Code2, StopCircle, 
  Youtube, AlertCircle, Eye, EyeOff, SaveAll, Wifi, WifiOff, Activity, ShieldAlert, 
  Timer, FastForward, ClipboardList, Layers, Bug, Flag, Minus, Fingerprint, FileSearch, 
  RefreshCcw, HeartHandshake, Speech, Send, History, Compass, Square, CheckSquare, 
  Cloud, Award, Terminal, CodeSquare, Quote, ImageIcon, Sparkle, LayoutPanelTop, 
  TerminalSquare, FolderOpen, HardDrive, Shield, Database, Link as LinkIcon, UserCircle, 
  Calendar, Palette, Award as AwardIcon, CheckCircle2, AlertTriangle, TrendingUp, Presentation, Rocket, Flame, ShieldOff, RefreshCw as RefreshIcon
} from 'lucide-react';
import { getGlobalAudioContext, getGlobalMediaStreamDest, warmUpAudioContext, stopAllPlatformAudio } from '../utils/audioUtils';
import { getDriveToken, signInWithGoogle, connectGoogleDrive } from '../services/authService';
import { ensureFolder, uploadToDrive, downloadDriveFileAsBlob, deleteDriveFile, ensureCodeStudioFolder } from '../services/googleDriveService';

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
  description: "Read the current state of the workspace. ALWAYS use this before judging code or providing specific line-by-line feedback. This allows you to see the candidate's latest edits.",
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
  description: "Generate a new problem file in the workspace. This is the primary way to present technical challenges. You can create multiple files with the same prefix.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      filename: { type: Type.STRING, description: "Descriptive name (e.g. 'binary_tree_sum.cpp')." },
      content: { type: Type.STRING, description: "Initial file content (problem statement + template)." }
    },
    required: ["filename", "content"]
  }
};

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
    if (ext === 'rs') return 'rs';
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

const EvaluationReportDisplay = ({ report }: { report: MockInterviewReport }) => {
    if (!report) return null;

    return (
        <div className="w-full space-y-8 animate-fade-in-up">
            <div className="flex flex-wrap justify-center gap-6">
                <div className="px-10 py-6 bg-slate-900 rounded-[2rem] border border-indigo-500/30 shadow-2xl flex flex-col items-center min-w-[180px]">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Neural Score</p>
                    <p className="text-6xl font-black text-white italic tracking-tighter">{report.score}</p>
                    <div className="w-12 h-1 bg-indigo-500 mt-2 rounded-full"></div>
                </div>
                <div className="px-10 py-6 bg-slate-900 rounded-[2rem] border border-slate-800 shadow-2xl flex flex-col items-center min-w-[220px] justify-center">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">Verdict</p>
                    <div className={`px-6 py-2 rounded-xl border text-lg font-black uppercase tracking-tighter ${String(report.verdict).toLowerCase().includes('hire') ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-400' : 'bg-red-900/20 border-red-500/30 text-red-400'}`}>
                        {report.verdict}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] shadow-xl">
                    <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Code size={14}/> Technical Skills</h4>
                    <p className="text-sm text-slate-300 leading-relaxed italic">"{report.technicalSkills}"</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] shadow-xl">
                    <h4 className="text-[10px] font-black text-pink-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Presentation size={14}/> Communication</h4>
                    <p className="text-sm text-slate-300 leading-relaxed italic">"{report.communication}"</p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] shadow-xl">
                    <h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Users size={14}/> Collaboration</h4>
                    <p className="text-sm text-slate-300 leading-relaxed italic">"{report.collaboration}"</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-emerald-900/5 border border-emerald-500/20 p-8 rounded-[2.5rem] shadow-xl">
                    <h4 className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-6 flex items-center gap-2"><CheckCircle2 size={18}/> Key Strengths</h4>
                    <ul className="space-y-4">
                        {report.strengths?.map((s, i) => (
                            <li key={i} className="flex items-start gap-3 text-sm text-slate-200">
                                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></div>
                                <span>{s}</span>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="bg-amber-900/5 border border-amber-500/20 p-8 rounded-[2.5rem] shadow-xl">
                    <h4 className="text-xs font-black text-amber-400 uppercase tracking-widest mb-6 flex items-center gap-2"><TrendingUp size={18}/> Areas for Growth</h4>
                    <ul className="space-y-4">
                        {report.areasForImprovement?.map((a, i) => (
                            <li key={i} className="flex items-start gap-3 text-sm text-slate-200">
                                <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></div>
                                <span>{a}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {report.optimizedStarStories && report.optimizedStarStories.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-[3rem] shadow-2xl">
                    <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-6 flex items-center gap-2"><Star size={18}/> Optimized STAR Stories</h4>
                    <div className="grid grid-cols-1 gap-6">
                        {report.optimizedStarStories.map((story, i) => (
                            <div key={i} className="p-6 bg-slate-950 rounded-2xl border border-slate-800 relative group overflow-hidden">
                                <div className="absolute top-0 right-0 p-8 bg-indigo-500/5 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                <h5 className="font-bold text-white mb-4 text-lg">{story.title}</h5>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                                    <div className="space-y-1"><p className="text-[10px] font-black text-indigo-400 uppercase">Situation</p><p className="text-slate-300 leading-relaxed">{story.situation}</p></div>
                                    <div className="space-y-1"><p className="text-[10px] font-black text-indigo-400 uppercase">Task</p><p className="text-slate-300 leading-relaxed">{story.task}</p></div>
                                    <div className="space-y-1"><p className="text-[10px] font-black text-indigo-400 uppercase">Action</p><p className="text-slate-300 leading-relaxed">{story.action}</p></div>
                                    <div className="space-y-1"><p className="text-[10px] font-black text-indigo-400 uppercase">Result</p><p className="text-slate-300 leading-relaxed">{story.result}</p></div>
                                </div>
                                <div className="mt-6 p-4 bg-indigo-900/10 rounded-xl border border-indigo-500/20 flex gap-3 items-start">
                                    <Lightbulb size={16} className="text-amber-400 shrink-0 mt-0.5"/>
                                    <p className="text-[11px] text-indigo-200 leading-relaxed"><strong>Coach Tip:</strong> {story.coachTip}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-slate-900 border border-slate-800 p-8 rounded-[3rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 bg-indigo-500/5 blur-3xl rounded-full"></div>
                <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2 relative z-10"><MessageSquare size={16}/> Neural Synthesis Summary</h4>
                <p className="text-base text-slate-200 leading-relaxed relative z-10">{report.summary}</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-8 rounded-[3rem] shadow-2xl">
                <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-6 flex items-center gap-2"><BookOpen size={16}/> Personalized Growth Path</h4>
                <div className="prose prose-invert prose-indigo max-w-none prose-sm">
                    <MarkdownView content={report.learningMaterial} />
                </div>
            </div>
        </div>
    );
};

export const MockInterview: React.FC<MockInterviewProps> = ({ onBack, userProfile, onStartLiveSession }) => {
  const currentUser = auth?.currentUser;

  const [view, setView] = useState<'hub' | 'prep' | 'interview' | 'report' | 'artifact_viewer'>('hub');
  const [hubTab, setHubTab] = useState<'history' | 'explore'>('history');
  const [myInterviews, setMyInterviews] = useState<MockInterviewRecording[]>([]);
  const [publicInterviews, setPublicInterviews] = useState<MockInterviewRecording[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Tracks the active file path to avoid stale closures in Live API tool calls
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const activeFilePathRef = useRef<string | null>(null);

  const [isAiConnected, setIsAiConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [driveToken, setDriveToken] = useState<string | null>(getDriveToken());
  const [isUploadingRecording, setIsUploadingRecording] = useState(false);
  const [aiVolume, setAiVolume] = useState(0);

  const [timeLeft, setTimeLeft] = useState<number>(0); 
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const [showRetentionChoice, setShowRetentionChoice] = useState(false);

  const activeServiceIdRef = useRef<string | null>(null);
  const isEndingRef = useRef(false);
  const retryAttemptsRef = useRef(0);

  const [synthesisStep, setSynthesisStep] = useState<string>('');
  const [synthesisPercent, setSynthesisPercent] = useState(0);

  const [mode, setMode] = useState<'coding' | 'system_design' | 'behavioral'>('coding');
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [language, setLanguage] = useState(userProfile?.defaultLanguage || 'C++');
  const [jobDesc, setJobDesc] = useState('');
  const [interviewerLinkedin, setInterviewerLinkedin] = useState('');
  const [intervieweeLinkedin, setIntervieweeLinkedin] = useState('');
  const [resumeText, setResumeText] = useState(userProfile?.resumeText || '');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const transcriptRef = useRef<TranscriptItem[]>([]); 
  const [initialStudioFiles, setInitialStudioFiles] = useState<CodeFile[]>([]);

  const [activeRecording, setActiveRecording] = useState<MockInterviewRecording | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  
  const activeCodeFilesMapRef = useRef<Map<string, CodeFile>>(new Map());

  const [report, setReport] = useState<MockInterviewReport | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const liveServiceRef = useRef<GeminiLiveService | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const activeScreenStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
      if (view === 'interview' && localVideoRef.current && activeStreamRef.current) {
          localVideoRef.current.srcObject = activeStreamRef.current;
      }
  }, [view, isAiConnected]);

  const connectNeuralLink = useCallback(async (isRecovery = false) => {
    if (isEndingRef.current) return;
    
    if (isRecovery) {
        setIsReconnecting(true);
        if (liveServiceRef.current) {
            await liveServiceRef.current.disconnect();
        }
    }

    const service = new GeminiLiveService();
    activeServiceIdRef.current = service.id; 
    liveServiceRef.current = service;
    
    const uuid = currentSessionId;
    const historyText = transcriptRef.current.slice(-20).map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n');

    const sysPrompt = `
      Role: Senior Interviewer. 
      Mode: ${mode.toUpperCase()}. 
      Preferred Language: ${language}.
      Target Duration: ${durationMinutes} minutes. 
      Candidate: ${currentUser?.displayName}. 
      Session Directory Hash: ${uuid}.

      RESUME_TEXT: "${resumeText}". 
      CANDIDATE_LINKEDIN: "${intervieweeLinkedin}". 
      INTERVIEWER_LINKEDIN: "${interviewerLinkedin}". 
      TARGET_JOB_SPEC: "${jobDesc}".

      CRITICAL WORKFLOW:
      1. As soon as the session starts, use the 'create_interview_file' tool to generate a problem file if not already present.
      2. If this is a RECOVERY (Link restored), acknowledge it briefly via voice and continue the session seamlessly.
      3. All files MUST be created in the session directory using path: "drive://${uuid}/filename".
      4. Do NOT provide the solution. Provide a clear problem statement and a starting template.
      5. Greet the candidate via voice AND start the technical evaluation immediately after the greeting.
      6. MANDATORY: You MUST use 'get_current_code' frequently to track candidate progress. If you are reviewing code, you MUST use 'get_current_code' first.
      
      BEHAVIORAL RULE: If mode is behavioral, focus on voice dialogue and identifying 'STAR' stories.
      
      RECOVERY_CONTEXT:
      ${isRecovery ? `RECENT_CONVERSATION_HISTORY:\n${historyText}\n\nRECOVERY STATUS: ACTIVE. Resume from the last point above.` : 'INITIAL START'}
    `;

    try {
        await service.connect(mode === 'behavioral' ? 'Zephyr' : 'Software Interview Voice', sysPrompt, {
            onOpen: () => {
                setIsAiConnected(true);
                setIsReconnecting(false);
                retryAttemptsRef.current = 0;
                if (!isRecovery) {
                    service.sendText("Hello. The candidate is ready. Please initialize the workspace and begin the interview.");
                    if (timerRef.current) clearInterval(timerRef.current);
                    timerRef.current = setInterval(() => { setTimeLeft(prev => { if (prev <= 1) { handleEndInterview(); return 0; } return prev - 1; }); }, 1000);
                } else {
                    service.sendText("System link restored. I am back. Please acknowledge the recovery and continue our session.");
                }
            },
            onClose: () => { 
                if (activeServiceIdRef.current === service.id && !isEndingRef.current) {
                    setIsAiConnected(false);
                    if (retryAttemptsRef.current < 5) {
                        retryAttemptsRef.current++;
                        setTimeout(() => connectNeuralLink(true), 2000);
                    }
                }
            },
            onError: () => {
                if (activeServiceIdRef.current === service.id && !isEndingRef.current) {
                    setIsAiConnected(false);
                    setIsReconnecting(false);
                }
            },
            onVolumeUpdate: setAiVolume,
            onTranscript: (text, isUser) => {
                if (activeServiceIdRef.current !== service.id) return;
                if (!isUser) setIsAiThinking(false);
                const role = isUser ? 'user' : 'ai';
                setTranscript((prev: TranscriptItem[]) => {
                    if (prev.length > 0 && prev[prev.length - 1].role === role) return [...prev.slice(0, -1), { ...prev[prev.length - 1], text: prev[prev.length - 1].text + text }];
                    return [...prev, { role, text, timestamp: Date.now() }];
                });
            },
            onTurnComplete: () => {
                if (activeServiceIdRef.current === service.id) setIsAiThinking(false);
            },
            onToolCall: async (toolCall: any) => {
                for (const fc of toolCall.functionCalls) {
                    const args = fc.args as any;
                    if (fc.name === 'get_current_code') {
                        const allFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
                        const currentPath = activeFilePathRef.current;
                        
                        // Priority 1: Specific filename requested by AI
                        let targetFile = null;
                        if (args.filename) {
                            targetFile = allFiles.find(f => f.name === args.filename || f.path === args.filename || f.path.endsWith(args.filename));
                        }
                        
                        // Priority 2: Use currently focused file
                        if (!targetFile) {
                            targetFile = allFiles.find(f => f.path === currentPath);
                        }
                        
                        // Priority 3: Use first available file
                        if (!targetFile && allFiles.length > 0) {
                            targetFile = allFiles[0];
                        }

                        service.sendToolResponse([{ id: fc.id, name: fc.name, response: { 
                            result: targetFile?.content || "// No code content found in the requested file.",
                            filename: targetFile?.name || "unknown"
                        } }]);
                    } else if (fc.name === 'update_active_file') {
                        const allFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
                        const targetFile = allFiles.find(f => f.path === activeFilePathRef.current) || allFiles[0];
                        if (targetFile) {
                            const updated = { ...targetFile, content: args.new_content };
                            activeCodeFilesMapRef.current.set(updated.path, updated);
                            setInitialStudioFiles(prev => prev.map(f => f.path === updated.path ? updated : f));
                            service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Success: Updated ${targetFile.name}.` } }]);
                        }
                    } else if (fc.name === 'create_interview_file') {
                        const path = args.filename.startsWith('drive://') ? args.filename : `drive://${uuid}/${args.filename}`;
                        const newFile: CodeFile = { 
                            name: args.filename.split('/').pop() || args.filename, 
                            path, 
                            language: getLanguageFromExt(args.filename) as any, 
                            content: args.content, 
                            loaded: true, 
                            isDirectory: false, 
                            isModified: false 
                        };
                        activeCodeFilesMapRef.current.set(path, newFile);
                        setInitialStudioFiles(prev => [...prev.filter(f => f.path !== path), newFile]);
                        setActiveFilePath(path);
                        activeFilePathRef.current = path;
                        service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Success: '${args.filename}' created in session workspace.` } }]);
                    }
                }
            }
        }, [{ functionDeclarations: [getCodeTool, updateActiveFileTool, createInterviewFileTool] }]);
    } catch (e: any) {
        console.error("Neural link handshake failed", e);
        setIsReconnecting(false);
    }
  }, [currentSessionId, mode, language, durationMinutes, currentUser, resumeText, intervieweeLinkedin, interviewerLinkedin, jobDesc]);

  const handleStartInterview = async () => {
    if (!driveToken) return alert("Please connect to Google Drive first.");
    setIsStarting(true); 
    isEndingRef.current = false;
    retryAttemptsRef.current = 0;
    const uuid = generateSecureId();
    setCurrentSessionId(uuid);

    let camStream: MediaStream | null = null;
    let screenStream: MediaStream | null = null;
    try { screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always" } as any, audio: true }); } catch(e: any) {}
    try { camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); } catch(e: any) { alert("Camera/Mic mandatory."); setIsStarting(false); return; }

    const audioCtx = getGlobalAudioContext();
    await warmUpAudioContext(audioCtx);
    setTranscript([]); setReport(null); videoChunksRef.current = []; activeCodeFilesMapRef.current.clear();
    setTimeLeft(durationMinutes * 60);

    try {
      const recordingDest = getGlobalMediaStreamDest(); 
      const micSource = audioCtx.createMediaStreamSource(camStream);
      micSource.connect(recordingDest); 
      
      activeStreamRef.current = camStream; 
      activeScreenStreamRef.current = screenStream;

      const initialFilename = `READ_ME_FIRST.md`;
      const filesToInit: CodeFile[] = [{ 
          name: initialFilename, 
          path: `drive://${uuid}/${initialFilename}`, 
          language: 'markdown', 
          content: `# Session Active\n\nPlease wait while your interviewer sets up the workspace...`, 
          loaded: true, isDirectory: false, isModified: false 
      }];
      filesToInit.forEach(f => activeCodeFilesMapRef.current.set(f.path, f));
      setInitialStudioFiles(filesToInit);
      setActiveFilePath(filesToInit[0].path);
      activeFilePathRef.current = filesToInit[0].path;

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
          drawCtx.save();
          drawCtx.strokeStyle = '#6366f1'; drawCtx.lineWidth = 4;
          drawCtx.strokeRect(canvas.width - pipW - 24, canvas.height - realH - 24, pipW, realH);
          drawCtx.drawImage(camVideo, canvas.width - pipW - 24, canvas.height - realH - 24, pipW, realH);
          drawCtx.restore();
        }
        requestAnimationFrame(drawFrame);
      };
      drawFrame();

      const combinedStream = canvas.captureStream(30);
      recordingDest.stream.getAudioTracks().forEach(t => combinedStream.addTrack(t));
      
      const recorder = new MediaRecorder(combinedStream, { 
          mimeType: 'video/webm;codecs=vp8,opus', 
          videoBitsPerSecond: 2500000 
      });
      
      mediaRecorderRef.current = recorder;
      videoChunksRef.current = []; 
      recorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
      recorder.start(1000);

      await connectNeuralLink();
      setView('interview');
    } catch (e: any) { alert("Startup failed."); setView('hub'); } finally { setIsStarting(false); }
  };

  const handleEndInterview = async () => {
    if (isEndingRef.current) return;
    
    if (timerRef.current) clearInterval(timerRef.current);
    if (liveServiceRef.current) { liveServiceRef.current.disconnect(); setIsAiConnected(false); }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
    }
    if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach(t => t.stop());
    }
    if (activeScreenStreamRef.current) {
        activeScreenStreamRef.current.getTracks().forEach(t => t.stop());
    }

    setShowRetentionChoice(true);
  };

  const handleDiscardSession = () => {
      isEndingRef.current = false;
      setShowRetentionChoice(false);
      videoChunksRef.current = [];
      setTranscript([]);
      activeCodeFilesMapRef.current.clear();
      setView('hub');
  };

  const handlePreserveSession = async () => {
    isEndingRef.current = true;
    setIsEnding(true);
    setShowRetentionChoice(false);
    
    setIsGeneratingReport(true);
    setSynthesisStep('Freezing Neural State...');
    setSynthesisPercent(10);
    
    const interviewId = currentSessionId;
    const timestamp = Date.now();
    const recId = `interview-${timestamp}`;
    const channelTitle = `Mock Interview (${mode})`;
    const uuid = currentSessionId;

    try {
        const currentFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
        const latestTranscript = transcriptRef.current;
        
        const transcriptText = latestTranscript.map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n\n');
        const transcriptBlob = new Blob([transcriptText], { type: 'text/plain' });

        // Save all N files created during the interview to the project record
        await saveCodeProject({ 
            id: interviewId, 
            name: `Interview_${mode}_${new Date().toLocaleDateString()}`, 
            files: currentFiles, 
            lastModified: Date.now(), 
            accessLevel: 'restricted', 
            allowedUserIds: currentUser ? [currentUser.uid] : [] 
        });

        let reportData: MockInterviewReport | null = null;
        try {
            setSynthesisStep('Synthesizing Neural Feedback...');
            setSynthesisPercent(30);
            const historyText = latestTranscript.map(t => `${t.role.toUpperCase()}: ${t.text}`).join('\n');
            const codeText = currentFiles.map(f => `FILE: ${f.name}\nCONTENT:\n${f.content}`).join('\n\n');

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const prompt = `You are a Senior Bar Raiser at a top tier tech company. Provide a extremely detailed and fair evaluation of the candidate based on the interview transcript and code provided.
            
            INTERVIEW CONTEXT:
            Mode: ${mode.toUpperCase()}
            Candidate Profile: ${intervieweeLinkedin}
            Interviewer Profile: ${interviewerLinkedin}
            Target Job: ${jobDesc}
            
            RAW TRANSCRIPT:
            ${historyText}
            
            CANDIDATE WORKSPACE:
            ${codeText}
            
            EVALUATION GUIDELINES:
            1. Technical Skills: Assess correctness, complexity analysis, and edge cases.
            2. Communication: Assess how well they explained their thought process.
            3. Optimized STAR Stories: If behavioral, transform their answers into polished STAR format with coaching tips.
            
            Return ONLY a valid JSON object matching this schema precisely:
            { 
                "score": integer(0-100), 
                "technicalSkills": "summary string", 
                "communication": "summary string", 
                "collaboration": "summary string", 
                "strengths": ["string", "string"], 
                "areasForImprovement": ["string", "string"], 
                "verdict": "Strong Hire" | "Hire" | "No Hire" | "Strong No Hire", 
                "summary": "long text summary of overall performance", 
                "optimizedStarStories": [ { "title": "string", "situation": "string", "task": "string", "action": "string", "result": "string", "coachTip": "string" } ],
                "learningMaterial": "Markdown string containing a personalized growth plan based on their performance." 
            }`;

            const response = await ai.models.generateContent({ 
                model: 'gemini-3-flash-preview', 
                contents: prompt, 
                config: { 
                    responseMimeType: 'application/json',
                    thinkingConfig: { thinkingBudget: 0 }
                } 
            });
            
            const rawText = response.text || "";
            const cleanJson = rawText.replace(/^```json/i, '').replace(/```$/i, '').trim();
            reportData = JSON.parse(cleanJson) as MockInterviewReport;
        } catch (reportErr: any) {
            console.warn("AI Report synthesis failed, using fallback.", reportErr);
            reportData = {
                score: 0, technicalSkills: "Incomplete", communication: "Incomplete", collaboration: "Incomplete",
                strengths: ["Session ended"], areasForImprovement: ["Feedback synthesis interrupted"],
                verdict: "Reject", summary: "The AI was unable to synthesize a detailed report for this session, but the raw transcript and code have been preserved.",
                learningMaterial: "# Session Archive\nDetailed analysis failed."
            };
        }
        setReport(reportData);
        
        const recording: MockInterviewRecording = { 
            id: interviewId, 
            userId: currentUser?.uid || 'guest', 
            userName: currentUser?.displayName || 'Guest', 
            userPhoto: currentUser?.photoURL || undefined, 
            mode, 
            language, 
            jobDescription: jobDesc, 
            interviewerInfo: interviewerLinkedin, 
            intervieweeInfo: intervieweeLinkedin, 
            timestamp: Date.now(), 
            videoUrl: '', 
            transcript: latestTranscript, 
            feedback: JSON.stringify(reportData || {}), 
            visibility 
        };

        setSynthesisStep('Archiving Interview Assets...');
        setSynthesisPercent(60);
        
        await new Promise(resolve => setTimeout(resolve, 800));

        if (currentUser) {
            setSynthesisStep('Syncing to Cloud Ledger...');
            setSynthesisPercent(80);
            
            const token = getDriveToken();
            if (token && typeof token === 'string' && videoChunksRef.current.length > 0) {
                try {
                    const videoBlob = new Blob(videoChunksRef.current as BlobPart[], { type: 'video/webm' });
                    const folderId = await ensureCodeStudioFolder(token);
                    const interviewsFolderId = await ensureFolder(token, 'Interviews', folderId);
                    const driveVideoId = await uploadToDrive(token, interviewsFolderId, `Interview_${interviewId}.webm`, videoBlob);
                    const driveVideoUrl = `drive://${driveVideoId}`;
                    const tFileId = await uploadToDrive(token, folderId, `${recId}_transcript.txt`, transcriptBlob);
                    
                    await saveRecordingReference({
                        id: recId, userId: currentUser?.uid || 'guest', channelId: uuid, channelTitle, channelImage: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&q=80', timestamp, mediaUrl: driveVideoUrl, driveUrl: driveVideoUrl, mediaType: 'video/webm', transcriptUrl: `drive://${tFileId}`
                    });
                } catch(e: any) {
                    console.error("Video sync failed, saving metadata anyway.", e);
                }
            }
            await saveInterviewRecording(recording);
        }

        setSynthesisPercent(100);
        setSynthesisStep('Refraction Complete');
        setTimeout(() => { 
            setIsGeneratingReport(false); 
            setView('report'); 
        }, 800);

    } catch (e: any) { 
        console.error("Critical failure during end-session pipeline", e);
        setIsGeneratingReport(false); 
        setView('hub'); 
    } finally {
        setIsEnding(false);
    }
  };

  const handleSendTextMessage = (text: string) => {
    if (!text.trim() || !liveServiceRef.current) return;
    
    const allFiles = Array.from(activeCodeFilesMapRef.current.values()) as CodeFile[];
    const currentPath = activeFilePathRef.current;
    const currentFile = (allFiles.find(f => f.path === currentPath) || allFiles[0]) as CodeFile | undefined;
    
    // Construct text with explicit response request for Live API
    let messageToAi = `[USER_TEXT_PROMPT: Respond to this via voice] ${text}`;
    if (currentFile && currentFile.content.length > 0 && currentFile.content.length < 5000) {
        messageToAi = `[USER_TEXT_PROMPT: Respond to this via voice] ${text}\n\n[NEURAL_GROUNDING (File: ${currentFile.name})]:\n${currentFile.content}`;
    }

    setTranscript(prev => [...prev, { role: 'user', text, timestamp: Date.now() }]);
    setIsAiThinking(true);
    liveServiceRef.current.sendText(messageToAi);
  };

  const handleSyncCodeWithAi = (file: CodeFile) => {
    if (!liveServiceRef.current) return;
    setTranscript(prev => [...prev, { role: 'user', text: `*[System]: Synced code for ${file.name} to neural core.*`, timestamp: Date.now() }]);
    setIsAiThinking(true);
    liveServiceRef.current.sendText(`[USER_TEXT_PROMPT: Acknowledge code sync] The user has manually triggered a code sync. Current content of ${file.name}:\n\n\`\`\`\n${file.content}\n\`\`\``);
  };

  const loadInterviewsInternal = async () => {
    setLoading(true);
    try {
      const [publicData, userData] = await Promise.all([
        getPublicInterviews(),
        currentUser ? getUserInterviews(currentUser.uid) : Promise.resolve([])
      ]);
      setMyInterviews(userData);
      setPublicInterviews(publicData);
    } catch (e: any) {} finally { setLoading(false); }
  };

  useEffect(() => { loadInterviewsInternal(); }, [currentUser]);

  const parsedHistoricalReport = useMemo(() => {
    if (!activeRecording?.feedback) return null;
    try { return JSON.parse(activeRecording.feedback) as MockInterviewReport; } catch(e: any) { return null; }
  }, [activeRecording]);

  const toggleBulkDelete = (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelectedIds(next);
  };

  const handleBulkDelete = async () => {
      if (selectedIds.size === 0) return;
      if (!confirm(`Permanently delete ${selectedIds.size} evaluations?`)) return;
      setIsBulkDeleting(true);
      try {
          for (const id of Array.from(selectedIds)) {
              await deleteInterview(id);
          }
          setMyInterviews(prev => prev.filter(p => !selectedIds.has(p.id)));
          setSelectedIds(new Set());
      } finally { setIsBulkDeleting(false); }
  };

  return (
    <div className="h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden relative">
      <header className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 backdrop-blur-md shrink-0 z-40">
        <div className="flex items-center gap-4">
          <button onClick={() => view === 'hub' ? onBack() : setView('hub')} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><ArrowLeft size={20} /></button>
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><Video className="text-red-500" size={20} /> Mock Interview</h1>
        </div>
        {view === 'interview' && !showRetentionChoice && (
            <div className="flex items-center gap-3">
                <div className="px-4 py-1.5 rounded-2xl border border-indigo-500/30 text-indigo-400 bg-slate-950/50 flex items-center gap-2">
                    <Timer size={14}/>
                    <span className="font-mono text-base font-black tabular-nums">{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</span>
                </div>
                <button onClick={handleEndInterview} className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg active:scale-95">End Session</button>
            </div>
        )}
      </header>
      <main className="flex-1 overflow-hidden relative">
        {view === 'hub' && (
          <div className="max-w-6xl mx-auto p-8 space-y-12 animate-fade-in h-full overflow-y-auto scrollbar-hide">
            <div className="bg-indigo-600 rounded-[3rem] p-12 shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center gap-10">
                <div className="relative z-10 flex-1 space-y-6 text-center md:text-left">
                    <h2 className="text-5xl font-black text-white italic tracking-tighter uppercase leading-none">Validate your<br/>Potential.</h2>
                    <p className="text-indigo-100 text-lg max-w-md font-medium">Use high-intensity AI personas to audit your technical skills and behavioral readiness.</p>
                    <button onClick={() => setView('prep')} className="px-10 py-5 bg-white text-indigo-600 font-black uppercase tracking-widest rounded-2xl shadow-2xl hover:scale-105 transition-all flex items-center gap-3 mx-auto md:mx-0"><Zap size={20} fill="currentColor"/> Begin Preparation</button>
                </div>
                <div className="relative z-10 hidden lg:block"><Bot size={100} className="text-indigo-400 animate-pulse"/></div>
            </div>
            
            <div className="space-y-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800 w-fit shadow-lg">
                        <button onClick={() => setHubTab('history')} className={`px-6 py-2 rounded-xl text-xs font-black uppercase transition-all ${hubTab === 'history' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-50'}`}>History</button>
                        <button onClick={() => setHubTab('explore')} className={`px-6 py-2 rounded-xl text-xs font-black uppercase transition-all ${hubTab === 'explore' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-50'}`}>Explore</button>
                    </div>
                    {selectedIds.size > 0 && (
                        <button onClick={handleBulkDelete} className="flex items-center gap-2 px-4 py-2 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white rounded-xl text-xs font-bold transition-all border border-red-500/20">
                            <Trash2 size={14}/> Delete {selectedIds.size} Selected
                        </button>
                    )}
                </div>

                {loading ? <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-indigo-400" size={32}/></div> : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {(hubTab === 'history' ? myInterviews : publicInterviews).map(rec => {
                            const isSelected = selectedIds.has(rec.id);
                            return (
                            <div 
                                key={rec.id} 
                                onClick={() => { setActiveRecording(rec); setView('artifact_viewer'); }} 
                                className={`bg-slate-900 border ${isSelected ? 'border-red-500/50 bg-red-900/5' : 'border-slate-800'} rounded-3xl p-6 hover:border-indigo-500/50 transition-all cursor-pointer group shadow-xl relative`}
                            >
                                <button 
                                    onClick={(e) => { e.stopPropagation(); toggleBulkDelete(rec.id); }}
                                    className={`absolute top-4 left-4 p-1.5 rounded-lg border transition-all ${isSelected ? 'bg-red-600 border-red-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-500 opacity-0 group-hover:opacity-100'}`}
                                >
                                    <CheckCircle size={14}/>
                                </button>
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-12 h-12 rounded-2xl bg-indigo-950 flex items-center justify-center text-indigo-400 border border-indigo-500/20"><GraduationCap size={24} /></div>
                                    <div className="min-w-0 flex-1"><h3 className="font-bold text-white text-lg truncate uppercase tracking-tighter italic">{rec.mode.replace('_', ' ')}</h3><p className="text-[10px] text-slate-500 uppercase font-black">{new Date(rec.timestamp).toLocaleDateString()}</p></div>
                                </div>
                                <div className="pt-4 border-t border-slate-800 flex items-center justify-between"><span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-500">{rec.visibility || 'private'}</span><div className="flex items-center gap-1 text-indigo-400 text-xs font-bold group-hover:translate-x-1 transition-transform">View Evaluation <ChevronRight size={14}/></div></div>
                            </div>
                        )})}
                        {((hubTab === 'history' ? myInterviews : publicInterviews).length === 0) && (
                            <div className="col-span-full py-20 text-center text-slate-600 bg-slate-900/20 border-2 border-dashed border-slate-800 rounded-[2.5rem]">
                                <History size={48} className="mx-auto mb-4 opacity-10"/>
                                <p className="text-sm font-bold uppercase tracking-widest">No evaluation records found</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
          </div>
        )}

        {view === 'prep' && (
          <div className="max-w-4xl mx-auto p-8 animate-fade-in-up h-full overflow-y-auto scrollbar-hide">
            <div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-6">
                    <div className={`p-6 rounded-3xl border flex items-center justify-between ${driveToken ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-red-900/10 border-red-500/30'}`}>
                        <div className="flex items-center gap-3"><HardDrive className={driveToken ? 'text-emerald-400' : 'text-red-400'} size={24}/><div><p className="text-xs font-bold text-white uppercase">Cloud Handshake</p><p className="text-[10px] text-slate-500 uppercase font-black">{driveToken ? 'Authorized' : 'Required'}</p></div></div>
                        {!driveToken && <button onClick={() => connectGoogleDrive().then(setDriveToken)} className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase shadow-lg">Authorize</button>}
                    </div>
                    <div className="space-y-4">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-2 px-1">Evaluation Focus</label>
                        <div className="grid grid-cols-1 gap-2">
                            {[
                                { id: 'coding', label: 'Algorithms & Structures', icon: Code },
                                { id: 'system_design', label: 'Architecture & Scalability', icon: Layers },
                                { id: 'behavioral', label: 'STAR Story Analysis', icon: UserCircle }
                            ].map(m => (
                                <button key={m.id} onClick={() => setMode(m.id as any)} className={`p-4 rounded-2xl border text-left flex items-center justify-between transition-all ${m.id === mode ? 'bg-indigo-600 border-indigo-500 text-white shadow-xl' : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600'}`}>
                                    <div className="flex items-center gap-3">
                                        <m.icon size={18} className={m.id === mode ? 'text-white' : 'text-indigo-400'}/>
                                        <span className="text-[11px] font-black uppercase tracking-wider">{m.label}</span>
                                    </div>
                                    {m.id === mode && <CheckCircle size={16} fill="white" className="text-indigo-600"/>}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="space-y-6">
                    <div className="bg-slate-950 p-6 rounded-[2rem] border border-slate-800 space-y-4 shadow-inner">
                        <div><label className="text-[9px] font-black text-slate-500 uppercase block mb-2 px-1">Candidate Baseline</label><input type="url" value={intervieweeLinkedin} onChange={e => setIntervieweeLinkedin(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-indigo-200 outline-none focus:border-indigo-500" placeholder="LinkedIn Profile URL"/></div>
                        <div><label className="text-[9px] font-black text-slate-500 uppercase block mb-2 px-1">Interviewer Persona</label><input type="url" value={interviewerLinkedin} onChange={e => setInterviewerLinkedin(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white outline-none focus:border-indigo-500" placeholder="Interviewer LinkedIn URL"/></div>
                    </div>
                    <textarea value={jobDesc} onChange={e => setJobDesc(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 text-xs text-emerald-100 outline-none focus:border-emerald-500 resize-none h-40 shadow-inner" placeholder="Paste Target Job Description (Optional)..."/>
                </div>
              </div>
              <div className="pt-4">
                  <button onClick={handleStartInterview} disabled={isStarting || !driveToken} className="w-full py-6 bg-gradient-to-r from-red-600 to-indigo-600 text-white font-black uppercase tracking-[0.3em] rounded-3xl shadow-2xl transition-all active:scale-95 disabled:opacity-30 flex items-center justify-center gap-4">
                      {isStarting ? <Loader2 className="animate-spin" size={24} /> : <><Rocket size={24}/> <span>Refract Neural Interface</span></>}
                  </button>
                  <p className="text-[9px] text-slate-600 text-center uppercase font-black tracking-widest mt-4">Handshake will initiate WebSocket & Recording pipelines</p>
              </div>
            </div>
          </div>
        )}

        {view === 'interview' && (
          <div className="h-full w-full flex flex-col overflow-hidden relative">
            <div className="flex-1 bg-slate-950 relative flex overflow-hidden w-full h-full">
                <CodeStudio 
                    onBack={() => {}} 
                    currentUser={currentUser} 
                    userProfile={userProfile} 
                    onSessionStart={() => {}} 
                    onSessionStop={() => {}} 
                    onStartLiveSession={onStartLiveSession as any} 
                    initialFiles={initialStudioFiles} 
                    externalChatContent={transcript.map(t => ({ role: t.role, text: t.text }))} 
                    onSendExternalMessage={handleSendTextMessage} 
                    onSyncCodeWithAi={handleSyncCodeWithAi} 
                    isInterviewerMode={true} 
                    isAiThinking={isAiThinking} 
                    onFileChange={(f: CodeFile) => {
                        activeCodeFilesMapRef.current.set(f.path, f);
                        activeFilePathRef.current = f.path; // Update persistent pointer
                        setActiveFilePath(f.path); // Update UI state
                    }}
                />
            </div>
            
            <div className={`absolute bottom-24 left-6 w-64 aspect-video rounded-3xl overflow-hidden border-4 ${isAiConnected ? 'border-indigo-500/50 shadow-indigo-500/20' : 'border-red-500/50 animate-pulse'} shadow-2xl z-[100] bg-black group`}>
                <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover mirror" />
                <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${isAiConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
                            {isReconnecting ? 'Restoring Link...' : 'Neural Lens'}
                        </span>
                        {isAiConnected && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); connectNeuralLink(true); }} 
                                className="flex items-center gap-1 text-[8px] font-bold text-slate-400 hover:text-white transition-colors uppercase tracking-tighter"
                                title="Restart AI link if hanging"
                            >
                                <RefreshIcon size={8}/> Refresh Link
                            </button>
                        )}
                    </div>
                    <div className="w-24 h-4 rounded-lg bg-black/40 border border-white/10 overflow-hidden flex items-center px-1">
                        <Visualizer volume={aiVolume} isActive={isAiConnected} color="#818cf8"/>
                    </div>
                </div>
            </div>

            {/* Retention Choice Overlay */}
            {showRetentionChoice && (
                <div className="absolute inset-0 z-[150] bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-6 animate-fade-in">
                    <div className="max-w-xl w-full bg-slate-900 border border-slate-700 rounded-[3rem] p-10 shadow-2xl text-center space-y-8 animate-fade-in-up">
                        <div className="flex justify-center">
                            <div className="p-5 bg-indigo-600/10 rounded-[2rem] border border-indigo-500/30 text-indigo-400">
                                <ShieldCheck size={48}/>
                            </div>
                        </div>
                        <div>
                            <h2 className="text-3xl font-black text-white uppercase tracking-tighter italic">Neural Retention Policy</h2>
                            <p className="text-slate-400 mt-2 leading-relaxed">The technical evaluation has concluded. Choose how the Neural Core should handle the session artifacts.</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                            <button 
                                onClick={handleDiscardSession}
                                className="group flex flex-col items-center gap-4 p-6 bg-slate-950 border border-slate-800 rounded-[2rem] hover:border-red-500/50 transition-all text-left"
                            >
                                <div className="p-3 bg-red-950/30 rounded-xl text-red-400 group-hover:scale-110 transition-transform">
                                    <ShieldOff size={24}/>
                                </div>
                                <div className="text-center">
                                    <span className="block font-black text-white text-xs uppercase tracking-widest">Discard & Forget</span>
                                    <span className="text-[10px] text-slate-600 font-bold uppercase mt-1">INCINERATE LOGIC</span>
                                </div>
                            </button>

                            <button 
                                onClick={handlePreserveSession}
                                className="group flex flex-col items-center gap-4 p-6 bg-indigo-600 border border-indigo-400 rounded-[2rem] hover:bg-indigo-500 transition-all text-left shadow-xl shadow-indigo-900/40"
                            >
                                <div className="p-3 bg-white/20 rounded-xl text-white group-hover:scale-110 transition-transform">
                                    <Zap size={24}/>
                                </div>
                                <div className="text-center">
                                    <span className="block font-black text-white text-xs uppercase tracking-widest">Preserve & Analyze</span>
                                    <span className="text-[10px] text-indigo-100/60 font-bold uppercase mt-1">GENERATE REPORT</span>
                                </div>
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-600 font-black uppercase tracking-[0.2em]">Session ID: {currentSessionId.substring(0,8)}... Artifacts currently in ephemeral memory</p>
                    </div>
                </div>
            )}
          </div>
        )}

        {view === 'report' && report && (
          <div className="max-w-4xl mx-auto p-8 animate-fade-in-up space-y-12 pb-32 overflow-y-auto h-full scrollbar-hide">
            <div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 flex flex-col items-center text-center space-y-6 shadow-2xl">
              <div className="p-5 bg-amber-500/10 rounded-full border border-amber-500/30 text-amber-500 animate-bounce">
                <Trophy size={48}/>
              </div>
              <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">Refraction Complete</h2>
              <EvaluationReportDisplay report={report} />
            </div>
          </div>
        )}

        {view === 'artifact_viewer' && activeRecording && (
          <div className="h-full flex flex-col bg-slate-950 animate-fade-in overflow-y-auto p-8 space-y-12 scrollbar-hide">
                <div className="max-w-4xl mx-auto space-y-8">
                    <div className="bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-12 bg-indigo-500/10 blur-[100px] rounded-full"></div>
                        <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase relative z-10">{activeRecording.mode.replace('_', ' ')} Evaluation</h2>
                        <div className="flex items-center gap-6 text-sm text-slate-500 mt-2 relative z-10"><span className="flex items-center gap-2"><User size={16}/> @{activeRecording.userName}</span><span className="flex items-center gap-2"><Calendar size={16}/> {new Date(activeRecording.timestamp).toLocaleDateString()}</span></div>
                    </div>
                    {parsedHistoricalReport && <EvaluationReportDisplay report={parsedHistoricalReport} />}
                </div>
          </div>
        )}
      </main>

      {(isGeneratingReport || isUploadingRecording || isEnding) && (
        <div className="fixed inset-0 z-[200] bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center gap-8 animate-fade-in">
          <div className="relative">
            <div className="w-32 h-32 border-4 border-indigo-500/10 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
            <Activity className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-400" size={40}/>
            <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-3xl font-black text-white">{Math.round(synthesisPercent)}</div>
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-xl font-black text-white uppercase tracking-widest">{synthesisStep || (isUploadingRecording ? 'Archiving Video...' : 'Neural Synthesis...')}</h3>
            <p className="text-xs text-slate-500 uppercase font-bold tracking-tighter">Securing knowledge artifacts in personal cloud</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MockInterview;
