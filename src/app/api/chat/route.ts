import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { Mistral } from '@mistralai/mistralai';
import { AIModel } from '@/types';

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Mistral client
const mistral = process.env.MISTRAL_API_KEY ?
    new Mistral({ apiKey: process.env.MISTRAL_API_KEY }) :
    null;

export async function POST(req: Request) {
    try {
        const { message, model } = await req.json();
        const selectedModel = model as AIModel;

        if (!message) {
            return NextResponse.json(
                { error: 'No message provided' },
                { status: 400 }
            );
        }

        const messages = [
            {
                role: 'system' as const,
                content: 'You are a helpful AI assistant engaging in voice conversation. Keep responses concise and natural, as they will be spoken aloud.',
            },
            {
                role: 'user' as const,
                content: message,
            },
        ];

        switch (selectedModel.provider) {
            case 'openai': {
                const completion = await openai.chat.completions.create({
                    model: selectedModel.id,
                    messages,
                    max_tokens: selectedModel.maxTokens,
                    temperature: 0.7,
                });

                return NextResponse.json({
                    response: completion.choices[0]?.message?.content || ''
                });
            }

            case 'mistral': {
                if (!mistral) {
                    throw new Error('Mistral API key not configured');
                }

                const response = await mistral.chat.complete({
                    model: selectedModel.id,
                    messages: messages.map(msg => ({
                        role: msg.role === 'system' ? 'system' : 'user',
                        content: msg.content,
                    })),
                    maxTokens: selectedModel.maxTokens,
                    temperature: 0.7,
                });

                const content = response.choices?.[0]?.message?.content;
                return NextResponse.json({
                    response: typeof content === 'string' ? content : ''
                });
            }

            case 'google':
                // Handle Google models (implementation depends on Gemini API)
                throw new Error('Google models not yet implemented');

            default:
                throw new Error('Unsupported model provider');
        }
    } catch (error) {
        console.error('Chat error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to get AI response' },
            { status: 500 }
        );
    }
} 