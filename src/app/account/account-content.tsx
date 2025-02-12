'use client';

import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';
import type { User } from '@supabase/auth-helpers-nextjs';

interface AccountContentProps {
  user: User;
}

export function AccountContent({ user }: AccountContentProps) {
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
    <div className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-md mx-auto bg-white p-6 rounded-xl shadow-md">
        <div className="flex items-center space-x-4">
          {user.user_metadata?.avatar_url ? (
            <img
              src={user.user_metadata.avatar_url}
              alt="Profile"
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="h-16 w-16 rounded-full bg-gray-300 flex items-center justify-center">
              <span className="text-2xl text-white">
                {user.email ? user.email.charAt(0).toUpperCase() : '?'}
              </span>
            </div>
          )}
          <div>
            <h2 className="text-xl font-bold">
              {user.user_metadata?.full_name || user.email}
            </h2>
            <p className="text-gray-500">{user.email}</p>
          </div>
        </div>
        <div className="mt-4">
          <p className="text-gray-700">
            Manage your account details, update your profile, and review your recent activity.
          </p>
        </div>
        <div className="mt-6 flex justify-between items-center">
          <button 
            onClick={handleLogout} 
            className="py-2 px-4 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            Log Out
          </button>
          <Link href="/" className="py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
} 