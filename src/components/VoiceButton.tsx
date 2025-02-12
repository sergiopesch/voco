import { motion } from 'framer-motion';
import { useVoiceInteraction } from '@/hooks/useVoiceInteraction';
import { MicrophoneIcon } from '@heroicons/react/24/solid';

export const VoiceButton = () => {
  const { startListening, stopListening, isListening, isProcessing } = useVoiceInteraction();

  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <motion.button
      onClick={handleClick}
      className={`relative rounded-full p-4 ${
        isListening ? 'bg-red-500' : 'bg-blue-500'
      } text-white shadow-lg hover:shadow-xl transition-all`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <MicrophoneIcon className="h-8 w-8" />
      {(isListening || isProcessing) && (
        <motion.div
          className="absolute -inset-2 rounded-full border-4 border-current"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.2, 0.5, 0.2],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}
    </motion.button>
  );
}; 