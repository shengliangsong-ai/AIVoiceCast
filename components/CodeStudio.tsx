
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CodeProject, CodeFile, UserProfile, Channel, CursorPosition, CloudItem, TranscriptItem } from '../types';
import { ArrowLeft, Save, Plus, Github, Cloud, HardDrive, Code, X, ChevronRight, ChevronDown, ChevronUp, File, Folder, DownloadCloud, Loader2, CheckCircle, AlertTriangle, Info, FolderPlus, FileCode, RefreshCw, LogIn, CloudUpload, Trash2, ArrowUp, Edit2, FolderOpen, MoreVertical, Send, MessageSquare, Bot, Mic, MicOff, Sparkles, SidebarClose, SidebarOpen, Users, Eye, FileText as FileTextIcon, Image as ImageIcon, StopCircle, Minus, Maximize2, Minimize2, Lock, Unlock, Share2, Terminal as TerminalIcon, Copy, WifiOff, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Monitor, Laptop, PenTool, Edit3, ShieldAlert, ZoomIn, ZoomOut, Columns, Rows, Grid2X2, Square as SquareIcon, GripVertical, GripHorizontal, FileSearch, Indent, Wand2, Check, Link, MousePointer2, Activity, Key, Search, FilePlus, FileUp, Play, Trash, ExternalLink, GraduationCap, ShieldCheck, Youtube, Video, Zap, Download, Headphones, Radio, Bug, TerminalSquare, MoveRight } from 'lucide-react';
import { listCloudDirectory, saveProjectToCloud, deleteCloudItem, createCloudFolder, subscribeToCodeProject, saveCodeProject, updateCodeFile, updateCursor, claimCodeProjectLock, updateProjectActiveFile, deleteCodeFile, updateProjectAccess, sendShareNotification, deleteCloudFolderRecursive } from '../services/firestoreService';
import { ensureCodeStudioFolder, ensureFolder, listDriveFiles, readDriveFile, saveToDrive, deleteDriveFile, createDriveFolder, DriveFile, moveDriveFile, shareFileWithEmail, getDriveFileSharingLink, downloadDriveFileAsBlob, getDriveFileStreamUrl, getDrivePreviewUrl, findFolder } from '../services/googleDriveService';
import { connectGoogleDrive, getDriveToken, signInWithGoogle, signInWithGitHub } from '../services/authService';
import { fetchRepoInfo, fetchRepoContents, fetchFileContent, updateRepoFile, fetchUserRepos, fetchRepoSubTree, deleteRepoFile, renameRepoFile } from '../services/githubService';
import { GeminiLiveService } from '../services/geminiLive';
import { MarkdownView } from './MarkdownView';
import { Whiteboard } from './Whiteboard';
import { ShareModal } from './ShareModal';
import { generateSecureId } from '../utils/idUtils';
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';
import Editor from '@monaco-editor/react';

interface TreeNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
  parentId?: string;
  data?: any;
  isLoaded?: boolean;
  status?: 'modified' | 'new' | 'deleted';
  size?: number;
}

interface SystemLog {
    id: string;
    time: string;
    message: string;
    type: 'info' | 'tool' | 'error' | 'success' | 'warn';
    details?: any;
}

type LayoutMode = 'single' | 'split-v' | 'split-h' | 'quad';
type IndentMode = 'tabs' | 'spaces';

interface CodeStudioProps {
  onBack: () => void;
  currentUser: any;
  userProfile: UserProfile | null;
  sessionId?: string;
  accessKey?: string;
  onSessionStart: (id: string) => void;
  onSessionStop: (id: string) => void;
  onStartLiveSession: (channel: Channel, context?: string) => void;
  initialFiles?: CodeFile[];
  externalChatContent?: { role: 'user' | 'ai', text: string }[];
  onSendExternalMessage?: (text: string) => void;
  isInterviewerMode?: boolean;
  isAiThinking?: boolean;
  onFileChange?: (file: CodeFile) => void;
  onSyncCodeWithAi?: (file: CodeFile) => void;
}

function getLanguageFromExt(filename: string): CodeFile['language'] {
    if (!filename) return 'text';
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'youtube' || filename.includes('youtube.com') || filename.includes('youtu.be')) return 'youtube';
    if (['mp4', 'mov', 'm4v', 'webm'].includes(ext || '')) return 'video';
    if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext || '')) return 'audio';
    if (ext === 'jsx') return 'javascript (react)';
    if (ext === 'tsx') return 'typescript (react)';
    if (ext === 'js') return 'javascript';
    if (ext === 'sh') return 'shell';
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

function formatSize(bytes?: number): string {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const CURSOR_COLORS = [
    '#f87171', '#fb923c', '#fbbf24', '#facc15', '#a3e635', 
    '#4ade80', '#34d399', '#2dd4bf', '#22d3ee', '#38bdf8', 
    '#60a5fa', '#818cf8', '#a78bfa', '#c084fc', '#e879f9', '#fb7185'
];

const FileIcon = ({ filename }: { filename: string }) => {
    if (!filename) return <File size={16} className="text-slate-500" />;
    const lang = getLanguageFromExt(filename);
    if (lang === 'youtube') return <Youtube size={16} className="text-red-500" />;
    if (lang === 'video') return <Video size={16} className="text-indigo-400" />;
    if (lang === 'audio') return <Headphones size={16} className="text-emerald-400" />;
    if (lang === 'javascript' || lang === 'typescript' || lang === 'javascript (react)' || lang === 'typescript (react)') return <FileCode size={16} className="text-yellow-400" />;
    if (lang === 'python') return <FileCode size={16} className="text-blue-400" />;
    if (lang === 'c++' || lang === 'c') return <FileCode size={16} className="text-indigo-400" />;
    if (lang === 'html') return <FileCode size={16} className="text-orange-400" />;
    if (lang === 'css') return <FileCode size={16} className="text-blue-300" />;
    if (lang === 'json') return <FileCode size={16} className="text-green-400" />;
    if (lang === 'markdown') return <FileTextIcon size={16} className="text-slate-400" />;
    if (lang === 'plantuml') return <ImageIcon size={16} className="text-pink-400" />;
    if (lang === 'whiteboard') return <PenTool size={16} className="text-pink-500" />;
    if (lang === 'pdf') return <FileTextIcon size={16} className="text-red-400" />;
    return <File size={16} className="text-slate-500" />;
};

const FileTreeItem = ({ node, depth, activeId, onSelect, onToggle, onDelete, onShare, onMove, expandedIds, loadingIds }: any) => {
    const isExpanded = expandedIds[node.id];
    const isLoading = loadingIds[node.id];
    const isActive = activeId === node.id;
    
    return (
        <div>
            <div 
                className={`flex items-center gap-1 py-1 px-2 cursor-pointer select-none hover:bg-slate-800/50 group ${isActive ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={() => onSelect(node)}
            >
                {node.type === 'folder' && (
                    <div onClick={(e) => { e.stopPropagation(); onToggle(node); }} className="p-0.5 hover:text-white">
                        {isLoading ? <Loader2 size={12} className="animate-spin text-indigo-400"/> : isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </div>
                )}
                {node.type === 'folder' ? (
                    isExpanded ? <FolderOpen size={16} className="text-indigo-400"/> : <Folder size={16} className="text-indigo-400"/>
                ) : (
                    <FileIcon filename={node.name} />
                )}
                <span className="text-xs truncate flex-1">{node.name}</span>
                {node.type === 'file' && node.size !== undefined && (
                    <span className="text-[9px] font-mono text-slate-600 group-hover:text-slate-400 mr-2">{formatSize(node.size)}</span>
                )}
                <div className="flex items-center gap-1">
                    {onMove && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onMove(node); }}
                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-700 rounded text-slate-400 hover:text-indigo-400 transition-all"
                            title="Move/Rename"
                        >
                            <MoveRight size={12}/>
                        </button>
                    )}
                    {node.type === 'file' && onShare && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onShare(node); }}
                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-700 rounded text-slate-400 hover:text-indigo-400 transition-all"
                            title="Share File"
                        >
                            <Share2 size={12}/>
                        </button>
                    )}
                    {onDelete && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onDelete(node); }}
                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-700 rounded text-slate-400 hover:text-red-400 transition-all"
                            title="Delete"
                        >
                            <Trash2 size={12}/>
                        </button>
                    )}
                </div>
            </div>
            {isExpanded && node.children && (
                <div>
                    {node.children.map((child: any) => (
                        <FileTreeItem 
                            key={child.id} 
                            node={child} 
                            depth={depth + 1} 
                            activeId={activeId} 
                            onSelect={child.type === 'folder' ? undefined : () => onSelect(child)} 
                            onToggle={onToggle}
                            onDelete={onDelete}
                            onShare={onShare}
                            onMove={onMove}
                            expandedIds={expandedIds}
                            loadingIds={loadingIds}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const RichCodeEditor = ({ code, onChange, onCursorMove, language, readOnly, fontSize, indentMode }: any) => {
    const monacoLang = useMemo(() => {
        const l = (language || 'text').toLowerCase();
        if (l.includes('c++')) return 'cpp';
        if (l.includes('react')) return l.includes('typescript') ? 'typescript' : 'javascript';
        return l;
    }, [language]);

    const handleEditorChange = (value: string | undefined) => {
        onChange(value || '');
    };

    const handleEditorDidMount = (editor: any) => {
        editor.onDidChangeCursorPosition((e: any) => {
            if (onCursorMove) {
                onCursorMove(e.position.lineNumber, e.position.column);
            }
        });
    };

    return (
        <div className="w-full h-full relative" style={{ letterSpacing: 'normal', textAlign: 'left' }}>
            <Editor
                height="100%"
                defaultLanguage={monacoLang}
                language={monacoLang}
                value={code}
                theme="vs-dark"
                onChange={handleEditorChange}
                onMount={handleEditorDidMount}
                options={{
                    fontSize: fontSize,
                    readOnly: readOnly,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    fixedOverflowWidgets: true,
                    padding: { top: 16, bottom: 16 },
                    tabSize: 4,
                    insertSpaces: indentMode === 'spaces',
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                    fontLigatures: true,
                    renderControlCharacters: true,
                    renderWhitespace: 'none',
                    cursorBlinking: 'smooth',
                    smoothScrolling: true,
                    lineHeight: fontSize * 1.5,
                    stopRenderingLineAfter: -1
                }}
            />
        </div>
    );
};

const AIChatPanel = ({ isOpen, onClose, messages, onSendMessage, isThinking, currentInput, onInputChange, isInterviewerMode, isLiveMode, onToggleLive }: any) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [showLocalPaste, setShowLocalPaste] = useState(false);
    const [pasteBuffer, setPasteBuffer] = useState('');
    const [pasteLang, setPasteLang] = useState('cpp');
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any>(null);
    
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isThinking]);

    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = true;
            recognitionRef.current.interimResults = true;
            recognitionRef.current.onresult = (event: any) => {
                let finalTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
                }
                if (finalTranscript) {
                    onInputChange((prev: string) => prev + ' ' + finalTranscript);
                }
            };
            recognitionRef.current.onend = () => setIsListening(false);
        }
    }, [onInputChange]);

    const toggleVoiceInput = () => {
        if (!recognitionRef.current) return alert("Speech recognition not supported.");
        if (isListening) {
            recognitionRef.current.stop();
        } else {
            recognitionRef.current.start();
            setIsListening(true);
        }
    };

    const handleLocalPaste = () => {
        if (!pasteBuffer.trim()) return;
        const wrapped = `\`\`\`${pasteLang}\n${pasteBuffer}\n\`\`\``;
        onSendMessage(wrapped);
        setPasteBuffer('');
        setShowLocalPaste(false);
    };

    return (
        <div className="flex flex-col h-full bg-slate-950 border-l border-slate-800 relative">
            <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900 shrink-0">
                <div className="flex items-center gap-3">
                    <span className="font-bold text-slate-300 text-sm flex items-center gap-2">
                        {isInterviewerMode ? (
                            <><GraduationCap size={16} className="text-red-500"/> AI Interviewer</>
                        ) : (
                            <><Bot size={16} className="text-indigo-400"/> AI Assistant</>
                        )}
                    </span>
                    {isLiveMode && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-red-900/30 text-red-400 rounded-full border border-red-500/20 text-[10px] font-black uppercase tracking-widest animate-pulse">
                            <Radio size={10} fill="currentColor"/> Live
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {!isInterviewerMode && (
                        <button 
                            onClick={onToggleLive} 
                            className={`p-1.5 rounded-lg transition-all ${isLiveMode ? 'bg-red-600 text-white shadow-lg' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}
                            title={isLiveMode ? "End Live Connection" : "Start Live Voice Link"}
                        >
                            {isLiveMode ? <MicOff size={16}/> : <Mic size={16}/>}
                        </button>
                    )}
                    <button onClick={onClose} title="Minimize AI Panel"><PanelRightClose size={16} className="text-slate-500 hover:text-white"/></button>
                </div>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-slate-600 text-center p-4">
                        {isInterviewerMode ? <ShieldCheck size={32} className="mb-2 opacity-20"/> : <Bot size={32} className="mb-2 opacity-20"/>}
                        <p className="text-xs font-bold uppercase tracking-widest">{isInterviewerMode ? 'Ready for evaluation' : 'Ready to help'}</p>
                    </div>
                )}
                {messages.map((m: any, i: number) => (
                    <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in-up`}>
                        <span className={`text-[9px] font-black uppercase mb-1 ${m.role === 'user' ? 'text-indigo-500' : 'text-slate-500'}`}>
                            {m.role === 'user' ? 'Me' : 'AI'}
                        </span>
                        <div className={`max-w-[95%] rounded-2xl p-3 text-sm leading-relaxed ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm shadow-lg' : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700'}`}>
                            {m.role === 'ai' || m.role === 'model' ? <MarkdownView content={m.text} /> : <p className="whitespace-pre-wrap">{m.text}</p>}
                        </div>
                    </div>
                ))}
                {isThinking && (
                    <div className="flex flex-col items-start animate-fade-in">
                        <span className="text-[9px] font-black uppercase mb-1 text-slate-500">AI Thinking...</span>
                        <div className="bg-slate-800/50 rounded-2xl p-3 border border-slate-700/50">
                            <Loader2 className="animate-spin text-indigo-400" size={16}/>
                        </div>
                    </div>
                )}
            </div>

            {showLocalPaste && (
                <div className="absolute bottom-[70px] left-3 right-3 bg-slate-900 border border-indigo-500/50 rounded-2xl p-4 shadow-2xl z-50 animate-fade-in-up">
                    <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Neural Paste Helper</span>
                        <button onClick={() => setShowLocalPaste(false)}><X size={14}/></button>
                    </div>
                    <div className="flex gap-1 mb-3">
                        {['cpp', 'python', 'js'].map(l => (
                            <button key={l} onClick={() => setPasteLang(l)} className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border transition-all ${pasteLang === l ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-950 border-slate-800 text-slate-50'}`}>{l}</button>
                        ))}
                    </div>
                    <textarea 
                        value={pasteBuffer}
                        onChange={e => setPasteBuffer(e.target.value)}
                        className="w-full h-32 bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-indigo-200 outline-none focus:border-indigo-500 resize-none mb-3"
                        placeholder="// Paste code to share..."
                    />
                    <button onClick={handleLocalPaste} disabled={!pasteBuffer.trim()} className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg active:scale-95 disabled:opacity-30 transition-all">Inject Block</button>
                </div>
            )}

            <div className="p-3 border-t border-slate-800 bg-slate-950">
                <form 
                    className="flex gap-2" 
                    onSubmit={(e) => { e.preventDefault(); if(currentInput.trim()) { onSendMessage(currentInput); onInputChange(''); } }}
                >
                    <div className="flex-1 flex items-center bg-slate-900 border border-slate-800 rounded-xl px-2 focus-within:border-indigo-500/50 transition-all shadow-inner">
                        <button type="button" onClick={() => setShowLocalPaste(true)} className="p-1.5 text-slate-500 hover:text-indigo-400 transition-colors" title="Paste Code Snippet"><Code size={18}/></button>
                        <input 
                            type="text" 
                            value={currentInput} 
                            onChange={e => onInputChange(e.target.value)} 
                            className="flex-1 bg-transparent border-none py-2.5 text-sm text-slate-300 focus:ring-0 placeholder-slate-600" 
                            placeholder={isLiveMode ? "AI is listening..." : isInterviewerMode ? "Reply to AI..." : "Ask AI to edit code..."} 
                        />
                        <button 
                            type="button" 
                            onClick={isLiveMode ? onToggleLive : toggleVoiceInput} 
                            className={`p-1.5 rounded-full transition-all ${isLiveMode || isListening ? 'text-red-500 bg-red-500/20 animate-pulse' : 'text-slate-500 hover:text-white'}`}
                            title={isLiveMode ? "End Live Session" : "Voice Input"}
                        >
                            {isLiveMode || isListening ? <MicOff size={18}/> : <Mic size={18}/>}
                        </button>
                    </div>
                    <button 
                        type="submit" 
                        disabled={!currentInput.trim() || isThinking}
                        className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all shadow-lg active:scale-95 disabled:opacity-50"
                    >
                        <Send size={18}/>
                    </button>
                </form>
            </div>
        </div>
    );
};

interface SlotProps {
    idx: number;
    activeSlots: (CodeFile | null)[];
    focusedSlot: number;
    setFocusedSlot: (idx: number) => void;
    slotViewModes: Record<number, 'code' | 'preview'>;
    toggleSlotViewMode: (idx: number) => void;
    isFormattingSlots: Record<number, boolean>;
    terminalOutputs: Record<number, string[]>;
    setTerminalOutputs: React.Dispatch<React.SetStateAction<Record<number, string[]>>>;
    isTerminalOpen: Record<number, boolean>;
    setIsTerminalOpen: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
    isRunning: Record<number, boolean>;
    layoutMode: LayoutMode;
    innerSplitRatio: number;
    handleRunCode: (idx: number) => void;
    handleFormatCode: (idx: number) => void;
    handleCodeChangeInSlot: (c: string, idx: number) => void;
    updateSlotFile: (f: CodeFile | null, idx: number) => void;
    onSyncCodeWithAi?: (file: CodeFile) => void;
    handleDownloadMedia: (file: CodeFile) => Promise<void>;
    fontSize: number;
    indentMode: IndentMode;
    isLive: boolean;
    lockStatus: string;
    broadcastCursor: (line: number, col: number) => void;
    isReadOnly?: boolean;
    isInterviewerMode?: boolean;
}

const Slot: React.FC<SlotProps> = ({ 
    idx, activeSlots, focusedSlot, setFocusedSlot, slotViewModes, toggleSlotViewMode,
    isFormattingSlots, terminalOutputs, setTerminalOutputs, isTerminalOpen, setIsTerminalOpen,
    isRunning, layoutMode, innerSplitRatio, handleRunCode, handleFormatCode,
    handleCodeChangeInSlot, updateSlotFile, onSyncCodeWithAi, handleDownloadMedia, fontSize, indentMode, isLive, lockStatus, broadcastCursor, isReadOnly = false, isInterviewerMode = false
}) => {
    const file = activeSlots[idx];
    const isFocused = focusedSlot === idx;
    const vMode = slotViewModes[idx] || 'code';
    const isFormatting = isFormattingSlots[idx];
    const terminalVisible = isTerminalOpen[idx];
    const output = terminalOutputs[idx] || [];
    const running = isRunning[idx];
    const [isDownloading, setIsDownloading] = useState(false);
    
    const isVisible = useMemo(() => {
        if (layoutMode === 'single') return idx === 0;
        if (layoutMode === 'quad') return true;
        return idx < 2; 
    }, [layoutMode, idx]);

    if (!isVisible) return null;
    
    const slotStyle: any = {};
    if (layoutMode === 'split-v' || layoutMode === 'split-h') {
        const size = idx === 0 ? `${innerSplitRatio}%` : `${100 - innerSplitRatio}%`;
        if (layoutMode === 'split-v') {
            slotStyle.width = size;
            slotStyle.flex = 'none';
        } else {
            slotStyle.height = size;
            slotStyle.flex = 'none';
        }
    } else if (layoutMode === 'single') {
        slotStyle.flex = '1';
        slotStyle.width = '100%';
    } else { // quad
        slotStyle.flex = '1';
    }

    const lang = file ? getLanguageFromExt(file.name) : 'text';
    const canRun = ['c++', 'c', 'python', 'javascript', 'typescript'].includes(lang);

    const getYouTubeId = (url: string) => {
        const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
        return match ? match[1] : null;
    };

    const isStreamUrl = file?.path && (file.path.startsWith('http') || file.path.includes('access_token='));

    const onMediaDownloadClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!file) return;
        setIsDownloading(true);
        try {
            await handleDownloadMedia(file);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div 
            onClick={() => setFocusedSlot(idx)} 
            style={slotStyle} 
            className={`flex flex-col min-w-0 border ${isFocused ? 'border-indigo-500 z-10' : 'border-slate-800'} relative bg-slate-950 overflow-hidden h-full`}
        >
            {file ? (
                <>
                  <div className={`px-4 py-2 flex items-center justify-between shrink-0 border-b ${isFocused ? 'bg-indigo-900/20 border-indigo-500/30' : 'bg-slate-900 border-slate-800'}`}>
                      <div className="flex items-center gap-2 overflow-hidden">
                          <FileIcon filename={file.name} />
                          <span className={`text-xs font-bold truncate ${isFocused ? 'text-indigo-200' : 'text-slate-400'}`}>{file.name}</span>
                          {isStreamUrl && (
                              <div className="hidden sm:flex items-center gap-1 text-[8px] font-black bg-indigo-900/40 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded-full uppercase tracking-widest pointer-events-none">
                                  <Zap size={8} fill="currentColor"/> Neural Stream
                              </div>
                          )}
                      </div>
                      <div className="flex items-center gap-1">
                          {isInterviewerMode && (
                              <button onClick={(e) => { e.stopPropagation(); onSyncCodeWithAi?.(file); }} className="p-1.5 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-white rounded flex items-center gap-1 text-[10px] font-black uppercase transition-all" title="Send current code to AI">
                                  <Send size={14}/>
                                  <span className="hidden md:inline">Sync AI</span>
                              </button>
                          )}
                          {canRun && (
                              <button onClick={(e) => { e.stopPropagation(); handleRunCode(idx); }} disabled={running} className={`p-1.5 rounded flex items-center gap-1 text-[10px] font-black uppercase transition-all ${running ? 'text-indigo-400' : 'text-emerald-400 hover:bg-emerald-600/10'}`} title="Compile & Run">
                                  {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                                  <span className="hidden md:inline">Run</span>
                              </button>
                          )}
                          {vMode === 'code' && !['markdown', 'pdf', 'whiteboard', 'youtube', 'video', 'audio'].includes(lang) && (
                              <button onClick={(e) => { e.stopPropagation(); handleFormatCode(idx); }} disabled={isFormatting} className={`p-1.5 rounded ${isFormatting ? 'text-indigo-400' : 'text-slate-500 hover:text-indigo-400'}`} title="AI Format"><Wand2 size={14}/></button>
                          )}
                          {['md', 'puml', 'plantuml', 'pdf', 'draw', 'whiteboard', 'wb', 'youtube', 'webm', 'mp4', 'mov', 'm4v', 'mp3', 'wav', 'm4a', 'ogg'].includes(file.name.split('.').pop()?.toLowerCase() || '') && <button onClick={(e) => { e.stopPropagation(); toggleSlotViewMode(idx); }} className={`p-1.5 rounded ${vMode === 'preview' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-white'}`}>{vMode === 'preview' ? <Code size={14}/> : <Eye size={14}/>}</button>}
                          <button onClick={(e) => { e.stopPropagation(); updateSlotFile(null, idx); }} className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-white"><X size={14}/></button>
                      </div>
                  </div>
                  <div className="flex-1 flex flex-col overflow-hidden">
                      <div className="flex-1 overflow-hidden relative">
                          {vMode === 'preview' ? (
                              lang === 'whiteboard' ? (
                                  <div className="w-full h-full">
                                      <Whiteboard driveId={file.driveId} initialContent={file.content} onChange={(c) => handleCodeChangeInSlot(c, idx)} isReadOnly={isReadOnly} />
                                  </div>
                              ) : lang === 'pdf' ? (
                                  <iframe 
                                      src={file.path} 
                                      className="w-full h-full border-none bg-white" 
                                      title="PDF Viewer" 
                                      sandbox="allow-scripts allow-same-origin"
                                  />
                              ) : lang === 'audio' ? (
                                  <div className="w-full h-full bg-slate-950 flex flex-col items-center justify-center p-8 space-y-6">
                                      <div className="w-24 h-24 bg-emerald-600/10 rounded-full flex items-center justify-center border border-emerald-500/20 text-emerald-400">
                                          <Headphones size={48} />
                                      </div>
                                      <audio 
                                          src={file.path} 
                                          controls 
                                          autoPlay 
                                          crossOrigin="anonymous"
                                          className="w-full max-w-md" 
                                      />
                                      <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Direct Audio Stream</p>
                                  </div>
                              ) : lang === 'video' ? (
                                  <div className="w-full h-full bg-black flex flex-col items-center justify-center relative p-6 text-center">
                                      <div className="w-16 h-16 bg-indigo-600/10 rounded-full flex items-center justify-center mb-4 border border-indigo-500/20 text-indigo-400">
                                          <Video size={32} />
                                      </div>
                                      <h3 className="text-white font-bold text-lg mb-2 uppercase tracking-tighter">Legacy Media Bridge</h3>
                                      <p className="text-slate-400 text-xs max-w-xs mb-8 leading-relaxed">
                                          Drive API security restricts direct streaming for this video format. To view this recording, download it to your local machine.
                                      </p>
                                      
                                      <button 
                                        onClick={onMediaDownloadClick}
                                        disabled={isDownloading}
                                        className="px-10 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-black uppercase tracking-widest flex items-center gap-3 transition-all active:scale-95 shadow-xl shadow-indigo-900/40 disabled:opacity-50"
                                      >
                                          {isDownloading ? <Loader2 size={18} className="animate-spin"/> : <Download size={18}/>}
                                          {isDownloading ? 'PULLING STREAM...' : 'Download & Play Local'}
                                      </button>

                                      <div className="mt-8 flex items-center gap-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                                          <Info size={12}/>
                                          Matches G-Drive Native Protocol
                                      </div>
                                  </div>
                              ) : lang === 'youtube' ? (
                                  <div className="w-full h-full bg-black flex items-center justify-center">
                                      <iframe 
                                          width="100%" height="100%" 
                                          src={`https://www.youtube.com/embed/${getYouTubeId(file.content || file.path)}`} 
                                          frameBorder="0" allowFullScreen title="YouTube Preview"
                                      />
                                  </div>
                              ) : (
                                  <div className="h-full overflow-y-auto p-8 scrollbar-hide">
                                      <MarkdownView content={file.content} />
                                  </div>
                              )
                          ) : (
                              lang === 'youtube' ? (
                                <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-500 bg-slate-900/50">
                                    <Youtube size={64} className="mb-4 text-red-500 opacity-50"/>
                                    <h3 className="text-lg font-bold text-white mb-2">YouTube View File</h3>
                                    <p className="text-sm max-w-xs mb-6">This is a media reference file. Click the Eye icon in the toolbar to play the video.</p>
                                    <button onClick={() => toggleSlotViewMode(idx)} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center gap-2">
                                        <Eye size={18}/> Preview & Play
                                    </button>
                                </div>
                              ) : lang === 'video' ? (
                                <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-500 bg-slate-900/50">
                                    <Video size={64} className="mb-4 text-indigo-500 opacity-50"/>
                                    <h3 className="text-lg font-bold text-white mb-2">Neural Recording</h3>
                                    <p className="text-sm max-w-xs mb-6">Recorded interview or session. Use the Eye icon to start playback.</p>
                                    <button onClick={() => toggleSlotViewMode(idx)} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center gap-2">
                                        <Eye size={18}/> Access Recording
                                    </button>
                                </div>
                              ) : lang === 'audio' ? (
                                <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-500 bg-slate-900/50">
                                    <Headphones size={64} className="mb-4 text-emerald-500 opacity-50"/>
                                    <h3 className="text-lg font-bold text-white mb-2">Audio Archive</h3>
                                    <p className="text-sm max-w-xs mb-6">Directly playable audio stream. Use the Eye icon to start playback.</p>
                                    <button onClick={() => toggleSlotViewMode(idx)} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center gap-2">
                                        <Eye size={18}/> Play Audio
                                    </button>
                                </div>
                              ) : (
                                <RichCodeEditor 
                                    code={file.content} 
                                    onChange={(c: string) => handleCodeChangeInSlot(c, idx)} 
                                    onCursorMove={broadcastCursor}
                                    language={file.language} 
                                    fontSize={fontSize} 
                                    indentMode={indentMode} 
                                    readOnly={isReadOnly || (isLive && lockStatus === 'busy')}
                                />
                              )
                          )}
                      </div>

                      {terminalVisible && (
                          <div className="h-1/3 bg-slate-950 border-t border-slate-800 flex flex-col animate-fade-in-up">
                              <div className="p-2 border-b border-slate-900 bg-slate-900/50 flex justify-between items-center shrink-0">
                                  <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest flex items-center gap-2"><TerminalIcon size={12}/> Output Console</span>
                                  <div className="flex items-center gap-1">
                                      <button onClick={() => setTerminalOutputs(prev => ({ ...prev, [idx]: [] }))} className="p-1 text-slate-500 hover:text-white" title="Clear Console"><Trash size={12}/></button>
                                      <button onClick={() => setIsTerminalOpen(prev => ({ ...prev, [idx]: false }))} className="p-1 text-slate-500 hover:text-white"><X size={12}/></button>
                                  </div>
                              </div>
                              <div className="flex-1 overflow-y-auto p-3 font-mono text-xs scrollbar-hide select-text">
                                  {output.map((line, lidx) => (
                                      <div key={lidx} className={`${line.includes('[ERROR]') ? 'text-red-400' : 'text-slate-300'} whitespace-pre-wrap leading-relaxed`}>
                                          {line}
                                      </div>
                                  ))}
                                  {running && <div className="text-indigo-400 animate-pulse mt-2">▋ Running process...</div>}
                              </div>
                          </div>
                      )}
                  </div>
                </>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-700 bg-slate-950/50 border-2 border-dashed border-slate-800 m-4 rounded-xl cursor-pointer hover:border-slate-600" onClick={() => {}}>
                    <Plus size={32} className="opacity-20 mb-2" /><p className="text-xs font-bold uppercase">Pane {idx + 1}</p>
                </div>
            )}
        </div>
    );
};

export const CodeStudio: React.FC<CodeStudioProps> = ({ 
  onBack, currentUser, userProfile, sessionId: propSessionId, accessKey, 
  onSessionStart, onSessionStop, onStartLiveSession, initialFiles,
  externalChatContent, onSendExternalMessage, isInterviewerMode = false,
  isAiThinking = false, onFileChange, onSyncCodeWithAi
}) => {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [githubLinkingError, setGithubLinkingError] = useState<string | null>(null);
  
  const defaultFile: CodeFile = {
      name: 'main.cpp',
      path: 'drive://welcome',
      language: 'c++',
      content: `#include <iostream>\n\nint main() {\n    std::cout << "Hello from AIVoiceCast Code Studio!" << std::endl;\n    return 0;\n}`,
      loaded: true,
      isDirectory: false,
      isModified: false
  };

  const clientId = useMemo(() => generateSecureId().substring(0, 8), []);
  const myColor = useMemo(() => CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)], []);

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('single');
  const [activeSlots, setActiveSlots] = useState<(CodeFile | null)[]>([null, null, null, null]);
  const [focusedSlot, setFocusedSlot] = useState<number>(0);
  const [slotViewModes, setSlotViewModes] = useState<Record<number, 'code' | 'preview'>>({ 0: 'code' });
  
  const internalFileContentRef = useRef<Map<string, string>>(new Map());
  const lastSessionIdRef = useRef<string | null>(null);
  const lastFilePathsRef = useRef<Set<string>>(new Set());

  const currentSessionIdFromPaths = useMemo(() => {
      const firstPath = initialFiles?.[0]?.path;
      if (firstPath?.startsWith('drive://')) {
          return firstPath.split('/')[2]; 
      }
      return null;
  }, [initialFiles]);

  const updateSlotsLRU = useCallback((file: CodeFile) => {
    const maxVisible = layoutMode === 'single' ? 1 : (layoutMode === 'quad' ? 4 : 2);
    
    // Determine the slot where this file should go
    const slotToUpdate = focusedSlot;

    setActiveSlots(prev => {
        const next = [...prev];
        next[slotToUpdate] = file;
        return next;
    });
    
    const lang = getLanguageFromExt(file.name);
    setSlotViewModes(prev => ({
        ...prev,
        [slotToUpdate]: ['markdown', 'plantuml', 'pdf', 'whiteboard', 'youtube', 'video', 'audio'].includes(lang) ? 'preview' : 'code'
    }));
  }, [layoutMode, focusedSlot]);

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
        const sid = currentSessionIdFromPaths;
        const isNewSession = sid !== lastSessionIdRef.current;

        if (isNewSession) {
            setActiveSlots([null, null, null, null]);
            internalFileContentRef.current.clear();
            lastFilePathsRef.current.clear();
            lastSessionIdRef.current = sid;
        }

        let highestPriorityFile: CodeFile | null = null;
        
        for (const file of initialFiles) {
            if (!lastFilePathsRef.current.has(file.path)) {
                highestPriorityFile = file;
                break;
            }
        }
        
        if (highestPriorityFile) {
            updateSlotsLRU(highestPriorityFile);
        } else {
            setActiveSlots(prev => prev.map((s) => {
                if (!s) return null;
                const match = initialFiles.find(f => f.path === s.path);
                if (match && match.content !== internalFileContentRef.current.get(match.path)) {
                    internalFileContentRef.current.set(match.path, match.content);
                    return { ...s, content: match.content, isModified: false };
                }
                return s;
            }));
        }

        lastFilePathsRef.current = new Set(initialFiles.map(f => f.path));
        initialFiles.forEach(f => {
            if (!internalFileContentRef.current.has(f.path) || internalFileContentRef.current.get(f.path) !== f.content) {
                internalFileContentRef.current.set(f.path, f.content);
            }
        });
    } else {
        const noFilesActive = activeSlots.every(s => s === null);
        if (noFilesActive) {
            setActiveSlots([defaultFile, null, null, null]);
            setSlotViewModes({ 0: 'code' });
        }
    }
  }, [initialFiles, currentSessionIdFromPaths, updateSlotsLRU]);

  const [innerSplitRatio, setInnerSplitRatio] = useState(50);
  const [isDraggingInner, setIsDraggingInner] = useState(false);
  
  const [project, setProject] = useState<CodeProject>({ id: 'init', name: 'My Workspace', files: [defaultFile], lastModified: Date.now() });
  const [activeTab, setActiveTab] = useState<'session' | 'drive' | 'cloud' | 'github'>(isInterviewerMode ? 'session' : 'drive');
  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const [isRightOpen, setIsRightOpen] = useState(true);
  
  const [terminalOutputs, setTerminalOutputs] = useState<Record<number, string[]>>({});
  const [isTerminalOpen, setIsTerminalOpen] = useState<Record<number, boolean>>({});
  const [isRunning, setIsRunning] = useState<Record<number, boolean>>({});

  const [chatMessages, setChatMessages] = useState<Array<{role: 'user' | 'ai', text: string}>>([{ role: 'ai', text: "Ready to code. Open a file from your **Google Drive** to begin." }]);
  const [githubSearchQuery, setGithubSearchQuery] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [isChatThinking, setIsChatThinking] = useState(false);
  const [isFormattingSlots, setIsFormattingSlots] = useState<Record<number, boolean>>({});
  const [isLiveChatActive, setIsLiveChatActive] = useState(false);
  const liveChatServiceRef = useRef<GeminiLiveService | null>(null);
  
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  const [cloudItems, setCloudItems] = useState<CloudItem[]>([]); 
  const [driveItems, setDriveItems] = useState<(DriveFile & { parentId?: string, isLoaded?: boolean })[]>([]); 
  const [driveRootId, setDriveRootId] = useState<string | null>(null);
  
  const [githubToken, setGithubToken] = useState<string | null>(localStorage.getItem('github_token'));
  const [githubRepos, setGithubRepos] = useState<any[]>([]);
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [githubTree, setGithubTree] = useState<TreeNode[]>([]);
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState('');

  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
  const [isExplorerLoading, setIsExplorerLoading] = useState(false);
  
  const [driveToken, setDriveToken] = useState<string | null>(getDriveToken());
  const [saveStatus, setSaveStatus] = useState<'saved' | 'modified' | 'saving'>('saved');
  const [fontSize, setFontSize] = useState(14);
  const [indentMode, setIndentMode] = useState<IndentMode>('spaces');
  const [leftWidth, setLeftWidth] = useState(260); 
  const [rightWidth, setRightWidth] = useState(320); 
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  // System Debug Logs
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [showSystemLogs, setShowSystemLogs] = useState(false);
  const [workingDirectory, setWorkingDirectory] = useState('/');

  const addSystemLog = useCallback((message: string, type: SystemLog['type'] = 'info', details?: any) => {
      const log: SystemLog = {
          id: generateSecureId(),
          time: new Date().toLocaleTimeString(),
          message,
          type,
          details
      };
      setSystemLogs(prev => [log, ...prev].slice(0, 100));
      console.debug(`[Neural Console] ${message}`, details || '');
  }, []);

  const centerContainerRef = useRef<HTMLDivElement>(null);
  const activeFile = activeSlots[focusedSlot];
  const blobUrlsRef = useRef<Set<string>>(new Set());

  const [isLive, setIsLive] = useState(false);
  const [lockStatus, setLockStatus] = useState<'free' | 'busy' | 'mine'>('free');

  const resolvePath = useCallback((target: string | undefined, currentCwd: string) => {
      if (!target) return currentCwd;
      if (target.startsWith('/')) return target;
      // Normalizing path joining
      const prefix = currentCwd === '/' ? '/' : (currentCwd.endsWith('/') ? currentCwd : currentCwd + '/');
      return prefix + target;
  }, []);

  const updateFileTool: FunctionDeclaration = {
    name: "update_active_file",
    description: "Updates the content of the currently focused file in the editor.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        new_content: { type: Type.STRING, description: "The complete new content of the file." },
        summary: { type: Type.STRING, description: "A brief summary of what you changed." }
      },
      required: ["new_content"]
    }
  };

  const createNewFileTool: FunctionDeclaration = {
    name: "create_new_file",
    description: "Creates a new file in the workspace and switches focus to it. Use this for starting new implementations or interview questions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filename: { type: Type.STRING, description: "The name of the file (e.g., 'solution.py' or 'algorithm.cpp')." },
        content: { type: Type.STRING, description: "The initial code content for the file." },
        directory_path: { type: Type.STRING, description: "Optional path for the file. Can be relative to CWD or absolute. Defaults to current working directory." }
      },
      required: ["filename", "content"]
    }
  };

  const createDirectoryTool: FunctionDeclaration = {
    name: "create_directory",
    description: "Creates a new directory in the workspace.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        directory_name: { type: Type.STRING, description: "The name of the new directory." },
        parent_path: { type: Type.STRING, description: "Optional path to the parent directory where this should be created." }
      },
      required: ["directory_name"]
    }
  };

  const setWorkingDirectoryTool: FunctionDeclaration = {
    name: "set_working_directory",
    description: "Sets the current working directory (CWD) for relative file operations like 'create_new_file' and 'list_directory'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "The path to set as current (e.g. '/kvstore')." }
      },
      required: ["path"]
    }
  };

  const listDirectoryTool: FunctionDeclaration = {
    name: "list_directory",
    description: "Lists all files and subdirectories in a specific path.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "The path to list contents from. If omitted, lists current working directory." }
      }
    }
  };

  const moveFileTool: FunctionDeclaration = {
    name: "move_file",
    description: "Moves or renames a file in the workspace.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        source_path: { type: Type.STRING, description: "The current path of the file." },
        destination_path: { type: Type.STRING, description: "The new path or name for the file." }
      },
      required: ["source_path", "destination_path"]
    }
  };

  const toggleSlotViewMode = (idx: number) => {
      setSlotViewModes(prev => ({
          ...prev,
          [idx]: prev[idx] === 'preview' ? 'code' : 'preview'
      }));
  };

  const handleSetLayout = (mode: LayoutMode) => {
      setLayoutMode(mode);
  };

  const handleConnectDrive = async () => {
      try {
          const token = await connectGoogleDrive();
          setDriveToken(token);
          await refreshExplorer();
      } catch(e) {
          console.error(e);
      }
  };

  const handleGithubLogin = async () => {
      setGithubLinkingError(null);
      try {
          const token = await signInWithGitHub();
          if (token) {
              setGithubToken(token);
              await refreshExplorer();
          }
      } catch (e: any) {
          console.error("GitHub Login Failed", e);
          if (e.code === 'auth/credential-already-in-use' || e.message?.includes('already bound')) {
              setGithubLinkingError(e.message);
              setShowManualToken(true);
          }
      }
  };

  const handleSetManualToken = () => {
      if (manualToken.trim()) {
          setGithubToken(manualToken.trim());
          localStorage.setItem('github_token', manualToken.trim());
          setShowManualToken(false);
          setGithubLinkingError(null);
          refreshExplorer();
      }
  };

  const handleAutoLoadDefaultRepo = async (token: string, repoFullName: string) => {
      const [owner, repo] = repoFullName.split('/');
      setIsGithubLoading(true);
      try {
          const info = await fetchRepoInfo(owner, repo, token);
          const { files } = await fetchRepoContents(token, owner, repo, info.default_branch);
          const tree: TreeNode[] = files.map(f => ({
              id: f.path || f.name,
              name: f.name.split('/').pop() || f.name,
              type: (f.isDirectory ? 'folder' : 'file') as 'file' | 'folder',
              isLoaded: f.childrenFetched,
              size: f.size,
              data: f
          }));
          setGithubTree(tree);
          setProject(prev => ({
              ...prev,
              github: { owner, repo, branch: info.default_branch, sha: '' }
          }));
      } catch (e: any) {
          alert("Failed to load repo: " + e.message);
      } finally {
          setIsGithubLoading(false);
      }
  };

  const handleSelectRepo = async (repo: any) => {
      if (!githubToken) return;
      setIsGithubLoading(true);
      try {
          const { files } = await fetchRepoContents(githubToken, repo.owner.login, repo.name, repo.default_branch);
          const tree: TreeNode[] = files.map(f => ({
              id: f.path || f.name,
              name: f.name.split('/').pop() || f.name,
              type: (f.isDirectory ? 'folder' : 'file') as 'file' | 'folder',
              isLoaded: f.childrenFetched,
              size: f.size,
              data: f
          }));
          setGithubTree(tree);
          setProject(prev => ({
              ...prev,
              github: { owner: repo.owner.login, repo: repo.name, branch: repo.default_branch, sha: '' }
          }));
      } catch (e: any) {
          alert("Failed to load repository tree: " + e.message);
      } finally {
          setIsGithubLoading(false);
      }
  };

  useEffect(() => {
    const pid = params.get('id');

    if (pid && pid !== 'init') {
        setIsLive(true);
        const unsubscribe = subscribeToCodeProject(pid, (updatedProject) => {
            setProject(updatedProject);
            if (updatedProject.activeClientId === clientId) setLockStatus('mine');
            else if (updatedProject.activeClientId) setLockStatus('busy');
            else setLockStatus('free');

            if (updatedProject.activeClientId !== clientId && updatedProject.activeFilePath) {
                const remoteFile = updatedProject.files.find(f => f.path === updatedProject.activeFilePath);
                if (remoteFile) {
                    setActiveSlots(prev => prev.map((s, i) => {
                        if (s?.path === remoteFile.path) return { ...s, content: remoteFile.content, isModified: false };
                        return s;
                    }));
                }
            }
        });
        return () => unsubscribe();
    }
  }, [clientId, params]);

  const broadcastCursor = useCallback((line: number, col: number) => {
      if (!isLive || project.id === 'init') return;
      updateCursor(project.id, {
          clientId, userId: currentUser?.uid || 'guest', userName: currentUser?.displayName || 'Guest',
          fileName: activeFile?.path || 'none', line, column: col, color: myColor, updatedAt: Date.now()
      });
  }, [isLive, project.id, activeFile?.path, clientId, currentUser, myColor]);

  const refreshExplorer = async () => {
      setIsExplorerLoading(true);
      try {
          if (activeTab === 'drive' && driveToken) {
              const rootId = driveRootId || await ensureCodeStudioFolder(driveToken);
              setDriveRootId(rootId);
              const files = await listDriveFiles(driveToken, rootId);
              setDriveItems([{ id: rootId, name: 'CodeStudio', mimeType: 'application/vnd.google-apps.folder', isLoaded: true }, ...files.map(f => ({ ...f, parentId: rootId, isLoaded: false }))]);
          } else if (activeTab === 'cloud' && currentUser) {
              const items = await listCloudDirectory(`projects/${currentUser.uid}`);
              setCloudItems(items);
          } else if (activeTab === 'github' && githubToken) {
              if (project.github && githubTree.length === 0) {
                   await handleAutoLoadDefaultRepo(githubToken, `${project.github.owner}/${project.github.repo}`);
              } else {
                  const repos = await fetchUserRepos(githubToken);
                  setGithubRepos(repos);
              }
          }
      } finally { setIsExplorerLoading(false); }
  };

  const handleSmartSave = async (targetFileOverride?: CodeFile) => {
    const fileToSave = targetFileOverride || activeFile;
    if (!fileToSave || (!fileToSave.isModified && saveStatus === 'saved')) return;
    setSaveStatus('saving');
    try {
        if (activeTab === 'drive' && driveToken && driveRootId) {
             const driveId = fileToSave.path?.startsWith('drive://') ? fileToSave.path.replace('drive://', '') : undefined;
             const validId = (driveId && driveId.length > 20 && !driveId.includes('blob:')) ? driveId : undefined;
             // Ensure we use parentId if it exists to keep folder hierarchy
             const folderId = fileToSave.parentId || driveRootId;
             await saveToDrive(driveToken, folderId, fileToSave.name, fileToSave.content, validId);
        } else if (activeTab === 'cloud' && currentUser) {
             await saveProjectToCloud(`projects/${currentUser.uid}`, fileToSave.name, fileToSave.content);
        } else if (activeTab === 'github' && githubToken && project.github) {
            const { owner, repo, branch } = project.github;
            const res = await updateRepoFile(githubToken, owner, repo, fileToSave.path || fileToSave.name, fileToSave.content, fileToSave.sha, `Update ${fileToSave.name}`, branch);
            fileToSave.sha = res.sha;
            fileToSave.isModified = false;
        }
        if (isLive && lockStatus === 'mine') await updateCodeFile(project.id, fileToSave);
        setSaveStatus('saved');
        // Auto-refresh sidebar after save completes
        await refreshExplorer();
    } catch(e: any) { 
        console.error("Save failed", e);
        setSaveStatus('modified'); 
    }
  };

  const handleShare = async () => {
      let projectId = project.id;
      if (projectId === 'init') {
          if (!currentUser) return alert("Please sign in to share projects.");
          setIsExplorerLoading(true);
          try {
              const filesToSave = activeSlots.filter(s => s !== null) as CodeFile[];
              const newId = generateSecureId();
              const newProject: CodeProject = { 
                  ...project, 
                  id: newId, 
                  files: filesToSave,
                  lastModified: Date.now(),
                  accessLevel: 'public'
              };
              projectId = await saveCodeProject(newProject);
              setProject(newProject);
              setIsLive(true);
              const url = new URL(window.location.href);
              url.searchParams.set('id', projectId);
              window.history.replaceState({}, '', url.toString());
          } catch(e) {
              alert("Failed to create shared project.");
              return;
          } finally {
              setIsExplorerLoading(false);
          }
      }
      setShareUrl(`${window.location.origin}${window.location.pathname}?view=code_studio&id=${projectId}`);
      setShowShareModal(true);
  };

  const handleUpdateAccess = async (uids: string[], isPublic: boolean, perm: 'read' | 'write') => {
      await updateProjectAccess(project.id, isPublic ? 'public' : 'restricted', uids);
  };

  const handleCreateNewFile = async (fileNameInput?: string, contentInput?: string, dirPathInput?: string) => {
      const fileName = fileNameInput || prompt("Enter filename (with extension):", "NewFile.ts");
      if (!fileName) return;

      // Resolve relative path against CWD
      let resolvedDirPath = resolvePath(dirPathInput, workingDirectory);
      if (resolvedDirPath.startsWith('/')) resolvedDirPath = resolvedDirPath.substring(1);

      addSystemLog(`AI/Manual Command: Create New File [${fileName}] in [${resolvedDirPath || 'Root'}]`, 'info');

      let parentDirId = driveRootId || undefined;
      let driveId: string | undefined = undefined;

      // IMMEDIATE PERSISTENCE (Optional but highly recommended for subdirs to avoid "empty kvstore" syndrome)
      if (activeTab === 'drive' && driveToken) {
          try {
              addSystemLog(`Resolving directory hierarchy for path: ${resolvedDirPath}`, 'info');
              parentDirId = await ensureFolder(driveToken, resolvedDirPath || '', driveRootId || undefined);
              addSystemLog(`Target directory resolved: ${parentDirId}`, 'success');
              
              // Physically create the file so it appears in explorer immediately
              driveId = await saveToDrive(driveToken, parentDirId, fileName, contentInput || "");
              addSystemLog(`File committed to Drive: ${driveId}`, 'success');
          } catch (e: any) {
              addSystemLog(`Folder resolution or creation failure: ${e.message}`, 'error');
              // Proceed with fake ID if drive fails so UI doesn't hang
              driveId = generateSecureId();
          }
      } else if (activeTab === 'cloud' && currentUser) {
          try {
              const cloudFolderPath = `projects/${currentUser.uid}${resolvedDirPath ? '/' + resolvedDirPath : ''}`;
              await saveProjectToCloud(cloudFolderPath, fileName, contentInput || "");
              addSystemLog(`File committed to Cloud.`, 'success');
          } catch(e: any) {
              addSystemLog(`Cloud write failed: ${e.message}`, 'error');
          }
      }

      const newPath = activeTab === 'drive' ? `drive://${driveId || generateSecureId()}` : 
                     activeTab === 'cloud' ? `projects/${currentUser?.uid}/${resolvedDirPath ? resolvedDirPath + '/' : ''}${fileName}` : 
                     fileName;

      const newFile: CodeFile = {
          name: fileName, 
          path: newPath,
          content: contentInput || "", 
          language: getLanguageFromExt(fileName), 
          loaded: true, 
          isDirectory: false, 
          isModified: false, // Mark as NOT modified since we just persisted it
          parentId: parentDirId,
          driveId: driveId
      };

      // Update the active project files immediately so sidebar 'session' view stays in sync
      setProject(prev => {
          const nextFiles = [...prev.files.filter(f => f.path !== newPath), newFile];
          return { ...prev, files: nextFiles, lastModified: Date.now() };
      });

      // Crucial: Update active slots state immediately to show the file
      setActiveSlots(prev => {
          const next = [...prev];
          next[focusedSlot] = newFile;
          return next;
      });
      
      setSaveStatus('saved');
      
      // If AI created the file during a live session, ensure it's pushed to cloud ledger too
      if (isLive && lockStatus === 'mine') {
          await updateCodeFile(project.id, newFile);
      }
      
      addSystemLog(`File [${fileName}] initialized in [${resolvedDirPath || 'Root'}].`, 'success');
      // Sidebar refresh to show the new node
      refreshExplorer();
  };

  const handleCreateDirectory = async (dirNameInput?: string, parentPath?: string) => {
    const dirName = dirNameInput || prompt("Enter directory name:", "new-folder");
    if (!dirName) return;

    // Resolve relative path against CWD
    let resolvedParentPath = resolvePath(parentPath, workingDirectory);
    if (resolvedParentPath.startsWith('/')) resolvedParentPath = resolvedParentPath.substring(1);

    addSystemLog(`AI/Manual Command: Create Directory [${dirName}] in [${resolvedParentPath || 'Root'}]`, 'info');
    setIsExplorerLoading(true);
    try {
      if (activeTab === 'drive' && driveToken) {
        const parentId = resolvedParentPath ? await findFolder(driveToken, resolvedParentPath, driveRootId || undefined) : (driveRootId || undefined);
        
        addSystemLog(`Checking for existing directory [${dirName}] in parent [${parentId || 'Root'}]...`, 'info');
        const existingId = await findFolder(driveToken, dirName, parentId || undefined);
        
        if (existingId) {
            addSystemLog(`Directory [${dirName}] already exists (ID: ${existingId}). skipping creation.`, 'warn');
        } else {
            await createDriveFolder(driveToken, dirName, parentId || undefined);
            addSystemLog(`Directory [${dirName}] created on Drive.`, 'success');
        }
      } else if (activeTab === 'cloud' && currentUser) {
        await createCloudFolder(`projects/${currentUser.uid}${resolvedParentPath ? '/' + resolvedParentPath : ''}`, dirName);
        addSystemLog(`Directory [${dirName}] created in Cloud.`, 'success');
      }
      await refreshExplorer();
    } catch (e: any) {
      addSystemLog(`Directory creation failed: ${e.message}`, 'error');
      alert("Failed to create directory: " + e.message);
    } finally {
      setIsExplorerLoading(false);
    }
  };

  const handleMoveExplorerItem = async (node: TreeNode) => {
      const destination = prompt(`Enter new path or filename for "${node.name}":`, node.id);
      if (!destination || destination === node.id) return;
      
      setIsExplorerLoading(true);
      addSystemLog(`Move/Rename initiated: [${node.id}] -> [${destination}]`, 'info');
      
      try {
          if (activeTab === 'drive' && driveToken) {
              // Path segments to resolve destination folder
              const parts = destination.split('/');
              const newName = parts.pop() || '';
              const newDirPath = parts.join('/');
              
              const newParentId = newDirPath ? await ensureFolder(driveToken, newDirPath, driveRootId || undefined) : (driveRootId || undefined);
              
              // Move file using Drive API
              if (node.type === 'file') {
                  // Drive ID is the node.id for files
                  const currentParentId = node.data?.parentId || driveRootId;
                  if (currentParentId && newParentId) {
                    await moveDriveFile(driveToken, node.id, currentParentId, newParentId);
                    addSystemLog(`Drive move successful.`, 'success');
                  }
              }
          } else if (activeTab === 'cloud' && currentUser) {
              // For cloud (Storage), move means copy + delete
              if (node.type === 'file' && node.data?.url) {
                  const contentRes = await fetch(node.data.url);
                  const content = await contentRes.text();
                  
                  const destParts = destination.split('/');
                  const newFileName = destParts.pop() || '';
                  const newPathPrefix = destParts.join('/');
                  
                  await saveProjectToCloud(newPathPrefix, newFileName, content);
                  await deleteCloudItem(node.id);
                  addSystemLog(`Cloud move (emulated) successful.`, 'success');
              }
          } else if (activeTab === 'github' && githubToken && project.github) {
              const { owner, repo, branch } = project.github;
              const content = await fetchFileContent(githubToken, owner, repo, node.id, branch);
              await renameRepoFile(githubToken, owner, repo, node.id, destination, content, node.data?.sha, branch);
              addSystemLog(`GitHub rename successful.`, 'success');
          }
          
          refreshExplorer();
      } catch (e: any) {
          addSystemLog(`Move failed: ${e.message}`, 'error');
          alert("Move failed: " + e.message);
      } finally {
          setIsExplorerLoading(false);
      }
  };

  const toggleFolder = async (node: TreeNode) => {
      const isExpanded = expandedIds[node.id];
      setExpandedIds(prev => ({ ...prev, [node.id]: !isExpanded }));
      
      if (!isExpanded && !node.isLoaded) {
          setLoadingIds(prev => ({ ...prev, [node.id]: true }));
          try {
              if (activeTab === 'drive' && driveToken) {
                  const files = await listDriveFiles(driveToken, node.id);
                  setDriveItems(prev => {
                      const next = prev.map(item => item.id === node.id ? { ...item, isLoaded: true } : item);
                      const filteredNext = next.filter(item => item.parentId !== node.id);
                      const newItems = files.map(f => ({ ...f, parentId: node.id, isLoaded: false }));
                      return [...filteredNext, ...newItems];
                  });
              } else if (activeTab === 'github' && project.github) {
                  const { owner, repo, branch } = project.github;
                  const children = await fetchRepoSubTree(githubToken, owner, repo, node.data.treeSha, node.id);
                  const childNodes: TreeNode[] = children.map(f => ({ id: f.path || f.name, name: f.name.split('/').pop() || f.name, type: (f.isDirectory ? 'folder' : 'file') as 'file' | 'folder', isLoaded: f.childrenFetched, size: f.size, data: f }));
                  setGithubTree(prev => {
                      const updateRecursive = (list: TreeNode[]): TreeNode[] => list.map(n => {
                          if (n.id === node.id) return { ...n, isLoaded: true, children: childNodes };
                          if (n.children) return { ...n, children: updateRecursive(n.children) };
                          return n;
                      });
                      return updateRecursive(prev);
                  });
              }
          } finally { setLoadingIds(prev => ({ ...prev, [node.id]: false })); }
      }
  };

  const getPathForNode = useCallback((nodeId: string, tree: TreeNode[]): string => {
    for (const node of tree) {
        if (node.id === nodeId) {
            return node.name === 'CodeStudio' ? '/' : `/${node.name}`;
        }
        if (node.children) {
            const childPath = getPathForNode(nodeId, node.children);
            if (childPath !== '/') {
                return node.name === 'CodeStudio' ? childPath : `/${node.name}${childPath}`;
            }
        }
    }
    return '/';
  }, []);

  const handleExplorerSelect = async (node: TreeNode) => {
      if (node.type === 'file') {
          let fileData: CodeFile | null = null;
          try {
              if (activeTab === 'drive' && driveToken) {
                  const isBinary = node.name.toLowerCase().endsWith('.pdf');
                  const isYouTube = node.name.toLowerCase().endsWith('.youtube');
                  const isWhiteboard = node.name.toLowerCase().endsWith('.draw') || node.name.toLowerCase().endsWith('.wb');
                  const mime = node.data?.mimeType || '';
                  const isAudioMime = mime.startsWith('audio/') || (mime === 'video/webm' && node.name.toLowerCase().includes('audio'));
                  const isDefaultVideoMime = mime.startsWith('video/') && !isAudioMime;
                  
                  if (isYouTube) {
                      const text = await readDriveFile(driveToken, node.id);
                      fileData = { name: node.name, path: `drive://${node.id}`, content: text, language: 'youtube', loaded: true, isDirectory: false, isModified: false, driveId: node.id, parentId: node.data?.parentId };
                  } else if (isBinary) {
                      const previewUrl = getDrivePreviewUrl(node.id);
                      fileData = { name: node.name, path: previewUrl, content: '[BINARY DOCUMENT]', language: 'pdf', size: node.data?.size ? parseInt(node.data.size) : undefined, loaded: true, isDirectory: false, isModified: false, driveId: node.id, parentId: node.data?.parentId };
                  } else if (isAudioMime) {
                      const streamUrl = getDriveFileStreamUrl(driveToken, node.id);
                      fileData = { name: node.name, path: streamUrl, content: '[AUDIO STREAM]', language: 'audio', size: node.data?.size ? parseInt(node.data.size) : undefined, loaded: true, isDirectory: false, isModified: false, driveId: node.id, parentId: node.data?.parentId };
                  } else if (isDefaultVideoMime) {
                      const streamUrl = getDriveFileStreamUrl(driveToken, node.id);
                      fileData = { name: node.name, path: streamUrl, content: '[VIDEO STREAM]', language: 'video', size: node.data?.size ? parseInt(node.data.size) : undefined, loaded: true, isDirectory: false, isModified: false, driveId: node.id, parentId: node.data?.parentId };
                  } else if (isWhiteboard) {
                      const text = await readDriveFile(driveToken, node.id);
                      fileData = { name: node.name, path: `drive://${node.id}`, content: text, language: 'whiteboard', loaded: true, isDirectory: false, isModified: false, driveId: node.id, parentId: node.data?.parentId };
                  } else {
                      const text = await readDriveFile(driveToken, node.id);
                      fileData = { name: node.name, path: `drive://${node.id}`, content: text, language: getLanguageFromExt(node.name), size: node.data?.size ? parseInt(node.data.size) : undefined, loaded: true, isDirectory: false, isModified: false, driveId: node.id, parentId: node.data?.parentId };
                  }
              } else if (activeTab === 'cloud' && node.data?.url) {
                  const ext = node.name.split('.').pop()?.toLowerCase();
                  const isWhiteboard = ext === 'draw' || ext === 'wb';
                  if (ext === 'pdf' || ['mp4', 'mov', 'm4v', 'webm', 'mp3', 'wav', 'm4a', 'ogg'].includes(ext || '')) {
                      fileData = { name: node.name, path: node.data.url, content: '[MEDIA DATA]', language: getLanguageFromExt(node.name), size: node.size, loaded: true, isDirectory: false, isModified: false };
                  } else if (isWhiteboard) {
                      const res = await fetch(node.data.url);
                      const text = await res.text();
                      fileData = { name: node.name, path: node.id, content: text, language: 'whiteboard', loaded: true, isDirectory: false, isModified: false };
                  } else {
                      const res = await fetch(node.data.url);
                      const text = await res.text();
                      fileData = { name: node.name, path: node.id, content: text, language: getLanguageFromExt(node.name), size: node.size, loaded: true, isDirectory: false, isModified: false };
                  }
              } else if (activeTab === 'github' && project.github) {
                  const { owner, repo, branch } = project.github;
                  const text = await fetchFileContent(githubToken, owner, repo, node.id, branch);
                  fileData = { name: node.name, path: node.id, content: text, language: getLanguageFromExt(node.name), size: node.size, loaded: true, isDirectory: false, isModified: false, sha: node.data?.sha };
              } else if (activeTab === 'session') {
                  const match = project.files.find(f => f.path === node.id);
                  if (match) fileData = match;
              }
              if (fileData) updateSlotFile(fileData, focusedSlot);
          } catch(e: any) { alert(e.message); }
      } else { 
          // Folder interaction: Toggle expansion AND update Working Directory
          toggleFolder(node); 
          
          let newDirPath = '/';
          if (activeTab === 'cloud') {
              const parts = node.id.split('/');
              if (parts.length > 2) {
                  newDirPath = '/' + parts.slice(2).join('/');
              }
          } else if (activeTab === 'drive') {
              newDirPath = getPathForNode(node.id, driveTree);
          }
          
          if (newDirPath !== workingDirectory) {
              setWorkingDirectory(newDirPath);
              addSystemLog(`User focused folder: ${newDirPath}. AI Working Directory (CWD) synchronized.`, 'info');
          }
      }
  };

  const handleDeleteExplorerItem = async (node: TreeNode) => {
    if (node.type === 'folder') {
        if (!confirm(`Are you sure you want to delete folder "${node.name}" and all its contents?`)) return;
        setIsExplorerLoading(true);
        try {
            if (activeTab === 'drive' && driveToken) await deleteDriveFile(driveToken, node.id);
            else if (activeTab === 'cloud') await deleteCloudFolderRecursive(node.id);
            refreshExplorer();
        } catch(e: any) { alert(e.message); }
        finally { setIsExplorerLoading(false); }
        return;
    }

    if (!confirm(`Permanently delete file "${node.name}"?`)) return;
    setIsExplorerLoading(true);
    try {
        if (activeTab === 'drive' && driveToken) {
            await deleteDriveFile(driveToken, node.id);
        } else if (activeTab === 'github' && githubToken && project.github) {
            const { owner, repo, branch } = project.github;
            await deleteRepoFile(githubToken, owner, repo, node.id, node.data.sha, `Delete ${node.name}`, branch);
        } else if (activeTab === 'cloud') {
            await deleteCloudItem(node.id);
        } else if (activeTab === 'session') {
            await deleteCodeFile(project.id, node.id);
        }
        
        setActiveSlots(prev => prev.map(s => s?.path === node.id ? null : s));
        refreshExplorer();
    } catch(e: any) {
        alert("Delete failed: " + e.message);
    } finally {
        setIsExplorerLoading(false);
    }
  };

  const updateSlotFile = async (file: CodeFile | null, slotIndex: number) => {
      if (file) {
          updateSlotsLRU(file);
          if (isLive && lockStatus === 'mine' && file.path) updateProjectActiveFile(project.id, file.path);
      } else {
          setActiveSlots(prev => prev.map((s, i) => i === slotIndex ? null : s));
      }
      
      if (file && onFileChange) onFileChange(file);
  };

  const handleCodeChangeInSlot = (newCode: string, slotIdx: number) => {
      const file = activeSlots[slotIdx];
      if (!file) return;
      const updatedFile = { ...file, content: newCode, isModified: true };
      const newSlots = [...activeSlots];
      newSlots[slotIdx] = updatedFile;
      setActiveSlots(newSlots);
      setSaveStatus('modified');
      
      internalFileContentRef.current.set(file.path, newCode);
      
      if (onFileChange) onFileChange(updatedFile);
      if (isLive && lockStatus === 'mine') updateCodeFile(project.id, updatedFile);
  };

  const handleDownloadMedia = async (file: CodeFile) => {
      if (!driveToken || !file.driveId) {
          alert("Drive authorization required for download.");
          return;
      }
      try {
          const blob = await downloadDriveFileAsBlob(driveToken, file.driveId);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          a.click();
          URL.revokeObjectURL(url);
      } catch (e) {
          alert("Download failed.");
      }
  };

  const handleRunCode = async (slotIdx: number) => {
      const file = activeSlots[slotIdx];
      if (!file) return;
      setIsRunning(prev => ({ ...prev, [slotIdx]: true }));
      setIsTerminalOpen(prev => ({ ...prev, [slotIdx]: true }));
      const updateTerminal = (msg: string, isError = false) => { setTerminalOutputs(prev => ({ ...prev, [slotIdx]: [...(prev[slotIdx] || []), `${isError ? '[ERROR] ' : ''}${msg}`] })); };
      updateTerminal(`>>> Starting Neural Execution: ${file.name}`);
      try {
          const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
          const prompt = `Act as a high-speed remote C++ / Multi-language execution engine. Execute: File: ${file.name}, Lang: ${file.language}, Code: ${file.content}. Respond ONLY with JSON: { "stdout": "string", "stderr": "string", "exitCode": number }`;
          
          const resp = await ai.models.generateContent({ 
              model: 'gemini-3-flash-preview', 
              contents: prompt, 
              config: { 
                  responseMimeType: 'application/json',
                  thinkingConfig: { thinkingBudget: 0 } 
              } 
          });
          
          const result = JSON.parse(resp.text || '{"stdout": "", "stderr": "Internal Error", "exitCode": 1}');
          if (result.stderr) updateTerminal(result.stderr, true);
          if (result.stdout) updateTerminal(result.stdout);
          updateTerminal(`\n[Process exited with code ${result.exitCode}]`);
      } catch (e: any) { updateTerminal(`Execution failed: ${e.message}`, true); } finally { setIsRunning(prev => ({ ...prev, [slotIdx]: false })); }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isChatThinking) return;
    
    if (isLiveChatActive && liveChatServiceRef.current) {
        liveChatServiceRef.current.sendText(text);
        setChatMessages(prev => [...prev, { role: 'user', text }]);
        return;
    }

    if (isInterviewerMode && onSendExternalMessage) {
        onSendExternalMessage(text);
        return;
    }

    setChatMessages(prev => [...prev, { role: 'user', text }]);
    setIsChatThinking(true);
    addSystemLog(`Inference Phase: Prototyping prompt...`, 'info');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const history = chatMessages.map(m => ({ role: (m.role === 'ai' ? 'model' : 'user') as 'model' | 'user', parts: [{ text: m.text }] }));
      
      const fileList = project.files.map(f => f.name).join(', ');
      let contextualMessage = text;
      if (activeFile) contextualMessage = `[CWD]: ${workingDirectory}\n[WORKSPACE_STRUCTURE]: All current files: [${fileList}]\n\nCONTEXT: Focused File "${activeFile.name}" content:\n\`\`\`${activeFile.language}\n${activeFile.content}\n\`\`\`\n\nUSER REQUEST: ${text}`;
      
      addSystemLog(`Neural Call: gemini-3-pro-preview`, 'tool', { promptLength: contextualMessage.length });

      const response = await ai.models.generateContent({ 
          model: 'gemini-3-pro-preview', 
          contents: [ ...history, { role: 'user', parts: [{ text: contextualMessage }] } ], 
          config: { 
              systemInstruction: "Expert pair programmer. You can modify files, create new ones, manage directories, and organize the workspace. Use 'set_working_directory' to move around. Your current working directory is " + workingDirectory, 
              tools: [{ functionDeclarations: [updateFileTool, createNewFileTool, createDirectoryTool, listDirectoryTool, moveFileTool, setWorkingDirectoryTool] }] 
          } 
      });

      if (response.functionCalls && response.functionCalls.length > 0) {
          // BATCH PROCESSING: Loop through ALL function calls
          let localCwd = workingDirectory;
          
          for (const fc of response.functionCalls) {
              addSystemLog(`AI selected Tool: [${fc.name}]`, 'tool', fc.args);
              
              try {
                  if (fc.name === 'update_active_file') {
                      const args = fc.args as any;
                      if (args.new_content) { 
                          handleCodeChangeInSlot(args.new_content, focusedSlot); 
                          setChatMessages(prev => [...prev, { role: 'ai', text: `✅ Updated focused file. ${args.summary || ''}` }]); 
                          if (onFileChange && activeSlots[focusedSlot]) {
                            onFileChange({ ...activeSlots[focusedSlot]!, content: args.new_content });
                          }
                          addSystemLog(`Injected code changes into slot ${focusedSlot}`, 'success');
                      }
                  } else if (fc.name === 'create_new_file') {
                      const args = fc.args as any;
                      // TRUST BUT VERIFY: Resolve path using our internal logic
                      await handleCreateNewFile(args.filename, args.content, args.directory_path);
                      setChatMessages(prev => [...prev, { role: 'ai', text: `🚀 Opened and implemented new file: **${args.filename}**` }]);
                  } else if (fc.name === 'set_working_directory') {
                      const args = fc.args as any;
                      localCwd = args.path;
                      setWorkingDirectory(args.path);
                      addSystemLog(`AI set CWD to: ${args.path}`, 'success');
                      setChatMessages(prev => [...prev, { role: 'ai', text: `📂 Working directory set to: \`${args.path}\`` }]);
                  } else if (fc.name === 'create_directory') {
                      const args = fc.args as any;
                      await handleCreateDirectory(args.directory_name, args.parent_path);
                      setChatMessages(prev => [...prev, { role: 'ai', text: `📁 Created directory: **${args.directory_name}**` }]);
                  } else if (fc.name === 'list_directory') {
                      const args = fc.args as any;
                      let items = [];
                      const targetPath = resolvePath(args.path, localCwd);
                      if (activeTab === 'drive' && driveToken) {
                          let cleanPath = targetPath;
                          if (cleanPath.startsWith('/')) cleanPath = cleanPath.substring(1);
                          const targetFolderId = await findFolder(driveToken, cleanPath, driveRootId || undefined);
                          items = targetFolderId ? await listDriveFiles(driveToken, targetFolderId) : [];
                      } else if (activeTab === 'cloud' && currentUser) {
                          items = await listCloudDirectory(`projects/${currentUser.uid}/${targetPath.startsWith('/') ? targetPath.substring(1) : targetPath}`);
                      }
                      setChatMessages(prev => [...prev, { role: 'ai', text: `📄 Directory contents for \`${targetPath}\`:\n${items.map(i => `- ${i.name} (${i.mimeType || (i as any).isFolder ? 'Folder' : 'File'})`).join('\n')}` }]);
                      addSystemLog(`Listed directory [${targetPath}] found ${items.length} items.`, 'success');
                  } else if (fc.name === 'move_file') {
                      const args = fc.args as any;
                      addSystemLog(`Moving [${args.source_path}] to [${args.destination_path}]`, 'info');
                      setChatMessages(prev => [...prev, { role: 'ai', text: `🛠️ Moved/Renamed: **${args.source_path}** to **${args.destination_path}**` }]);
                      await refreshExplorer();
                  }
              } catch (toolErr: any) {
                  addSystemLog(`Tool Execution Failed: ${toolErr.message}`, 'error');
                  setChatMessages(prev => [...prev, { role: 'ai', text: `❌ Failed to execute command: ${toolErr.message}` }]);
              }
          }
      } else { 
          setChatMessages(prev => [...prev, { role: 'ai', text: response.text || "No response." }]); 
      }
    } catch (e: any) { 
        addSystemLog(`Chat Logic Error: ${e.message}`, 'error');
        setChatMessages(prev => [...prev, { role: 'ai', text: "Error: " + e.message }]); 
    } finally { setIsChatThinking(false); }
  };

  const toggleLiveChat = async () => {
    if (isLiveChatActive) {
        liveChatServiceRef.current?.disconnect();
        liveChatServiceRef.current = null;
        setIsLiveChatActive(false);
        setChatMessages(prev => [...prev, { role: 'ai', text: "*[System]: Live connection terminated.*" }]);
        addSystemLog(`Live connection severed.`, 'info');
        return;
    }

    const fileList = project.files.map(f => f.name).join(', ');
    const sysInstruction = `You are a world-class pair-programming assistant. 
    You have direct access to the user's current code via tool calling.
    - [CWD]: ${workingDirectory}
    - [WORKSPACE_MAP]: Current files in root: [${fileList}].
    - When asked to write code, modify a file, or fix a bug in the CURRENT file, use 'update_active_file'.
    - When asked to start a NEW problem, solve an interview question, or 'open a new file', use 'create_new_file'.
    - You can manage directories with 'create_directory', 'list_directory', and 'move_file'.
    - Use 'set_working_directory' (CD) to change your context before creating files in subdirs.
    Always implement the solution fully and explain your thought process verbally.
    Keep your spoken responses concise and helpful.`;

    setIsLiveChatActive(true);
    addSystemLog(`Establishing Live Link...`, 'info');
    const service = new GeminiLiveService();
    liveChatServiceRef.current = service;

    try {
        await service.connect('Fenrir', sysInstruction, {
            onOpen: () => {
                setChatMessages(prev => [...prev, { role: 'ai', text: "*[System]: Live neural link established. I can hear your voice and see your workspace.*" }]);
                addSystemLog(`Live Neural Link established via gemini-2.5-flash-native-audio.`, 'success');
            },
            onClose: () => setIsLiveChatActive(false),
            onError: (err) => { 
                addSystemLog(`Live Link Error: ${err}`, 'error');
                alert(err); 
                setIsLiveChatActive(false); 
            },
            onVolumeUpdate: () => {},
            onTranscript: (text, isUser) => {
                const role = isUser ? 'user' : 'ai';
                setChatMessages(prev => {
                    if (prev.length > 0 && prev[prev.length - 1].role === role) {
                        const last = prev[prev.length - 1];
                        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                    }
                    return [...prev, { role, text, timestamp: Date.now() } as any];
                });
            },
            onToolCall: async (toolCall) => {
                let localCwd = workingDirectory;
                
                for (const fc of toolCall.functionCalls) {
                    addSystemLog(`Live AI Tool Call: [${fc.name}]`, 'tool', fc.args);
                    try {
                        if (fc.name === 'update_active_file') {
                            const { new_content, summary } = fc.args as any;
                            handleCodeChangeInSlot(new_content, focusedSlot);
                            setChatMessages(prev => [...prev, { role: 'ai', text: `*[System]: Injected code changes via Voice Command. ${summary || ''}*` }]);
                            service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: "Success: Workspace updated." } }]);
                            addSystemLog(`Applied code patch from voice command.`, 'success');
                        } else if (fc.name === 'create_new_file') {
                            const { filename, content, directory_path } = fc.args as any;
                            await handleCreateNewFile(filename, content, directory_path);
                            setChatMessages(prev => [...prev, { role: 'ai', text: `*[System]: Opened and implemented new file '${filename}' via Voice Command.*` }]);
                            service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Success: '${filename}' created.` } }]);
                        } else if (fc.name === 'set_working_directory') {
                            const { path } = fc.args as any;
                            localCwd = path;
                            setWorkingDirectory(path);
                            service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Success: CWD moved to ${path}` } }]);
                        } else if (fc.name === 'create_directory') {
                            const { directory_name, parent_path } = fc.args as any;
                            await handleCreateDirectory(directory_name, parent_path);
                            service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: `Success: Directory '${directory_name}' created.` } }]);
                            await refreshExplorer();
                        } else if (fc.name === 'list_directory') {
                            const { path } = fc.args as any;
                            let items = [];
                            const targetPath = resolvePath(path, localCwd);
                            if (activeTab === 'drive' && driveToken) {
                                let cleanPath = targetPath;
                                if (cleanPath.startsWith('/')) cleanPath = cleanPath.substring(1);
                                const targetFolderId = await findFolder(driveToken, cleanPath, driveRootId || undefined);
                                items = targetFolderId ? await listDriveFiles(driveToken, targetFolderId) : [];
                            }
                            service.sendToolResponse([{ id: fc.id, name: fc.name, response: { result: { items } } }]);
                        }
                    } catch (toolErr: any) {
                        addSystemLog(`Live Tool Failed: ${toolErr.message}`, 'error');
                        service.sendToolResponse([{ id: fc.id, name: fc.name, response: { error: toolErr.message } }]);
                    }
                }
            }
        }, [{ functionDeclarations: [updateFileTool, createNewFileTool, createDirectoryTool, listDirectoryTool, moveFileTool, setWorkingDirectoryTool] }]);
    } catch (e) {
        addSystemLog(`Live connection failed to start.`, 'error');
        setIsLiveChatActive(false);
    }
  };

  const handleFormatCode = async (slotIdx: number) => {
      const file = activeSlots[slotIdx];
      if (!file || isFormattingSlots[slotIdx]) return;
      setIsFormattingSlots(prev => ({ ...prev, [slotIdx]: true }));
      try {
          const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
          const resp = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: `Format RAW code: ${file.content}` });
          let result = resp.text || file.content;
          result = result.replace(/```(?:[a-zA-Z0-9+-]+)?\n?([\s\S]*?)\n?```/g, '$1').trim();
          handleCodeChangeInSlot(result, slotIdx);
      } catch (e: any) { console.error(e); } finally { setIsFormattingSlots(prev => ({ ...prev, [slotIdx]: false })); }
  };

  const resize = useCallback((e: MouseEvent) => {
    if (isDraggingLeft) { const nw = e.clientX; if (nw > 160 && nw < 500) setLeftWidth(nw); }
    if (isDraggingRight) { const nw = window.innerWidth - e.clientX; if (nw > 160 && nw < 500) setRightWidth(nw); }
    if (isDraggingInner && centerContainerRef.current) {
        const rect = centerContainerRef.current.getBoundingClientRect();
        const newRatio = layoutMode === 'split-v' ? ((e.clientX - rect.left) / rect.width) * 100 : ((e.clientY - rect.top) / rect.height) * 100;
        if (newRatio > 10 && newRatio < 90) setInnerSplitRatio(newRatio);
    }
  }, [isDraggingLeft, isDraggingRight, isDraggingInner, layoutMode]);

  useEffect(() => {
      if (isDraggingLeft || isDraggingRight || isDraggingInner) {
          window.addEventListener('mousemove', resize);
          const stop = () => { setIsDraggingLeft(false); setIsDraggingRight(false); setIsDraggingInner(false); };
          window.addEventListener('mouseup', stop);
          return () => { window.removeEventListener('mousemove', resize); window.removeEventListener('mouseup', stop); };
      }
  }, [isDraggingLeft, isDraggingRight, isDraggingInner, resize]);

  useEffect(() => { refreshExplorer(); }, [activeTab, driveToken, githubToken, currentUser]);

  const sessionTree = useMemo(() => {
      if (!isInterviewerMode) return [];
      // Use project.files instead of initialFiles so new files show up instantly
      return project.files.map(f => ({
          id: f.path,
          name: f.name,
          type: 'file' as const,
          isLoaded: true,
          size: f.size,
          data: f
      }));
  }, [isInterviewerMode, project.files]);

  const driveTree = useMemo(() => {
      const root: TreeNode[] = [];
      const map = new Map<string, TreeNode>();
      driveItems.forEach(item => map.set(item.id, { id: item.id, name: item.name, type: item.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file', data: item, children: [], isLoaded: item.isLoaded, size: item.size ? parseInt(item.size) : undefined }));
      driveItems.forEach(item => {
          const node = map.get(item.id)!;
          if (item.parentId && map.has(item.parentId)) map.get(item.parentId)!.children.push(node);
          else if (!item.parentId) root.push(node);
      });
      return root;
  }, [driveItems]);

  const cloudTree = useMemo(() => {
    const root: TreeNode[] = [];
    const map = new Map<string, TreeNode>();
    cloudItems.forEach(item => map.set(item.fullPath, { id: item.fullPath, name: item.name, type: item.isFolder ? 'folder' : 'file', data: item, children: [], isLoaded: true, size: item.size }));
    cloudItems.forEach(item => { const node = map.get(item.fullPath)!; const parts = item.fullPath.split('/'); parts.pop(); const pPath = parts.join('/'); if (map.has(pPath)) map.get(pPath)!.children.push(node); else root.push(node); });
    return root;
  }, [cloudItems]);

  const filteredRepos = useMemo(() => {
      if (!githubSearchQuery.trim()) return githubRepos;
      return githubRepos.filter(r => r.full_name.toLowerCase().includes(githubSearchQuery.toLowerCase()));
  }, [githubRepos, githubSearchQuery]);

  const isSharedViewOnly = isLive && (params.get('mode') === 'view');

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      <header className="h-14 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-4 shrink-0 z-20">
         <div className="flex items-center space-x-4">
            <button onClick={onBack} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"><ArrowLeft size={20} /></button>
            <button onClick={() => setIsLeftOpen(!isLeftOpen)} className={`p-2 rounded-lg ${isLeftOpen ? 'bg-slate-800 text-white' : 'text-slate-50'}`}><PanelLeftOpen size={20}/></button>
         </div>
         <div className="flex items-center space-x-2">
            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 mr-4">
                <button onClick={() => handleSetLayout('single')} className={`p-1.5 rounded ${layoutMode === 'single' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500'}`}><SquareIcon size={16}/></button>
                <button onClick={() => handleSetLayout('split-v')} className={`p-1.5 rounded ${layoutMode === 'split-v' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-50'}`}><Columns size={16}/></button>
                <button onClick={() => handleSetLayout('split-h')} className={`p-1.5 rounded ${layoutMode === 'split-h' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-50'}`}><Rows size={16}/></button>
                <button onClick={() => handleSetLayout('quad')} className={`p-1.5 rounded ${layoutMode === 'quad' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-50'}`}><Grid2X2 size={16}/></button>
            </div>
            {!isSharedViewOnly && (
                <>
                    <button onClick={handleShare} className="flex items-center space-x-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-lg transition-all active:scale-95">
                        <Share2 size={14}/>
                        <span>Share</span>
                    </button>
                    <button onClick={() => handleSmartSave()} disabled={lockStatus === 'busy'} className="flex items-center space-x-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold"><Save size={14}/><span>Save</span></button>
                </>
            )}
            <button onClick={() => setIsRightOpen(!isRightOpen)} className={`p-2 rounded-lg ${isRightOpen ? 'bg-slate-800 text-white' : 'text-slate-50'}`}><PanelRightOpen size={20}/></button>
         </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
          <div className={`${isLeftOpen ? '' : 'hidden'} bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 overflow-hidden relative`} style={{ width: `${leftWidth}px` }}>
              <div className="flex border-b border-slate-800 shrink-0">
                  {isInterviewerMode && (
                      <button onClick={() => setActiveTab('session')} className={`flex-1 py-3 flex justify-center border-b-2 transition-colors ${activeTab === 'session' ? 'border-indigo-500 text-white bg-slate-800' : 'border-transparent text-slate-500 hover:text-slate-300'}`} title="Interview Session"><Activity size={18}/></button>
                  )}
                  <button onClick={() => setActiveTab('drive')} className={`flex-1 py-3 flex justify-center border-b-2 transition-colors ${activeTab === 'drive' ? 'border-indigo-500 text-white bg-slate-800' : 'border-transparent text-slate-500 hover:text-slate-300'}`} title="Google Drive"><HardDrive size={18}/></button>
                  <button onClick={() => setActiveTab('cloud')} className={`flex-1 py-3 flex justify-center border-b-2 transition-colors ${activeTab === 'cloud' ? 'border-indigo-500 text-white bg-slate-800' : 'border-transparent text-slate-500 hover:text-slate-300'}`} title="Private Cloud"><Cloud size={18}/></button>
                  <button onClick={() => setActiveTab('github')} className={`flex-1 py-3 flex justify-center border-b-2 transition-colors ${activeTab === 'github' ? 'border-indigo-500 text-white bg-slate-800' : 'border-transparent text-slate-500 hover:text-slate-300'}`} title="GitHub"><Github size={18}/></button>
              </div>
              <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="p-3 border-b border-slate-800 flex gap-1.5 shrink-0 bg-slate-900/50">
                      <button onClick={refreshExplorer} disabled={isExplorerLoading} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors" title="Refresh Explorer">{isExplorerLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}</button>
                      {!isSharedViewOnly && (
                        <div className="flex-1 flex gap-1">
                          <button onClick={() => handleCreateNewFile()} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-1.5 rounded-lg text-[10px] font-black uppercase flex items-center justify-center gap-1.5 shadow-lg transition-all active:scale-95" title="New File"><FilePlus size={14}/> File</button>
                          <button onClick={() => handleCreateDirectory()} className="flex-1 bg-slate-800 hover:bg-slate-700 text-indigo-400 py-1.5 rounded-lg text-[10px] font-black uppercase flex items-center justify-center gap-1.5 border border-slate-700 shadow-lg transition-all active:scale-95" title="New Directory"><FolderPlus size={14}/> Dir</button>
                        </div>
                      )}
                  </div>
                  
                  {activeTab === 'session' && (
                      <div className="flex-1 overflow-y-auto scrollbar-hide py-2">
                          <div className="px-3 py-1 mb-2">
                              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Interview Artifacts</span>
                          </div>
                          {sessionTree.map(node => <FileTreeItem key={node.id} node={node} depth={0} activeId={activeFile?.path} onSelect={handleExplorerSelect} onToggle={toggleFolder} onDelete={handleDeleteExplorerItem} onShare={null} onMove={handleMoveExplorerItem} expandedIds={expandedIds} loadingIds={loadingIds}/>)}
                      </div>
                  )}

                  {activeTab === 'drive' && (driveToken ? <div className="flex-1 overflow-y-auto scrollbar-hide py-2">{driveTree.map(node => <FileTreeItem key={node.id} node={node} depth={0} activeId={activeFile?.path?.replace('drive://','')} onSelect={handleExplorerSelect} onToggle={toggleFolder} onDelete={handleDeleteExplorerItem} onShare={()=>{}} onMove={handleMoveExplorerItem} expandedIds={expandedIds} loadingIds={loadingIds}/>)}</div> : <div className="p-12 text-center flex flex-col items-center justify-center h-full gap-4"><button onClick={handleConnectDrive} className="px-6 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-lg">Connect G-Drive</button></div>)}
                  
                  {activeTab === 'cloud' && (currentUser ? <div className="flex-1 overflow-y-auto scrollbar-hide py-2">{cloudTree.map(node => <FileTreeItem key={node.id} node={node} depth={0} onSelect={handleExplorerSelect} onToggle={toggleFolder} onDelete={handleDeleteExplorerItem} onShare={()=>{}} onMove={handleMoveExplorerItem} expandedIds={expandedIds} loadingIds={loadingIds}/>)}</div> : <div className="p-12 text-center flex flex-col items-center justify-center h-full gap-4"><p className="text-xs text-slate-400">Sign in for Private Cloud.</p></div>)}

                  {activeTab === 'github' && (
                      <div className="flex-1 flex flex-col overflow-hidden">
                          {!githubToken ? (
                              <div className="p-12 text-center flex flex-col items-center justify-center h-full gap-4"><button onClick={handleGithubLogin} className="px-6 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-lg flex items-gap-2"><Github size={14}/> Connect GitHub</button><div className="flex flex-col gap-2 mt-4 text-center"><p className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-relaxed">Problems connecting?</p><button onClick={() => setShowManualToken(true)} className="text-[10px] text-indigo-400 hover:text-white underline font-bold uppercase tracking-widest">Use Access Token</button></div></div>
                          ) : isGithubLoading ? (
                              <div className="flex-1 flex flex-col items-center justify-center text-indigo-400 gap-4"><Loader2 className="animate-spin" size={32}/><span className="text-[10px] font-black uppercase tracking-widest">Fetching Repos...</span></div>
                          ) : githubTree.length > 0 ? (
                              <div className="flex-1 flex flex-col overflow-hidden">
                                  <div className="p-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between"><div className="flex items-center gap-2 overflow-hidden"><Github size={12} className="text-slate-500"/><span className="text-[10px] font-bold text-indigo-300 truncate uppercase tracking-widest">{project.github?.owner}/{project.github?.repo}</span></div><div className="flex items-center gap-2"><button onClick={() => { localStorage.removeItem('github_token'); setGithubToken(null); setGithubTree([]); }} className="text-slate-500 hover:text-red-400" title="Disconnect GitHub"><LogIn size={12} className="rotate-180"/></button><button onClick={() => setGithubTree([])} className="text-slate-500 hover:text-white" title="Change Repository"><RefreshCw size={12}/></button></div></div>
                                  <div className="flex-1 overflow-y-auto scrollbar-hide py-2">{githubTree.map(node => <FileTreeItem key={node.id} node={node} depth={0} activeId={activeFile?.path} onSelect={handleExplorerSelect} onToggle={toggleFolder} onDelete={handleDeleteExplorerItem} onShare={()=>{}} onMove={handleMoveExplorerItem} expandedIds={expandedIds} loadingIds={loadingIds}/>)}</div>
                              </div>
                          ) : (
                              <div className="flex-1 flex flex-col overflow-hidden">
                                  <div className="p-3"><div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" size={14}/><input type="text" value={githubSearchQuery} onChange={e => setGithubSearchQuery(e.target.value)} placeholder="Search repositories..." className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"/></div></div>
                                  <div className="flex-1 overflow-y-auto scrollbar-hide">{filteredRepos.length === 0 ? <div className="p-8 text-center text-slate-600 text-xs italic">No repositories found.</div> : filteredRepos.map(repo => <button key={repo.id} onClick={() => handleSelectRepo(repo)} className="w-full text-left p-3 border-b border-slate-800 hover:bg-slate-800 transition-colors group"><div className="flex items-center justify-between mb-1"><span className="text-xs font-bold text-slate-300 group-hover:text-white truncate">{repo.name}</span><span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${repo.private ? 'bg-amber-900/20 text-amber-500 border-amber-900/50' : 'bg-emerald-900/20 text-emerald-500 border-emerald-900/50'}`}>{repo.private ? 'Private' : 'Public'}</span></div><p className="text-[10px] text-slate-500 line-clamp-1">{repo.description || 'No description provided.'}</p></button>)}</div>
                                  <div className="p-3 bg-slate-950 border-t border-slate-800 text-center"><button onClick={() => { localStorage.removeItem('github_token'); setGithubToken(null); }} className="text-[9px] font-black text-slate-500 uppercase hover:text-red-400">Logout GitHub</button></div>
                              </div>
                          )}
                      </div>
                  )}
              </div>

              {/* NEURAL EXECUTION CONSOLE - DEBUG WINDOW */}
              <div className={`absolute bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-900 transition-all duration-300 flex flex-col ${showSystemLogs ? 'h-1/2' : 'h-10'} z-50`}>
                  <button 
                    onClick={() => setShowSystemLogs(!showSystemLogs)}
                    className="h-10 flex items-center justify-between px-4 bg-slate-950/80 hover:bg-slate-800 transition-colors shrink-0"
                  >
                      <div className="flex items-center gap-2">
                          <TerminalSquare size={14} className="text-indigo-400"/>
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Neural Execution Console</span>
                          <div className="h-4 w-px bg-slate-800 mx-1"></div>
                          <span className="text-[9px] font-mono text-indigo-500 uppercase tracking-tighter">CWD: {workingDirectory}</span>
                          {systemLogs.some(l => l.type === 'error') && <AlertTriangle size={12} className="text-red-500 animate-pulse ml-2"/>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); setSystemLogs([]); }} className="p-1 hover:bg-slate-700 rounded text-slate-500"><Trash2 size={12}/></button>
                        {showSystemLogs ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}
                      </div>
                  </button>
                  {showSystemLogs && (
                      <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-1.5 scrollbar-hide bg-black/40">
                          {systemLogs.length === 0 ? (
                              <p className="text-slate-700 italic">No events recorded in this session.</p>
                          ) : systemLogs.map((log) => (
                              <div key={log.id} className="flex gap-3 leading-relaxed group">
                                  <span className="text-slate-600 shrink-0 select-none">[{log.time}]</span>
                                  <div className="flex flex-col min-w-0">
                                      <div className="flex items-center gap-2">
                                          <span className={`font-bold ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : log.type === 'tool' ? 'text-indigo-400' : log.type === 'warn' ? 'text-amber-400' : 'text-slate-400'}`}>
                                              {log.type === 'tool' && <Zap size={10} className="inline mr-1"/>}
                                              {log.message}
                                          </span>
                                      </div>
                                      {log.details && (
                                          <pre className="mt-1 p-2 bg-slate-950 rounded border border-slate-800 text-[10px] text-slate-500 overflow-x-auto whitespace-pre-wrap max-h-40">
                                              {JSON.stringify(log.details, null, 2)}
                                          </pre>
                                      )}
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          </div>
          <div onMouseDown={() => setIsDraggingLeft(true)} className="w-1 cursor-col-resize hover:bg-indigo-500/50 z-30 shrink-0 bg-slate-800/20"></div>
          <div ref={centerContainerRef} className={`flex-1 bg-slate-950 flex min-w-0 relative ${layoutMode === 'quad' ? 'grid grid-cols-2 grid-rows-2' : layoutMode === 'split-v' ? 'flex-row' : (layoutMode === 'split-h' ? 'flex-col' : 'flex-col')}`}>
              {[0, 1, 2, 3].map(i => (
                  <Slot key={i} idx={i} activeSlots={activeSlots} focusedSlot={focusedSlot} setFocusedSlot={setFocusedSlot} slotViewModes={slotViewModes} toggleSlotViewMode={toggleSlotViewMode} isFormattingSlots={isFormattingSlots} terminalOutputs={terminalOutputs} setTerminalOutputs={setTerminalOutputs} isTerminalOpen={isTerminalOpen} setIsTerminalOpen={setIsTerminalOpen} isRunning={isRunning} layoutMode={layoutMode} innerSplitRatio={innerSplitRatio} handleRunCode={handleRunCode} handleFormatCode={handleFormatCode} handleCodeChangeInSlot={handleCodeChangeInSlot} updateSlotFile={updateSlotFile} onSyncCodeWithAi={onSyncCodeWithAi} handleDownloadMedia={handleDownloadMedia} fontSize={fontSize} indentMode={indentMode} isLive={isLive} lockStatus={lockStatus} broadcastCursor={broadcastCursor} isReadOnly={isSharedViewOnly} isInterviewerMode={isInterviewerMode} />
              ))}
          </div>
          <div onMouseDown={() => setIsDraggingRight(true)} className="w-1 cursor-col-resize hover:bg-indigo-500/50 z-30 shrink-0 bg-slate-800/20"></div>
          <div className={`${isRightOpen ? '' : 'hidden'} bg-slate-950 flex flex-col shrink-0 overflow-hidden shadow-2xl relative z-40`} style={{ width: `${rightWidth}px` }}>
              <AIChatPanel 
                isOpen={true} 
                onClose={() => setIsRightOpen(false)} 
                messages={isInterviewerMode ? externalChatContent || [] : chatMessages} 
                onSendMessage={handleSendMessage} 
                isThinking={isInterviewerMode ? isAiThinking : isChatThinking} 
                currentInput={chatInput} 
                onInputChange={setChatInput} 
                isInterviewerMode={isInterviewerMode}
                isLiveMode={isLiveChatActive}
                onToggleLive={toggleLiveChat}
              />
          </div>
      </div>

      {showShareModal && shareUrl && (
          <ShareModal 
            isOpen={true} 
            onClose={() => setShowShareModal(false)} 
            onShare={handleUpdateAccess} 
            link={shareUrl} 
            title={project.name}
            currentAccess={project.accessLevel}
            currentAllowedUsers={project.allowedUserIds}
            currentUserUid={currentUser?.uid}
            defaultPermission="write"
          />
      )}

      {showManualToken && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
              <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-sm p-6 shadow-2xl animate-fade-in-up">
                  <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold text-white flex items-center gap-2"><Key className="text-indigo-400" size={18}/> Manual Token Fallback</h3><button onClick={() => setShowManualToken(false)} className="text-slate-500 hover:text-white"><X size={20}/></button></div>
                  <div className="space-y-4"><div className="p-3 bg-amber-900/20 border border-amber-500/30 rounded-xl flex items-start gap-3"><AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16}/><div className="space-y-2"><p className="text-[10px] text-amber-200 leading-relaxed font-bold">CONFLICT DETECTED:</p><p className="text-[10px] text-amber-200 leading-relaxed">{githubLinkingError || "OAuth linking failed because your GitHub is already linked to another account."}</p><p className="text-[10px] text-amber-200 leading-relaxed italic">Use a Personal Access Token (PAT) to bypass this conflict.</p></div></div><div className="space-y-2"><label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1">GitHub Access Token</label><input type="password" value={manualToken} onChange={e => setManualToken(e.target.value)} placeholder="ghp_..." className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-indigo-200 outline-none focus:border-indigo-500 font-mono"/></div><div className="flex flex-col gap-2"><button onClick={handleSetManualToken} disabled={!manualToken.trim()} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg disabled:opacity-50 transition-all active:scale-95">Save & Connect</button><a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="text-[10px] text-slate-500 hover:text-indigo-400 flex items-center justify-center gap-1 mt-1 transition-colors">How to generate a token? <ExternalLink size={10}/></a></div></div>
              </div>
          </div>
      )}
    </div>
  );
};

export default CodeStudio;
