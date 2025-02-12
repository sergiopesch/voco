import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AccountContent } from './account-content';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const cookieStore = cookies();
  const supabase = createServerComponentClient({ cookies: () => cookieStore });
  
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      redirect('/login');
    }

    return <AccountContent user={user} />;
  } catch (error) {
    console.error('Error in AccountPage:', error);
    redirect('/error');
  }
} 