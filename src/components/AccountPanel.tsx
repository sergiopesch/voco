import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon } from '@heroicons/react/24/solid';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/auth-helpers-nextjs';

interface AccountPanelProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

export function AccountPanel({ isOpen, onClose, user }: AccountPanelProps) {
  const router = useRouter();
  const supabase = createClientComponentClient();

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out', error);
    }
    router.push('/login');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black z-40"
          />
          
          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 20 }}
            className="fixed right-0 top-0 h-full w-80 bg-white shadow-lg p-6 z-50"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Account</h2>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-6">
              {/* Profile Section */}
              <div className="flex items-center space-x-4">
                {user.user_metadata?.avatar_url || user.user_metadata?.picture ? (
                  <img
                    src={user.user_metadata?.avatar_url || user.user_metadata?.picture}
                    alt={user.user_metadata?.full_name || user.user_metadata?.name || 'Profile'}
                    className="h-16 w-16 rounded-full object-cover border-2 border-gray-200"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-blue-500 flex items-center justify-center border-2 border-gray-200">
                    <span className="text-2xl text-white font-semibold">
                      {user.email ? user.email.charAt(0).toUpperCase() : '?'}
                    </span>
                  </div>
                )}
                <div>
                  <h3 className="font-semibold text-lg">
                    {user.user_metadata?.full_name || user.user_metadata?.name || 'User'}
                  </h3>
                  <p className="text-gray-600">{user.email}</p>
                </div>
              </div>

              {/* Account Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium mb-2">Account Details</h4>
                <div className="space-y-2 text-sm text-gray-600">
                  <p>Provider: {user.app_metadata.provider}</p>
                  <p>Last Sign In: {new Date(user.last_sign_in_at || '').toLocaleDateString()}</p>
                  <p>Account Created: {new Date(user.created_at || '').toLocaleDateString()}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t">
                <button
                  onClick={handleLogout}
                  className="w-full py-2 px-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
} 