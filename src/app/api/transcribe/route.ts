import { NextResponse } from 'next/server';
import { SpeechClient } from '@google-cloud/speech';
import { protos } from '@google-cloud/speech';

interface GoogleCredentials {
    client_email: string;
    private_key: string;
    project_id: string;
    [key: string]: string | undefined;
}

// Parse credentials safely
const credentials = process.env.GOOGLE_CLOUD_CREDENTIALS;
let parsedCredentials: GoogleCredentials;

try {
    if (!credentials) {
        throw new Error('GOOGLE_CLOUD_CREDENTIALS environment variable is not set');
    }

    // Ensure we're parsing valid JSON
    if (credentials.trim().startsWith('<!DOCTYPE')) {
        throw new Error('Invalid credentials format: received HTML instead of JSON');
    }

    const parsed = JSON.parse(credentials);

    // Validate required fields
    const requiredFields = ['client_email', 'private_key', 'project_id'];
    for (const field of requiredFields) {
        if (!parsed[field]) {
            throw new Error(`Missing required field in credentials: ${field}`);
        }
    }

    parsedCredentials = parsed;
} catch (error) {
    console.error('Error parsing Google Cloud credentials:', error);
    throw new Error('Failed to initialize Google Cloud client. Check your credentials.');
}

let client: SpeechClient;
try {
    client = new SpeechClient({
        credentials: parsedCredentials,
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    });
} catch (error) {
    console.error('Error initializing Speech client:', error);
    throw new Error('Failed to initialize Google Cloud Speech client');
}

export async function POST(req: Request) {
    try {
        // Validate request
        if (!req.body) {
            return NextResponse.json(
                { error: 'Request body is empty' },
                { status: 400 }
            );
        }

        const formData = await req.formData();
        const audioFile = formData.get('audio') as Blob;

        if (!audioFile) {
            return NextResponse.json(
                { error: 'No audio file provided' },
                { status: 400 }
            );
        }

        if (audioFile.size === 0) {
            return NextResponse.json(
                { error: 'Audio file is empty' },
                { status: 400 }
            );
        }

        const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

        const audio = {
            content: audioBuffer.toString('base64'),
        };

        const config: protos.google.cloud.speech.v1.IRecognitionConfig = {
            encoding: protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.WEBM_OPUS,
            sampleRateHertz: 48000,
            languageCode: 'en-US',
            model: 'latest_long',
            useEnhanced: true,
            enableAutomaticPunctuation: true,
        };

        const recognizeRequest: protos.google.cloud.speech.v1.IRecognizeRequest = {
            audio: audio,
            config: config,
        };

        const [response] = await client.recognize(recognizeRequest);

        if (!response.results || response.results.length === 0) {
            return NextResponse.json(
                { error: 'No speech detected' },
                { status: 400 }
            );
        }

        const transcription = response.results
            .map(result => result.alternatives?.[0]?.transcript)
            .filter(Boolean)
            .join(' ');

        if (!transcription) {
            return NextResponse.json(
                { error: 'Failed to transcribe speech' },
                { status: 400 }
            );
        }

        return NextResponse.json({ text: transcription });
    } catch (error) {
        console.error('Transcription error:', error);

        // Handle specific error types
        if (error instanceof SyntaxError) {
            return NextResponse.json(
                { error: 'Invalid request format' },
                { status: 400 }
            );
        }

        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to transcribe audio',
                details: error instanceof Error ? error.stack : undefined
            },
            { status: 500 }
        );
    }
} 