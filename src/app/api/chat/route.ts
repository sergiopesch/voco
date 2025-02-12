import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
    try {
        const { message } = await req.json();

        if (!message) {
            return NextResponse.json(
                { error: 'No message provided' },
                { status: 400 }
            );
        }

        const completion = await openai.chat.completions.create({
            model: 'gpt-4-turbo-preview',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful AI assistant engaging in voice conversation. Keep responses concise and natural, as they will be spoken aloud.',
                },
                {
                    role: 'user',
                    content: message,
                },
            ],
            max_tokens: 150,
            temperature: 0.7,
        });

        const response = completion.choices[0]?.message?.content || '';

        return NextResponse.json({ response });
    } catch (error) {
        console.error('Chat error:', error);
        return NextResponse.json(
            { error: 'Failed to get AI response' },
            { status: 500 }
        );
    }
} 