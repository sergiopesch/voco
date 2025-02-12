export type UserRole = 'admin' | 'user';

export interface User {
    id: string;
    email: string;
    role: UserRole;
    name?: string;
    avatar_url?: string;
}

export interface AIModel {
    id: string;
    name: string;
    provider: 'openai' | 'google';
    description: string;
    maxTokens: number;
}

export interface VoiceState {
    isListening: boolean;
    isProcessing: boolean;
    transcription: string;
    showTranscription: boolean;
    error: string | null;
}

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
} 