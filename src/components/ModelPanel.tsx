import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store/useStore';
import { AIModel } from '@/types';
import { XMarkIcon } from '@heroicons/react/24/solid';

const models: { category: string; models: AIModel[] }[] = [
  {
    category: 'Speech-to-Text',
    models: [
      {
        id: 'google-speech-v1',
        name: 'Google Speech API',
        provider: 'google',
        description: 'High-accuracy speech recognition for voice input.',
        maxTokens: 0,
        contextWindow: 0,
      }
    ]
  },
  {
    category: 'Text Generation',
    models: [
      {
        id: 'gpt-4',
        name: 'GPT-4',
        provider: 'openai',
        description: 'Most capable model for understanding and generating responses.',
        maxTokens: 150,
        contextWindow: 8192,
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        provider: 'openai',
        description: 'Fast and efficient for most conversations.',
        maxTokens: 150,
        contextWindow: 4096,
      }
    ]
  },
  {
    category: 'Text-to-Speech',
    models: [
      {
        id: 'google-tts-neural2',
        name: 'Google Neural2 Voice',
        provider: 'google',
        description: 'High-quality neural text-to-speech with natural intonation.',
        maxTokens: 0,
        contextWindow: 0,
      }
    ]
  }
];

export const ModelPanel = () => {
  const { isModelPanelOpen, toggleModelPanel, selectedModel, setSelectedModel } = useStore();

  return (
    <AnimatePresence>
      {isModelPanelOpen && (
        <motion.div
          initial={{ x: '-100%' }}
          animate={{ x: 0 }}
          exit={{ x: '-100%' }}
          transition={{ type: 'spring', damping: 20 }}
          className="fixed left-0 top-0 h-full w-80 bg-white shadow-lg p-6 z-50 overflow-y-auto"
        >
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">AI Models</h2>
            <button
              onClick={toggleModelPanel}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="space-y-8">
            {models.map(({ category, models: categoryModels }) => (
              <div key={category} className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                  {category}
                </h3>
                <div className="space-y-2">
                  {categoryModels.map((model) => (
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
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold">{model.name}</h3>
                          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                            {model.provider}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          {model.description}
                        </p>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}; 