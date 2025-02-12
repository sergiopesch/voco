import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';

export const Transcription = () => {
  const { voiceState, messages } = useStore();

  if (!voiceState.showTranscription) {
    return null;
  }

  return (
    <div className="fixed bottom-32 left-1/2 transform -translate-x-1/2 w-full max-w-2xl px-4">
      <AnimatePresence mode="wait">
        {messages.map((message) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`mb-4 p-4 rounded-lg ${
              message.role === 'user'
                ? 'bg-blue-100 ml-auto'
                : 'bg-gray-100 mr-auto'
            } max-w-[80%]`}
          >
            <p className="text-sm">
              <span className="font-semibold">
                {message.role === 'user' ? 'You' : 'AI'}:
              </span>{' '}
              {message.content}
            </p>
            <span className="text-xs text-gray-500">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>

      {voiceState.isListening && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-blue-100 p-4 rounded-lg ml-auto max-w-[80%]"
        >
          <p className="text-sm">
            <span className="font-semibold">You:</span>{' '}
            {voiceState.transcription || 'Listening...'}
          </p>
        </motion.div>
      )}
    </div>
  );
}; 