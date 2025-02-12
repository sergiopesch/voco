import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
    const res = NextResponse.next();
    const supabase = createMiddlewareClient({ req: request, res });

    const {
        data: { session },
    } = await supabase.auth.getSession();

    // If the user is not signed in and the current path is not /login,
    // redirect the user to /login
    if (!session && request.nextUrl.pathname !== '/login') {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = '/login';
        return NextResponse.redirect(redirectUrl);
    }

    // If the user is signed in and the current path is /login,
    // redirect the user to /
    if (session && request.nextUrl.pathname === '/login') {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = '/';
        return NextResponse.redirect(redirectUrl);
    }

    return res;
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/callback).*)'],
}; 