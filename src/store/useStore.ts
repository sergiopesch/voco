import { create } from 'zustand';
import { User, AIModel, VoiceState, Message } from '@/types';

interface AppState {
    user: User | null;
    selectedModel: AIModel | null;
    voiceState: VoiceState;
    messages: Message[];
    isModelPanelOpen: boolean;

    // Actions
    setUser: (user: User | null) => void;
    setSelectedModel: (model: AIModel | null) => void;
    updateVoiceState: (state: Partial<VoiceState>) => void;
    addMessage: (message: Message) => void;
    clearMessages: () => void;
    toggleModelPanel: () => void;
}

const defaultModels = {
    speechToText: {
        id: 'google-speech-v1',
        name: 'Google Speech API',
        provider: 'google' as const,
        description: 'High-accuracy speech recognition for voice input.',
        maxTokens: 0,
        contextWindow: 0,
        category: 'Speech-to-Text' as const,
    },
    textGeneration: {
        id: 'mistral-small',
        name: 'Mistral AI',
        provider: 'mistral' as const,
        description: 'Fast and efficient for most conversations.',
        maxTokens: 150,
        contextWindow: 4096,
        category: 'Text Generation' as const,
    },
    textToSpeech: {
        id: 'google-tts-neural2',
        name: 'Google Neural2 Voice',
        provider: 'google' as const,
        description: 'High-quality neural text-to-speech with natural intonation.',
        maxTokens: 0,
        contextWindow: 0,
        category: 'Text-to-Speech' as const,
    }
};

const initialVoiceState: VoiceState = {
    isListening: false,
    isProcessing: false,
    transcription: '',
    showTranscription: true,
    error: null,
};

export const useStore = create<AppState>((set) => ({
    user: null,
    selectedModel: defaultModels.textGeneration,
    voiceState: initialVoiceState,
    messages: [],
    isModelPanelOpen: false,

    setUser: (user) => set({ user }),

    setSelectedModel: (model) => set({ selectedModel: model }),

    updateVoiceState: (state) =>
        set((prev) => ({
            voiceState: { ...prev.voiceState, ...state },
        })),

    addMessage: (message) =>
        set((prev) => ({
            messages: [...prev.messages, message],
        })),

    clearMessages: () => set({ messages: [] }),

    toggleModelPanel: () =>
        set((prev) => ({
            isModelPanelOpen: !prev.isModelPanelOpen,
        })),
})); 