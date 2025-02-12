# Voice AI - Real-time Voice Interaction Platform

A modern web application built with Next.js that provides real-time voice interaction capabilities, similar to ChatGPT's voice mode. The application supports multiple AI models, real-time transcription, and text-to-speech conversion.

## Features

- 🎙️ Real-time voice capture and processing
- 🤖 Multiple AI model support (GPT-4, GPT-3.5, Gemini Pro)
- 🔄 Real-time transcription visualization
- 🗣️ Text-to-speech response playback
- 🔐 Secure authentication with Google and X (Twitter)
- 👥 Role-based access control
- 📱 Responsive and modern UI
- ⚡ Optimized performance with Next.js

## Prerequisites

Before you begin, ensure you have the following:

- Node.js (v18 or higher)
- npm or yarn
- A Supabase account for authentication
- OpenAI API key
- Google Cloud project with Speech-to-Text and Text-to-Speech APIs enabled

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd voice-ai
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file in the root directory with the following variables:
```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key

# Google Cloud Configuration
GOOGLE_CLOUD_PROJECT_ID=your_google_cloud_project_id
GOOGLE_CLOUD_CREDENTIALS=your_google_cloud_credentials

# Next Auth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret
```

4. Set up Supabase:
   - Create a new project in Supabase
   - Enable Google and Twitter authentication
   - Add the authentication callback URL: `http://localhost:3000/auth/callback`

5. Set up Google Cloud:
   - Create a new project
   - Enable Speech-to-Text and Text-to-Speech APIs
   - Create a service account and download the credentials JSON
   - Base64 encode the credentials JSON and set it as GOOGLE_CLOUD_CREDENTIALS

6. Run the development server:
```bash
npm run dev
```

## Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   ├── auth/              # Authentication routes
│   ├── login/             # Login page
│   └── page.tsx           # Main application page
├── components/            # React components
├── hooks/                 # Custom React hooks
├── lib/                   # Utility functions
├── store/                 # State management
└── types/                 # TypeScript types
```

## Key Components

- `VoiceButton`: Handles voice recording and provides visual feedback
- `ModelPanel`: Allows users to select different AI models
- `TranscriptionToggle`: Toggles the visibility of transcriptions
- `Transcription`: Displays real-time transcriptions and AI responses

## State Management

The application uses Zustand for state management, with the following main states:
- User authentication state
- Selected AI model
- Voice interaction state
- Message history

## API Routes

- `/api/transcribe`: Handles speech-to-text conversion
- `/api/chat`: Processes text with selected AI model
- `/api/text-to-speech`: Converts AI responses to speech

## Authentication

The application uses Supabase for authentication, supporting:
- Google OAuth
- Twitter/X OAuth
- Session management
- Protected routes

## Best Practices

- 🔒 Secure authentication with middleware protection
- 🎯 Type safety with TypeScript
- 🎨 Consistent styling with Tailwind CSS
- 🔄 Real-time state management with Zustand
- 📱 Responsive design for all devices
- 🚀 Optimized performance with Next.js App Router
- 🧩 Modular component architecture
- 🔍 Error handling and user feedback

## Deployment

The application is configured for deployment on Vercel:

1. Push your code to GitHub
2. Create a new project on Vercel
3. Connect your repository
4. Add environment variables
5. Deploy!

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
