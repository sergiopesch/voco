import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';

export const useVoiceInteraction = () => {
    const { voiceState, updateVoiceState, addMessage } = useStore();
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);

    const startListening = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder.current = new MediaRecorder(stream);
            audioChunks.current = [];

            mediaRecorder.current.ondataavailable = (event) => {
                audioChunks.current.push(event.data);
            };

            mediaRecorder.current.onstop = async () => {
                const audioBlob = new Blob(audioChunks.current, { type: 'audio/wav' });
                await processAudio(audioBlob);
            };

            mediaRecorder.current.start();
            updateVoiceState({ isListening: true, error: null });
        } catch (error) {
            updateVoiceState({
                error: 'Failed to access microphone. Please check permissions.',
                isListening: false,
            });
        }
    }, [updateVoiceState]);

    const stopListening = useCallback(() => {
        if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
            mediaRecorder.current.stop();
            updateVoiceState({ isListening: false });
        }
    }, [updateVoiceState]);

    const processAudio = async (audioBlob: Blob) => {
        try {
            updateVoiceState({ isProcessing: true });

            // Create form data with audio blob
            const formData = new FormData();
            formData.append('audio', audioBlob);

            // Send to backend for processing
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) throw new Error('Failed to process audio');

            const { text } = await response.json();

            updateVoiceState({ transcription: text });

            // Add user message
            addMessage({
                id: Date.now().toString(),
                role: 'user',
                content: text,
                timestamp: Date.now(),
            });

            // Get AI response
            const aiResponse = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text }),
            });

            if (!aiResponse.ok) throw new Error('Failed to get AI response');

            const { response: aiText } = await aiResponse.json();

            // Add AI message
            addMessage({
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: aiText,
                timestamp: Date.now(),
            });

            // Convert AI response to speech
            const speechResponse = await fetch('/api/text-to-speech', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: aiText }),
            });

            if (!speechResponse.ok) throw new Error('Failed to convert to speech');

            const audioBlob = await speechResponse.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            await audio.play();

        } catch (error) {
            updateVoiceState({
                error: 'Failed to process audio. Please try again.',
            });
        } finally {
            updateVoiceState({ isProcessing: false });
        }
    };

    useEffect(() => {
        return () => {
            if (mediaRecorder.current) {
                mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    return {
        startListening,
        stopListening,
        isListening: voiceState.isListening,
        isProcessing: voiceState.isProcessing,
        error: voiceState.error,
    };
}; 