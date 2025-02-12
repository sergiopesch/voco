import { NextResponse } from 'next/server';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { protos } from '@google-cloud/text-to-speech';

const client = new TextToSpeechClient({
    credentials: JSON.parse(process.env.GOOGLE_CLOUD_CREDENTIALS || '{}'),
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

export async function POST(req: Request) {
    try {
        const { text } = await req.json();

        if (!text) {
            return NextResponse.json(
                { error: 'No text provided' },
                { status: 400 }
            );
        }

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
            },
        };

        const [response] = await client.synthesizeSpeech(request);
        const audioContent = response.audioContent;

        if (!audioContent) {
            throw new Error('No audio content generated');
        }

        // Convert Buffer to Base64
        const audioBuffer = Buffer.from(audioContent);

        return new NextResponse(audioBuffer, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBuffer.length.toString(),
            },
        });
    } catch (error) {
        console.error('Text-to-speech error:', error);
        return NextResponse.json(
            { error: 'Failed to convert text to speech' },
            { status: 500 }
        );
    }
} 