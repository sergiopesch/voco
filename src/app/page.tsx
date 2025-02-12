'use client';

import { VoiceButton } from '@/components/VoiceButton';
import { ModelPanel } from '@/components/ModelPanel';
import { TranscriptionToggle } from '@/components/TranscriptionToggle';
import { Transcription } from '@/components/Transcription';
import { Cog6ToothIcon } from '@heroicons/react/24/solid';
import { useStore } from '@/store/useStore';
import { useAuth } from '@/components/AuthProvider';

export default function Home() {
  const { toggleModelPanel } = useStore();
  const { session } = useAuth();

  if (!session) {
    return null;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 p-4 flex justify-between items-center">
        <div className="text-2xl font-bold text-gray-800">Voice AI</div>
        <button
          onClick={toggleModelPanel}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <Cog6ToothIcon className="h-6 w-6 text-gray-600" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex flex-col items-center space-y-8">
        <VoiceButton />
        <TranscriptionToggle />
      </div>

      {/* Transcription */}
      <Transcription />

      {/* Model Selection Panel */}
      <ModelPanel />
    </main>
  );
}
