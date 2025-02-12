import { NextResponse } from 'next/server';
import { SpeechClient } from '@google-cloud/speech';
import { protos } from '@google-cloud/speech';

const client = new SpeechClient({
    credentials: JSON.parse(process.env.GOOGLE_CLOUD_CREDENTIALS || '{}'),
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const audioFile = formData.get('audio') as Blob;

        if (!audioFile) {
            return NextResponse.json(
                { error: 'No audio file provided' },
                { status: 400 }
            );
        }

        const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

        const audio = {
            content: audioBuffer.toString('base64'),
        };

        const config: protos.google.cloud.speech.v1.IRecognitionConfig = {
            encoding: protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.LINEAR16,
            sampleRateHertz: 48000,
            languageCode: 'en-US',
        };

        const recognizeRequest: protos.google.cloud.speech.v1.IRecognizeRequest = {
            audio: audio,
            config: config,
        };

        const [response] = await client.recognize(recognizeRequest);
        const transcription = response.results
            ?.map((result: protos.google.cloud.speech.v1.ISpeechRecognitionResult) =>
                result.alternatives?.[0]?.transcript)
            .join('\n');

        return NextResponse.json({ text: transcription || '' });
    } catch (error) {
        console.error('Transcription error:', error);
        return NextResponse.json(
            { error: 'Failed to transcribe audio' },
            { status: 500 }
        );
    }
} 