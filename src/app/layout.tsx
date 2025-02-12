import './globals.css';
import { GeistSans } from 'geist/font/sans';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { AuthProvider } from '@/components/AuthProvider';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Voice AI',
  description: 'Real-time voice interaction powered by AI',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let session = null;

  try {
    // Verify environment variables
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error('Missing Supabase environment variables');
      redirect('/error');
    }

    const supabase = createServerComponentClient({ cookies });
    const { data } = await supabase.auth.getUser();

    if (data.user) {
      session = {
        access_token: '',
        expires_in: 0,
        refresh_token: '',
        token_type: '',
        user: data.user,
      };
    }
  } catch (error) {
    console.error('Error in RootLayout:', error);
    if (error instanceof Error && !error.message.includes('NEXT_REDIRECT')) {
      redirect('/error');
    }
    throw error; // Re-throw redirect errors
  }

  return (
    <html lang="en">
      <body className={GeistSans.className} suppressHydrationWarning>
        <AuthProvider session={session}>{children}</AuthProvider>
      </body>
    </html>
  );
}
