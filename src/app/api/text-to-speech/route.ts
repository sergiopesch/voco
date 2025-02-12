import { NextResponse } from 'next/server';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { protos } from '@google-cloud/text-to-speech';

// Initialize Text-to-Speech client with proper error handling
let client: TextToSpeechClient | null = null;
try {
    if (!process.env.GOOGLE_CLOUD_CREDENTIALS) {
        throw new Error('GOOGLE_CLOUD_CREDENTIALS environment variable is not set');
    }

    const credentials = JSON.parse(process.env.GOOGLE_CLOUD_CREDENTIALS);
    if (!credentials.project_id || !credentials.private_key || !credentials.client_email) {
        throw new Error('Invalid Google Cloud credentials format');
    }

    client = new TextToSpeechClient({
        credentials,
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    });
    console.log('Google Cloud Text-to-Speech client initialized successfully');
} catch (error) {
    console.error('Failed to initialize Text-to-Speech client:', error);
}

export async function POST(req: Request) {
    try {
        if (!client) {
            throw new Error('Text-to-Speech client is not initialized. Please check your Google Cloud credentials.');
        }

        const { text } = await req.json();
        console.log('Received text-to-speech request:', { textLength: text?.length });

        if (!text) {
            return NextResponse.json(
                { error: 'No text provided' },
                { status: 400 }
            );
        }

        // Check if the Text-to-Speech API is enabled
        try {
            console.log('Checking Text-to-Speech API status...');
            const [listVoicesResponse] = await client.listVoices({});
            if (!listVoicesResponse.voices?.length) {
                throw new Error('No voices available. The Text-to-Speech API might not be enabled.');
            }
            console.log('Text-to-Speech API is enabled and responding');
        } catch (error) {
            console.error('Error checking Text-to-Speech API:', error);
            if (error instanceof Error && error.message.includes('PERMISSION_DENIED')) {
                return NextResponse.json(
                    {
                        error: 'Google Cloud Text-to-Speech API is not enabled. Please enable it in your Google Cloud Console.',
                        details: 'Visit: https://console.cloud.google.com/apis/library/texttospeech.googleapis.com',
                    },
                    { status: 403 }
                );
            }
            throw error;
        }

        console.log('Synthesizing speech...');
        const request: protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
            input: { text },
            voice: {
                languageCode: 'en-US',
                name: 'en-US-Neural2-F',
                ssmlGender: protos.google.cloud.texttospeech.v1.SsmlVoiceGender.FEMALE,
            },
            audioConfig: {
                audioEncoding: protos.google.cloud.texttospeech.v1.AudioEncoding.MP3,
                speakingRate: 1.0,
                pitch: 0,
                volumeGainDb: 0,
                // Add these parameters for better voice quality
                effectsProfileId: ['telephony-class-application'],
                sampleRateHertz: 24000,
            },
        };

        const [response] = await client.synthesizeSpeech(request);
        const audioContent = response.audioContent;

        if (!audioContent) {
            throw new Error('No audio content generated');
        }

        console.log('Successfully generated audio response');
        const audioBuffer = Buffer.from(audioContent);

        // Try browser's built-in speech synthesis as fallback
        return new NextResponse(audioBuffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBuffer.length.toString(),
            },
        });
    } catch (error) {
        console.error('Text-to-speech error:', error);

        // Provide more specific error messages
        let errorMessage = 'Failed to convert text to speech';
        let statusCode = 500;

        if (error instanceof Error) {
            if (error.message.includes('API not enabled')) {
                errorMessage = 'Text-to-Speech API is not enabled. Please enable it in your Google Cloud Console.';
                statusCode = 403;
            } else if (error.message.includes('credentials')) {
                errorMessage = 'Invalid Google Cloud credentials. Please check your configuration.';
                statusCode = 401;
            } else if (error.message.includes('quota')) {
                errorMessage = 'API quota exceeded. Please check your Google Cloud Console.';
                statusCode = 429;
            } else {
                errorMessage = error.message;
            }
        }

        return NextResponse.json(
            {
                error: errorMessage,
                details: error instanceof Error ? error.stack : undefined,
                fallback: 'browser'  // Indicate that browser speech synthesis should be used
            },
            { status: statusCode }
        );
    }
} 