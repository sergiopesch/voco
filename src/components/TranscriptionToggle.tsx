import { Switch } from '@headlessui/react';
import { useStore } from '@/store/useStore';
import { ChatBubbleBottomCenterTextIcon } from '@heroicons/react/24/solid';

export const TranscriptionToggle = () => {
  const { voiceState, updateVoiceState } = useStore();

  return (
    <div className="flex items-center space-x-2">
      <ChatBubbleBottomCenterTextIcon className="h-5 w-5 text-gray-600" />
      <Switch
        checked={voiceState.showTranscription}
        onChange={(checked) => updateVoiceState({ showTranscription: checked })}
        className={`${
          voiceState.showTranscription ? 'bg-blue-500' : 'bg-gray-300'
        } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
      >
        <span className="sr-only">Show transcription</span>
        <span
          className={`${
            voiceState.showTranscription ? 'translate-x-6' : 'translate-x-1'
          } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
        />
      </Switch>
      <span className="text-sm text-gray-600">Show Transcription</span>
    </div>
  );
}; 