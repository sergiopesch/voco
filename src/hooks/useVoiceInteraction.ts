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
    const currentTranscriptRef = useRef<string>('');
    const lastProcessedTranscriptRef = useRef<string>('');
    const minSpeechConfidence = 0.3; // Lowered confidence threshold for better sensitivity
    const silenceTimeout = 2000; // Increased to 2 seconds
    const isSpeakingRef = useRef<boolean>(false);

    // Add function to handle text-to-speech with fallback
    const speakText = async (text: string): Promise<void> => {
        try {
            console.log('Attempting to speak text:', text);
            // Try Google Cloud Text-to-Speech first
            console.log('Calling Google Cloud Text-to-Speech API...');
            const speechResponse = await fetch('/api/text-to-speech', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
            });

            if (!speechResponse.ok) {
                // If Google Cloud fails, throw error to trigger fallback
                const errorData = await speechResponse.json();
                console.warn('Google Cloud TTS failed:', errorData);
                throw new Error(errorData.error || 'Failed to convert response to speech');
            }

            console.log('Got successful response from Google Cloud TTS');
            const responseAudioBlob = await speechResponse.blob();
            const audioUrl = URL.createObjectURL(responseAudioBlob);
            const audio = new Audio(audioUrl);

            return new Promise((resolve, reject) => {
                audio.onended = () => {
                    console.log('Audio playback completed');
                    URL.revokeObjectURL(audioUrl);
                    resolve();
                };
                audio.onerror = (error) => {
                    console.error('Audio playback error:', error);
                    URL.revokeObjectURL(audioUrl);
                    reject(error);
                };
                console.log('Starting audio playback...');
                audio.play().catch(reject);
            });
        } catch (error) {
            console.warn('Falling back to browser speech synthesis:', error);

            // Fallback to browser's speech synthesis
            return new Promise((resolve, reject) => {
                if (!window.speechSynthesis) {
                    console.error('Speech synthesis not supported');
                    reject(new Error('Speech synthesis not supported'));
                    return;
                }

                // Cancel any ongoing speech
                window.speechSynthesis.cancel();

                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = 'en-US';
                utterance.rate = 1.0;
                utterance.pitch = 1.0;
                utterance.volume = 1.0;

                utterance.onend = () => {
                    console.log('Browser speech synthesis completed');
                    resolve();
                };
                utterance.onerror = (event) => {
                    console.error('Browser speech synthesis error:', event);
                    reject(event.error);
                };

                console.log('Starting browser speech synthesis...');
                window.speechSynthesis.speak(utterance);
            });
        }
    };

    const initializeSpeechRecognition = () => {
        if (!recognition.current) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                recognition.current = new SpeechRecognition();
                recognition.current.continuous = true;
                recognition.current.interimResults = true;
                recognition.current.lang = 'en-US';

                recognition.current.onresult = (event: SpeechRecognitionEvent) => {
                    let finalTranscript = '';
                    let interimTranscript = '';
                    let isSpeaking = false;

                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        const result = event.results[i];
                        const transcript = result[0].transcript;
                        const confidence = result[0].confidence;

                        // More lenient confidence check
                        if (confidence > minSpeechConfidence) {
                            if (result.isFinal) {
                                finalTranscript += transcript;
                                // Add final transcript to current transcript
                                currentTranscriptRef.current += ' ' + transcript;
                                currentTranscriptRef.current = currentTranscriptRef.current.trim();
                                isSpeaking = true;
                            } else {
                                interimTranscript += transcript;
                                isSpeaking = true;
                            }
                        }
                    }

                    // Update the transcription state with both final and interim results
                    if (finalTranscript || interimTranscript) {
                        const displayTranscript = (currentTranscriptRef.current + ' ' + interimTranscript).trim();
                        updateVoiceState({
                            transcription: displayTranscript,
                            showTranscription: true
                        });

                        // Reset silence timeout when user speaks
                        if (silenceTimeoutRef.current) {
                            clearTimeout(silenceTimeoutRef.current);
                        }

                        if (isSpeaking) {
                            isSpeakingRef.current = true;
                            // Only set silence timeout if we have new content
                            if (currentTranscriptRef.current !== lastProcessedTranscriptRef.current) {
                                silenceTimeoutRef.current = setTimeout(() => {
                                    if (!isAIResponding && recognition.current &&
                                        currentTranscriptRef.current !== lastProcessedTranscriptRef.current &&
                                        currentTranscriptRef.current.trim().length > 0) {
                                        console.log('Silence detected for 2 seconds, processing audio...');
                                        isSpeakingRef.current = false;
                                        lastProcessedTranscriptRef.current = currentTranscriptRef.current;
                                        processAudio(audioChunks.current);
                                    }
                                }, silenceTimeout);
                            }
                        }
                    }
                };

                recognition.current.onerror = (event: SpeechRecognitionEvent) => {
                    if (event.error === 'no-speech') {
                        // Only handle no-speech error if we were previously speaking
                        if (isSpeakingRef.current) {
                            console.log('No speech detected after speaking, processing audio...');
                            if (currentTranscriptRef.current !== lastProcessedTranscriptRef.current &&
                                currentTranscriptRef.current.trim().length > 0) {
                                lastProcessedTranscriptRef.current = currentTranscriptRef.current;
                                processAudio(audioChunks.current);
                            }
                            isSpeakingRef.current = false;
                        }
                        return;
                    }
                    console.error('Speech recognition error:', event.error);
                    updateVoiceState({ error: 'Speech recognition error: ' + event.error });
                };

                recognition.current.onend = () => {
                    if (!isAIResponding && voiceState.isListening) {
                        // Restart recognition if it ends unexpectedly
                        try {
                            recognition.current?.start();
                        } catch (error) {
                            console.error('Error restarting recognition:', error);
                        }
                    }
                };
            }
        }
    };

    const processAudio = useCallback(async (audioData: Blob[]) => {
        try {
            // Don't process if there's no new content
            if (currentTranscriptRef.current === lastProcessedTranscriptRef.current ||
                !currentTranscriptRef.current.trim()) {
                console.log('No new content to process');
                return;
            }

            console.log('Processing audio with transcript:', currentTranscriptRef.current);
            setIsAIResponding(true);
            updateVoiceState({ isProcessing: true, error: null });

            // Add user message with current transcript
            addMessage({
                id: Date.now().toString(),
                role: 'user',
                content: currentTranscriptRef.current,
                timestamp: Date.now(),
            });

            // Get AI response
            console.log('Fetching AI response...');
            const aiResponse = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: currentTranscriptRef.current,
                    model: selectedModel
                }),
            });

            const aiData = await aiResponse.json();
            console.log('AI response received:', aiData);

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

            // Speak the response
            console.log('Attempting to speak AI response...');
            await speakText(aiData.response);

            // Clear for next interaction
            currentTranscriptRef.current = '';
            lastProcessedTranscriptRef.current = '';
            audioChunks.current = [];
            setIsAIResponding(false);

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
    }, [updateVoiceState, addMessage, selectedModel]);

    const startListening = useCallback(async () => {
        try {
            // Clear previous state
            updateVoiceState({
                transcription: '',
                error: null,
                isProcessing: false
            });
            setIsAIResponding(false);
            currentTranscriptRef.current = '';
            lastProcessedTranscriptRef.current = '';
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