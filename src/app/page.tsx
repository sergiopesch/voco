'use client';

import { VoiceButton } from '@/components/VoiceButton';
import { ModelPanel } from '@/components/ModelPanel';
import { TranscriptionToggle } from '@/components/TranscriptionToggle';
import { Transcription } from '@/components/Transcription';
import { Cog6ToothIcon } from '@heroicons/react/24/solid';
import { useStore } from '@/store/useStore';
import { useAuth } from '@/components/AuthProvider';
import { AccountPanel } from '@/components/AccountPanel';
import { useState } from 'react';

export default function Home() {
  const { toggleModelPanel } = useStore();
  const { session } = useAuth();
  const [isAccountPanelOpen, setIsAccountPanelOpen] = useState(false);

  if (!session) {
    return null;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 p-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <div className="text-2xl font-bold text-gray-800">Voice AI</div>
            <button
              onClick={toggleModelPanel}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              title="AI Models"
            >
              <Cog6ToothIcon className="h-6 w-6 text-gray-600" />
            </button>
          </div>
          
          {session.user && (
            <button
              onClick={() => setIsAccountPanelOpen(true)}
              className="flex items-center space-x-2 p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              {session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture ? (
                <img
                  src={session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture}
                  alt={session.user.user_metadata?.full_name || session.user.user_metadata?.name || 'Profile'}
                  className="h-10 w-10 rounded-full object-cover border-2 border-gray-200"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center border-2 border-gray-200">
                  <span className="text-xl text-white font-semibold">
                    {session.user.email ? session.user.email.charAt(0).toUpperCase() : '?'}
                  </span>
                </div>
              )}
            </button>
          )}
        </div>
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

      {/* Account Panel */}
      <AccountPanel
        isOpen={isAccountPanelOpen}
        onClose={() => setIsAccountPanelOpen(false)}
        user={session.user}
      />
    </main>
  );
}
