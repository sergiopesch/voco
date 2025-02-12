'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import type { Session } from '@supabase/auth-helpers-nextjs';
import { useStore } from '@/store/useStore';

const AuthContext = createContext<{
  session: Session | null;
  isLoading: boolean;
}>({
  session: null,
  isLoading: true,
});

export const useAuth = () => {
  return useContext(AuthContext);
};

export function AuthProvider({
  children,
  session: initialSession,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  const { setUser } = useStore();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(initialSession);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      // Check if required environment variables are set
      if (
        typeof window !== 'undefined' && // Only check on client side
        (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
          !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      ) {
        console.error('Missing Supabase environment variables');
        router.push('/error');
        return;
      }

      const supabase = createClientComponentClient();

      // Update session if it changes
      setSession(initialSession);

      if (initialSession?.user) {
        setUser({
          id: initialSession.user.id,
          email: initialSession.user.email || '',
          role: 'user',
          name: initialSession.user.user_metadata?.full_name || initialSession.user.user_metadata?.name,
          avatar_url: initialSession.user.user_metadata?.avatar_url || initialSession.user.user_metadata?.picture,
        });
      } else {
        setUser(null);
        if (window.location.pathname !== '/error') {
          router.push('/login');
        }
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setSession(session);
        if (session?.user) {
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            role: 'user',
            name: session.user.user_metadata?.full_name || session.user.user_metadata?.name,
            avatar_url: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture,
          });
        } else {
          setUser(null);
          if (window.location.pathname !== '/error') {
            router.push('/login');
          }
        }
      });

      setIsLoading(false);

      return () => {
        subscription.unsubscribe();
      };
    } catch (error) {
      console.error('Error in AuthProvider:', error);
      setIsLoading(false);
      router.push('/error');
    }
  }, [initialSession, setUser, router]);

  return (
    <AuthContext.Provider value={{ session, isLoading }}>
      {!isLoading && children}
    </AuthContext.Provider>
  );
} 