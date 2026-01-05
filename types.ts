
export interface Question {
  id: string;
  text: string;
  type: 'mcq' | 'descriptive';
  options?: string[];
  hints: string[];
  solution: string;
}

export interface Topic {
  id: string;
  name: string;
  questions: Question[];
  questionsGenerated: boolean;
  isLoading?: boolean;
}

export interface Chapter {
  id: string;
  name: string;
  topics: Topic[];
}

export interface Subject {
  id: string;
  name: string;
  chapters: Chapter[];
}

export interface SyllabusRecord {
  id: string;
  name: string;
  subjects: Subject[];
  uploadDate: number;
}

export interface SessionHistoryEntry {
  id: string;
  date: number;
  topicName: string;
  score: number;
  totalQuestions: number;
  proficiency: number;
}

export enum AppState {
  UPLOAD = 'UPLOAD',
  DASHBOARD = 'DASHBOARD',
  PRACTICE_SESSION = 'PRACTICE_SESSION',
}

export type Theme = 'light' | 'dark' | 'system';
