import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { AIModel } from '@/types';
import { XMarkIcon } from '@heroicons/react/24/solid';

const models: AIModel[] = [
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    description: 'Most capable GPT-4 model, great for voice interactions.',
    maxTokens: 150,
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'openai',
    description: 'Faster responses, good balance of capability and speed.',
    maxTokens: 150,
  },
  {
    id: 'gemini-pro',
    name: 'Gemini Pro',
    provider: 'google',
    description: 'Google\'s advanced language model for voice interactions.',
    maxTokens: 150,
  },
];

export const ModelPanel = () => {
  const { isModelPanelOpen, toggleModelPanel, selectedModel, setSelectedModel } = useStore();

  return (
    <AnimatePresence>
      {isModelPanelOpen && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 20 }}
          className="fixed right-0 top-0 h-full w-80 bg-white shadow-lg p-6 z-50"
        >
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">Select Model</h2>
            <button
              onClick={toggleModelPanel}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="space-y-4">
            {models.map((model) => (
              <motion.button
                key={model.id}
                onClick={() => {
                  setSelectedModel(model);
                  toggleModelPanel();
                }}
                className={`w-full p-4 rounded-lg border ${
                  selectedModel?.id === model.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300'
                } transition-all`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className="text-left">
                  <h3 className="font-semibold">{model.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {model.description}
                  </p>
                </div>
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}; 