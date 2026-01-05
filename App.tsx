
import React, { useState, useCallback, useEffect } from 'react';
import { Subject, Topic, Question, AppState, SyllabusRecord, SessionHistoryEntry, Theme } from './types';
import { classifySyllabus, generateQuestionsForSubtopic } from './services/geminiService';
import FileUpload from './components/FileUpload';
import Dashboard from './components/Dashboard';
import PracticeSession from './components/PracticeSession';
import { EduGeniusIcon, MoonIcon, SunIcon, ComputerDesktopIcon, UploadIcon } from './components/icons';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.UPLOAD);
  const [syllabi, setSyllabi] = useState<SyllabusRecord[]>([]);
  const [history, setHistory] = useState<SessionHistoryEntry[]>([]);
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('edugenius_theme') as Theme) || 'system';
  });
  const [learningRegion, setLearningRegion] = useState<string>(() => {
    return localStorage.getItem('edugenius_region') || 'United States';
  });
  
  const [activeSyllabusId, setActiveSyllabusId] = useState<string | null>(null);
  const [currentPracticeSession, setCurrentPracticeSession] = useState<{ subjectName: string; subtopicName: string; questions: Question[] } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Theme Logic
  useEffect(() => {
    const root = window.document.documentElement;
    const applyTheme = (t: 'light' | 'dark') => {
      root.classList.remove('light', 'dark');
      root.classList.add(t);
    };

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      applyTheme(systemTheme);

      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light');
      };
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      applyTheme(theme);
    }
    localStorage.setItem('edugenius_theme', theme);
  }, [theme]);

  // Persistence management
  useEffect(() => {
    const savedSyllabi = localStorage.getItem('edugenius_syllabi');
    const savedHistory = localStorage.getItem('edugenius_history');

    if (savedSyllabi) {
      try {
        const parsed = JSON.parse(savedSyllabi);
        setSyllabi(parsed);
        if (parsed.length > 0 && appState === AppState.UPLOAD) {
           setAppState(AppState.DASHBOARD);
           setActiveSyllabusId(parsed[0].id);
        }
      } catch (e) { console.error(e); }
    }

    if (savedHistory) {
      try { setHistory(JSON.parse(savedHistory)); } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    if (syllabi.length > 0) {
      localStorage.setItem('edugenius_syllabi', JSON.stringify(syllabi));
    } else {
      localStorage.removeItem('edugenius_syllabi');
    }
  }, [syllabi]);

  useEffect(() => {
    localStorage.setItem('edugenius_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem('edugenius_region', learningRegion);
  }, [learningRegion]);

  const handleSyllabusUpload = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const result = e.target?.result;
        if (!(result instanceof ArrayBuffer)) return;
        const base64Data = btoa(new Uint8Array(result).reduce((data, byte) => data + String.fromCharCode(byte), ''));
        try {
          const rawData = await classifySyllabus(base64Data, file.type || 'application/pdf');
          const timestamp = Date.now();
          const processedSubjects: Subject[] = rawData.map((s: any, sIdx: number) => ({
            id: `subj-${timestamp}-${sIdx}`,
            name: s.subject_name,
            chapters: s.chapters.map((c: any, cIdx: number) => ({
              id: `chap-${timestamp}-${sIdx}-${cIdx}`,
              name: c.chapter_name,
              topics: c.topics.map((t: string, tIdx: number) => ({
                id: `topic-${timestamp}-${sIdx}-${cIdx}-${tIdx}`,
                name: t,
                questions: [],
                questionsGenerated: false
              }))
            }))
          }));
          const newSyllabus: SyllabusRecord = { id: `syl-${timestamp}`, name: file.name, subjects: processedSubjects, uploadDate: timestamp };
          setSyllabi(prev => [...prev, newSyllabus]);
          setActiveSyllabusId(newSyllabus.id);
          setAppState(AppState.DASHBOARD);
        } catch (err: any) {
          setError(err.message || 'Gemini AI failed to classify this document.');
        } finally {
          setIsLoading(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      setError('Failed to read the uploaded file.');
      setIsLoading(false);
    }
  }, []);

  // Corrected nested mapping to properly update topics deep within the structure.
  const updateTopicInSyllabi = (topicId: string, updates: Partial<Topic>) => {
    setSyllabi(prev => prev.map(syl => ({
      ...syl,
      subjects: syl.subjects.map(subj => ({
        ...subj,
        chapters: subj.chapters.map(chap => ({
          ...chap,
          topics: chap.topics.map(topic => 
            topic.id === topicId ? { ...topic, ...updates } : topic
          )
        }))
      }))
    })));
  };

  const handleGenerateQuestions = useCallback(async (topicId: string, level: string, country: string) => {
    let topicToUpdate: Topic | undefined;
    syllabi.forEach(s => s.subjects.forEach(sub => sub.chapters.forEach(c => {
      const found = c.topics.find(t => t.id === topicId);
      if (found) topicToUpdate = found;
    })));
    if (!topicToUpdate) return;
    updateTopicInSyllabi(topicId, { isLoading: true });
    try {
      const questions = await generateQuestionsForSubtopic(topicToUpdate.name, level, country);
      updateTopicInSyllabi(topicId, { questions: questions.map((q, i) => ({ ...q, id: `q-${topicId}-${i}` })), questionsGenerated: true, isLoading: false });
    } catch (err) {
      updateTopicInSyllabi(topicId, { isLoading: false });
      setError("Question generation failed. Check your internet connection.");
    }
  }, [syllabi]);

  const handleStartPractice = useCallback((topicId: string, numQuestions: number) => {
    let topicToStart: Topic | undefined;
    let subjectToStart: Subject | undefined;
    syllabi.forEach(s => s.subjects.forEach(sub => sub.chapters.forEach(c => {
      const found = c.topics.find(t => t.id === topicId);
      if (found) {
        topicToStart = found;
        subjectToStart = sub;
      }
    })));
    if (!topicToStart || !subjectToStart || topicToStart.questions.length === 0) return;
    const shuffled = [...topicToStart.questions].sort(() => 0.5 - Math.random());
    setCurrentPracticeSession({ 
      subjectName: subjectToStart.name,
      subtopicName: topicToStart.name, 
      questions: shuffled.slice(0, numQuestions) 
    });
    setAppState(AppState.PRACTICE_SESSION);
  }, [syllabi]);

  const handleResetApp = useCallback(() => {
    if (window.confirm("Clear library and history? This will delete all locally saved data.")) {
      setSyllabi([]); setHistory([]); setAppState(AppState.UPLOAD); setActiveSyllabusId(null);
    }
  }, []);

  const handleDeleteSyllabus = useCallback((id: string) => {
    setSyllabi(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (activeSyllabusId === id) setActiveSyllabusId(filtered.length > 0 ? filtered[0].id : null);
      return filtered;
    });
  }, [activeSyllabusId]);

  const handleDeleteHistoryEntry = useCallback((id: string) => {
    setHistory(prev => prev.filter(entry => entry.id !== id));
  }, []);

  const ThemeToggle = () => (
    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
      <button 
        onClick={() => setTheme('light')}
        className={`p-1.5 rounded-lg transition-all ${theme === 'light' ? 'bg-white dark:bg-slate-600 shadow-sm text-amber-500' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
        title="Light Mode"
      >
        <SunIcon className="w-4 h-4" />
      </button>
      <button 
        onClick={() => setTheme('dark')}
        className={`p-1.5 rounded-lg transition-all ${theme === 'dark' ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-400' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
        title="Dark Mode"
      >
        <MoonIcon className="w-4 h-4" />
      </button>
      <button 
        onClick={() => setTheme('system')}
        className={`p-1.5 rounded-lg transition-all ${theme === 'system' ? 'bg-white dark:bg-slate-600 shadow-sm text-slate-600 dark:text-slate-200' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
        title="System Preference"
      >
        <ComputerDesktopIcon className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 selection:bg-indigo-100 selection:text-indigo-900 transition-colors duration-500">
       <header className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-sm border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-10 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {appState === AppState.PRACTICE_SESSION && (
              <button 
                onClick={() => setAppState(AppState.DASHBOARD)} 
                className="group flex items-center gap-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-black text-[11px] uppercase tracking-widest bg-slate-50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-700 active:scale-95"
              >
                <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                <span>Dashboard</span>
              </button>
            )}
            {appState === AppState.DASHBOARD && (
              <button 
                onClick={() => setAppState(AppState.UPLOAD)} 
                className="group flex items-center gap-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all font-black text-[11px] uppercase tracking-widest bg-slate-50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-700 active:scale-95"
              >
                <UploadIcon className="w-4 h-4" />
                <span>Add Syllabus</span>
              </button>
            )}
          </div>
          <div 
            onClick={() => setAppState(AppState.UPLOAD)} 
            className="flex items-center justify-center gap-3 cursor-pointer group"
          >
            <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-200 dark:shadow-indigo-900/20 group-hover:scale-110 transition-all duration-500">
              <EduGeniusIcon className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-xl font-black text-gray-900 dark:text-white tracking-tighter">EduGenius <span className="text-indigo-600 dark:text-indigo-400">AI</span></h1>
          </div>
          <div className="flex items-center gap-6">
            <ThemeToggle />
            <div className="hidden sm:flex flex-col items-end">
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">System Status</span>
               <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-black text-slate-900 dark:text-slate-300 uppercase">Active</span>
               </div>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-grow w-full max-w-7xl mx-auto px-6 sm:px-8 lg:px-10 py-10">
        {error && (
          <div className="bg-rose-50 dark:bg-rose-950/30 border-2 border-rose-100 dark:border-rose-900/50 text-rose-700 dark:text-rose-400 px-8 py-6 rounded-[2.5rem] shadow-xl flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 animate-in slide-in-from-top-10 duration-500" role="alert">
            <div className="flex-grow pr-8">
              <p className="font-black text-xs uppercase tracking-[0.3em] mb-1">System Interruption</p>
              <p className="text-base font-bold opacity-80">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600 font-black text-3xl mt-4 sm:mt-0 px-4 transition-colors">&times;</button>
          </div>
        )}
        {appState === AppState.UPLOAD && (
          <FileUpload 
            onSyllabusUpload={handleSyllabusUpload} 
            isLoading={isLoading} 
            hasExistingData={syllabi.length > 0}
            onBackToDashboard={() => syllabi.length > 0 && setAppState(AppState.DASHBOARD)}
          />
        )}
        {appState === AppState.DASHBOARD && (
          <Dashboard 
            syllabi={syllabi} 
            history={history} 
            learningRegion={learningRegion} 
            onSetLearningRegion={setLearningRegion} 
            activeSyllabusId={activeSyllabusId} 
            onSelectSyllabus={setActiveSyllabusId} 
            onGenerateQuestions={handleGenerateQuestions} 
            onStartPractice={handleStartPractice} 
            onResetGeneration={(tid) => updateTopicInSyllabi(tid, { questions: [], questionsGenerated: false })} 
            onAddMore={() => setAppState(AppState.UPLOAD)} 
            onDeleteSyllabus={handleDeleteSyllabus} 
            onDeleteHistory={handleDeleteHistoryEntry}
            onClearStack={handleResetApp} 
          />
        )}
        {appState === AppState.PRACTICE_SESSION && currentPracticeSession && (
          <PracticeSession session={currentPracticeSession} onEndSession={() => setAppState(AppState.DASHBOARD)} onSaveHistory={(entry) => setHistory(prev => [{...entry, id: `hist-${Date.now()}`}, ...prev])} />
        )}
      </main>
      <footer className="py-10 border-t border-slate-200 dark:border-slate-800 text-center">
         <p className="text-[10px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-[0.5em]">Cognitive Intelligence Platform © 2025</p>
      </footer>
    </div>
  );
};

export default App;
