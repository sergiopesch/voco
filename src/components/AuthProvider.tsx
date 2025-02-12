'use client';

import { createContext, useContext, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import type { Session } from '@supabase/auth-helpers-nextjs';
import { useStore } from '@/store/useStore';

const AuthContext = createContext<{
  session: Session | null;
}>({
  session: null,
});

export const useAuth = () => {
  return useContext(AuthContext);
};

export function AuthProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  const { setUser } = useStore();
  const router = useRouter();
  const supabase = createClientComponentClient();

  useEffect(() => {
    if (session?.user) {
      setUser({
        id: session.user.id,
        email: session.user.email || '',
        role: 'user',
        name: session.user.user_metadata.name,
        avatar_url: session.user.user_metadata.avatar_url,
      });
    } else {
      setUser(null);
      router.push('/login');
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          role: 'user',
          name: session.user.user_metadata.name,
          avatar_url: session.user.user_metadata.avatar_url,
        });
      } else {
        setUser(null);
        router.push('/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [session, setUser, router, supabase.auth]);

  return (
    <AuthContext.Provider value={{ session }}>{children}</AuthContext.Provider>
  );
} 