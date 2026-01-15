
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { CodeProject, CodeFile, UserProfile, Channel, CursorPosition, CloudItem, TranscriptItem } from '../types';
import { ArrowLeft, Save, Plus, Github, Cloud, HardDrive, Code, X, ChevronRight, ChevronDown, File, Folder, DownloadCloud, Loader2, CheckCircle, AlertTriangle, Info, FolderPlus, FileCode, RefreshCw, LogIn, CloudUpload, Trash2, ArrowUp, Edit2, FolderOpen, MoreVertical, Send, MessageSquare, Bot, Mic, MicOff, Sparkles, SidebarClose, SidebarOpen, Users, Eye, FileText as FileTextIcon, Image as ImageIcon, StopCircle, Minus, Maximize2, Minimize2, Lock, Unlock, Share2, Terminal as TerminalIcon, Copy, WifiOff, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Monitor, Laptop, PenTool, Edit3, ShieldAlert, ZoomIn, ZoomOut, Columns, Rows, Grid2X2, Square as SquareIcon, GripVertical, GripHorizontal, FileSearch, Indent, Wand2, Check, Link, MousePointer2, Activity, Key, Search, FilePlus, FileUp, Play, Trash, ExternalLink, GraduationCap, ShieldCheck, Youtube, Video, Zap, Download, Headphones, Radio } from 'lucide-react';
import { listCloudDirectory, saveProjectToCloud, deleteCloudItem, createCloudFolder, subscribeToCodeProject, saveCodeProject, updateCodeFile, updateCursor, claimCodeProjectLock, updateProjectActiveFile, deleteCodeFile, updateProjectAccess, sendShareNotification, deleteCloudFolderRecursive } from '../services/firestoreService';
import { ensureCodeStudioFolder, listDriveFiles, readDriveFile, saveToDrive, deleteDriveFile, createDriveFolder, DriveFile, moveDriveFile, shareFileWithEmail, getDriveFileSharingLink, downloadDriveFileAsBlob, getDriveFileStreamUrl, getDrivePreviewUrl } from '../services/googleDriveService';
import { connectGoogleDrive, getDriveToken, signInWithGoogle, signInWithGitHub } from '../services/authService';
import { fetchRepoInfo, fetchRepoContents, fetchFileContent, updateRepoFile, fetchUserRepos, fetchRepoSubTree, deleteRepoFile } from '../services/githubService';
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
  data?: any;
  isLoaded?: boolean;
  status?: 'modified' | 'new' | 'deleted';
  size?: number;
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

const FileTreeItem = ({ node, depth, activeId, onSelect, onToggle, onDelete, onShare, expandedIds, loadingIds }: any) => {
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
                    isExpanded ? <FolderOpen size={16} className="text-indigo-400"/> : <Folder size={16} className="text-slate-400 group-hover:text-indigo-400 transition-colors"/>
                ) : (
                    <FileIcon filename={node.name} />
                )}
                <span className="truncate text-xs">{node.name.split('/').pop()}</span>
                {node.status === 'modified' && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 ml-auto shadow-sm"></div>}
                
                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); onShare(node); }} className="p-1 hover:bg-slate-700 rounded text-slate-500 hover:text-indigo-400"><Share2 size={12}/></button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(node); }} className="p-1 hover:bg-slate-700 rounded text-slate-500 hover:text-red-400"><Trash2 size={12}/></button>
                </div>
            </div>
            
            {isExpanded && node.children && (
                <div className="flex flex-col">
                    {node.children.map((child: TreeNode) => (
                        <FileTreeItem 
                            key={child.id} 
                            node={child} 
                            depth={depth + 1} 
                            activeId={activeId}
                            onSelect={onSelect}
                            onToggle={onToggle}
                            onDelete={onDelete}
                            onShare={onShare}
                            expandedIds={expandedIds}
                            loadingIds={loadingIds}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// Fixed: Correctly exporting CodeStudio component
export const CodeStudio: React.FC<CodeStudioProps> = ({ 
  onBack, currentUser, userProfile, onSessionStart, onSessionStop, onStartLiveSession, initialFiles,
  externalChatContent, onSendExternalMessage, isInterviewerMode, isAiThinking, onFileChange, onSyncCodeWithAi
}) => {
  const [project, setProject] = useState<CodeProject | null>(null);
  const [files, setFiles] = useState<CodeFile[]>(initialFiles || []);
  const [activeFile, setActiveFile] = useState<CodeFile | null>(files[0] || null);
  const [consoleOutput, setConsoleOutput] = useState<string>('Neural Simulation Console ready.');
  const [isExecuting, setIsExecuting] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      setFiles(initialFiles);
      if (!activeFile) setActiveFile(initialFiles[0]);
    }
  }, [initialFiles]);

  const handleRunCode = async () => {
    if (!activeFile || isExecuting) return;
    setIsExecuting(true);
    setConsoleOutput('Preparing neural simulation...');
    
    // Correctly using GoogleGenAI initialization as per guidelines
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    try {
      // Using gemini-3-flash-preview for code simulation as it is high quality but fast
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Simulate the execution of this ${activeFile.language} code. 
        Provide the exact stdout and stderr.
        
        CODE:
        ${activeFile.content}`,
        config: {
          thinkingConfig: { thinkingBudget: 0 } // Guidelines: disable thinking for instant simulation
        }
      });

      setConsoleOutput(response.text || 'Process exited with no output.');
    } catch (e: any) {
      setConsoleOutput(`[RUNTIME ERROR] ${e.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleEditorChange = (value: string | undefined) => {
    if (!activeFile) return;
    const updated = { ...activeFile, content: value || '', isModified: true };
    setActiveFile(updated);
    setFiles(prev => prev.map(f => f.path === updated.path ? updated : f));
    if (onFileChange) onFileChange(updated);
  };

  const handleSaveFile = async () => {
    if (!activeFile || !currentUser) return;
    setIsLoading(true);
    try {
      await updateCodeFile(project?.id || 'local', activeFile);
      setActiveFile({ ...activeFile, isModified: false });
      setFiles(prev => prev.map(f => f.path === activeFile.path ? { ...f, isModified: false } : f));
    } catch (e) {
      alert("Save failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-slate-950 text-slate-100 overflow-hidden relative font-sans">
      {/* File Explorer Sidebar */}
      <div className={`${isSidebarOpen ? 'w-64' : 'w-0'} bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col shrink-0 overflow-hidden`}>
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-xs uppercase tracking-widest text-slate-500">Explorer</h2>
          <button onClick={() => setIsSidebarOpen(false)} className="p-1 hover:bg-slate-800 rounded text-slate-500"><PanelLeftClose size={16}/></button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {files.map(file => (
            <div 
              key={file.path} 
              onClick={() => setActiveFile(file)}
              className={`flex items-center gap-2 px-4 py-1.5 cursor-pointer text-sm ${activeFile?.path === file.path ? 'bg-indigo-600/20 text-indigo-400 border-l-2 border-indigo-500' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
            >
              <FileIcon filename={file.name} />
              <span className="truncate">{file.name}</span>
              {file.isModified && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 ml-auto" />}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && <button onClick={() => setIsSidebarOpen(true)} className="p-1 hover:bg-slate-800 rounded text-slate-500"><PanelLeftOpen size={16}/></button>}
            <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
               <Code size={14}/>
               <span className="uppercase tracking-widest">{activeFile?.language || 'Editor'}</span>
               <span className="text-slate-600">/</span>
               <span className="text-slate-200">{activeFile?.name || 'untitled'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSaveFile} disabled={!activeFile?.isModified || isLoading} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 disabled:opacity-30"><Save size={18}/></button>
            <button onClick={handleRunCode} disabled={isExecuting} className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-black uppercase tracking-widest shadow-lg active:scale-95">
              {isExecuting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
              <span>Run</span>
            </button>
          </div>
        </header>

        <div className="flex-1 relative overflow-hidden bg-[#1e1e1e]">
          <Editor
            height="100%"
            theme="vs-dark"
            language={activeFile?.language === 'javascript (react)' ? 'javascript' : activeFile?.language === 'typescript (react)' ? 'typescript' : activeFile?.language || 'text'}
            value={activeFile?.content || ''}
            onChange={handleEditorChange}
            options={{
              fontSize: 14,
              fontFamily: "'JetBrains Mono', monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 16 }
            }}
          />
        </div>

        <div className="h-32 bg-slate-950 border-t border-slate-800 flex flex-col">
            <div className="px-4 py-1.5 bg-slate-900 border-b border-slate-800 flex items-center gap-2">
                <Terminal size={12} className="text-slate-500"/>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Output</span>
            </div>
            <div className="flex-1 p-3 font-mono text-xs text-slate-400 overflow-y-auto scrollbar-hide whitespace-pre-wrap">
                {consoleOutput}
            </div>
        </div>
      </div>
    </div>
  );
};
