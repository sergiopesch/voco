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

const initialVoiceState: VoiceState = {
    isListening: false,
    isProcessing: false,
    transcription: '',
    showTranscription: false,
    error: null,
};

export const useStore = create<AppState>((set) => ({
    user: null,
    selectedModel: null,
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