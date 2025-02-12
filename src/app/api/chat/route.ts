import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { default as MistralAI } from '@mistralai/mistralai';
import { AIModel } from '@/types';

// Initialize OpenAI client with better error handling
let openai: OpenAI;
try {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OpenAI API key is not configured');
    }
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
} catch (error) {
    console.error('Failed to initialize OpenAI client:', error);
}

// Initialize Mistral client with better error handling
let mistral: InstanceType<typeof MistralAI> | null = null;
try {
    if (process.env.MISTRAL_API_KEY) {
        mistral = new MistralAI(process.env.MISTRAL_API_KEY);
        console.log('Mistral client initialized successfully');
    }
} catch (error) {
    console.error('Failed to initialize Mistral client:', error);
}

export async function POST(req: Request) {
    try {
        const { message, model } = await req.json();
        const selectedModel = model as AIModel;

        console.log('Processing chat request:', {
            modelProvider: selectedModel.provider,
            modelId: selectedModel.id,
            messageLength: message?.length
        });

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
                if (!openai) {
                    throw new Error('OpenAI client is not initialized. Please check your API key configuration.');
                }

                console.log('Sending request to OpenAI...');
                const completion = await openai.chat.completions.create({
                    model: selectedModel.id,
                    messages,
                    max_tokens: selectedModel.maxTokens,
                    temperature: 0.7,
                });

                const response = completion.choices[0]?.message?.content || '';
                console.log('Received response from OpenAI:', { responseLength: response.length });

                return NextResponse.json({ response });
            }

            case 'mistral': {
                if (!mistral) {
                    throw new Error('Mistral client is not initialized. Please check your API key configuration.');
                }

                console.log('Sending request to Mistral with model:', selectedModel.id);
                try {
                    const chatResponse = await mistral.chat({
                        model: selectedModel.id,
                        messages: messages.map(msg => ({
                            role: msg.role,
                            content: msg.content,
                        })),
                        temperature: 0.7,
                        maxTokens: selectedModel.maxTokens,
                    });

                    if (!chatResponse.choices?.[0]?.message?.content) {
                        console.error('Invalid Mistral response:', chatResponse);
                        throw new Error('No response content from Mistral');
                    }

                    const content = chatResponse.choices[0].message.content;
                    console.log('Processed Mistral response:', { responseLength: content.length });
                    return NextResponse.json({ response: content });
                } catch (mistralError) {
                    console.error('Mistral API error:', mistralError);
                    throw mistralError;
                }
            }

            case 'google':
                throw new Error('Google models are not yet implemented');

            default:
                throw new Error(`Unsupported model provider: ${selectedModel.provider}`);
        }
    } catch (error) {
        console.error('Chat error:', error);

        // Provide more specific error messages
        let errorMessage = 'Failed to get AI response';
        let statusCode = 500;

        if (error instanceof Error) {
            if (error.message.includes('API key')) {
                errorMessage = 'API key configuration error. Please check your environment variables.';
                statusCode = 401;
            } else if (error.message.includes('not initialized')) {
                errorMessage = 'AI service is not properly configured.';
                statusCode = 503;
            } else {
                errorMessage = error.message;
            }
        }

        return NextResponse.json(
            {
                error: errorMessage,
                details: error instanceof Error ? error.stack : undefined
            },
            { status: statusCode }
        );
    }
} 