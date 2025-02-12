import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
    error: any;
}

interface SpeechRecognitionResult {
    isFinal: boolean;
    [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface SpeechRecognitionResultList {
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    onresult: (event: SpeechRecognitionEvent) => void;
    onerror: (event: SpeechRecognitionEvent) => void;
    onend: () => void;
}

interface SpeechRecognitionConstructor {
    new(): SpeechRecognition;
}

declare global {
    interface Window {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
    }
}

export const useVoiceInteraction = () => {
    const { voiceState, updateVoiceState, addMessage, selectedModel } = useStore();
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);
    const mimeTypeRef = useRef<string>('');
    const recognition = useRef<SpeechRecognition | null>(null);
    const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [isAIResponding, setIsAIResponding] = useState(false);

    const initializeSpeechRecognition = () => {
        if (!recognition.current) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                recognition.current = new SpeechRecognition();
                recognition.current.continuous = true;
                recognition.current.interimResults = true;
                recognition.current.lang = 'en-US';

                recognition.current.onresult = (event: SpeechRecognitionEvent) => {
                    const transcript = Array.from(event.results)
                        .map(result => result[0]?.transcript || '')
                        .join(' ');

                    updateVoiceState({
                        transcription: transcript,
                        showTranscription: true
                    });

                    // Reset silence timeout when user speaks
                    if (silenceTimeoutRef.current) {
                        clearTimeout(silenceTimeoutRef.current);
                    }

                    // Set new silence timeout
                    silenceTimeoutRef.current = setTimeout(() => {
                        if (!isAIResponding && recognition.current) {
                            processAudio(audioChunks.current);
                        }
                    }, 1500); // 1.5 seconds of silence triggers processing
                };

                recognition.current.onerror = (event: SpeechRecognitionEvent) => {
                    console.error('Speech recognition error:', event.error);
                    updateVoiceState({ error: 'Speech recognition error: ' + event.error });
                };

                recognition.current.onend = () => {
                    if (!isAIResponding && voiceState.isListening) {
                        // Restart recognition if it ends unexpectedly
                        recognition.current?.start();
                    }
                };
            }
        }
    };

    const processAudio = useCallback(async (audioData: Blob[]) => {
        try {
            setIsAIResponding(true);
            updateVoiceState({ isProcessing: true, error: null });
            const audioBlob = new Blob(audioData, { type: mimeTypeRef.current });

            // Create form data with audio blob
            const formData = new FormData();
            formData.append('audio', audioBlob);

            // Get final transcription from Google Cloud
            const transcribeResponse = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData,
            });

            if (!transcribeResponse.ok) {
                const errorData = await transcribeResponse.json();
                throw new Error(errorData.error || 'Failed to transcribe audio');
            }

            const transcribeData = await transcribeResponse.json();

            if (!transcribeData.text) {
                throw new Error('No speech detected. Please try speaking again.');
            }

            // Add user message
            addMessage({
                id: Date.now().toString(),
                role: 'user',
                content: transcribeData.text,
                timestamp: Date.now(),
            });

            // Get AI response
            const aiResponse = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: transcribeData.text,
                    model: selectedModel
                }),
            });

            const aiData = await aiResponse.json();

            if (!aiResponse.ok || !aiData.response) {
                throw new Error(aiData.error || 'Failed to get AI response');
            }

            // Add AI message
            addMessage({
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: aiData.response,
                timestamp: Date.now(),
            });

            // Convert to speech and play
            const speechResponse = await fetch('/api/text-to-speech', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: aiData.response }),
            });

            if (!speechResponse.ok) {
                const errorData = await speechResponse.json();
                throw new Error(errorData.error || 'Failed to convert response to speech');
            }

            const responseAudioBlob = await speechResponse.blob();
            const audioUrl = URL.createObjectURL(responseAudioBlob);
            const audio = new Audio(audioUrl);

            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                setIsAIResponding(false);
                // Clear audio chunks for the next interaction
                audioChunks.current = [];
            };

            await audio.play();

        } catch (error) {
            console.error('Voice processing error:', error);
            setIsAIResponding(false);
            updateVoiceState({
                error: error instanceof Error ? error.message : 'Failed to process audio. Please try again.',
                isProcessing: false
            });
        } finally {
            updateVoiceState({ isProcessing: false });
        }
    }, [updateVoiceState, addMessage, selectedModel, voiceState.isListening]);

    const startListening = useCallback(async () => {
        try {
            // Clear previous transcription and state
            updateVoiceState({
                transcription: '',
                error: null,
                isProcessing: false
            });
            setIsAIResponding(false);
            audioChunks.current = [];

            // Initialize and start speech recognition
            initializeSpeechRecognition();
            if (recognition.current) {
                recognition.current.start();
            }

            // Start audio recording
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 48000,
                }
            });

            mimeTypeRef.current = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            mediaRecorder.current = new MediaRecorder(stream, {
                mimeType: mimeTypeRef.current,
                audioBitsPerSecond: 128000
            });

            mediaRecorder.current.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.current.push(event.data);
                }
            };

            mediaRecorder.current.start(100);
            updateVoiceState({ isListening: true, error: null });

        } catch (error) {
            console.error('Microphone access error:', error);
            updateVoiceState({
                error: 'Failed to access microphone. Please check permissions.',
                isListening: false,
            });
        }
    }, [updateVoiceState]);

    const stopListening = useCallback(() => {
        // Clear silence timeout
        if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
        }

        // Stop speech recognition
        if (recognition.current) {
            try {
                recognition.current.stop();
            } catch (error) {
                console.error('Error stopping speech recognition:', error);
            }
        }

        // Stop media recorder
        if (mediaRecorder.current && mediaRecorder.current.state === 'recording') {
            try {
                mediaRecorder.current.stop();
                updateVoiceState({ isListening: false });
            } catch (error) {
                console.error('Error stopping recording:', error);
                updateVoiceState({
                    error: 'Failed to stop recording',
                    isListening: false
                });
            }
        }
    }, [updateVoiceState]);

    useEffect(() => {
        return () => {
            if (silenceTimeoutRef.current) {
                clearTimeout(silenceTimeoutRef.current);
            }
            if (mediaRecorder.current) {
                try {
                    const tracks = mediaRecorder.current.stream.getTracks();
                    tracks.forEach(track => track.stop());
                } catch (error) {
                    console.error('Error cleaning up media recorder:', error);
                }
            }
            if (recognition.current) {
                try {
                    recognition.current.stop();
                } catch (error) {
                    console.error('Error cleaning up speech recognition:', error);
                }
            }
        };
    }, []);

    return {
        startListening,
        stopListening,
        isListening: voiceState.isListening,
        isProcessing: voiceState.isProcessing,
        isAIResponding,
        error: voiceState.error,
    };
}; 