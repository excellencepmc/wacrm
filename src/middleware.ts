import NextAuth from 'next-auth'
import { authConfig } from './auth.config'
import { NextResponse } from 'next/server'

const AUTH_PAGES      = ['/login', '/signup', '/forgot-password']
const PROTECTED_PATHS = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings']

// Use the edge-compatible config (no pg / db imports) for middleware
const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn   = !!req.auth

  if (isLoggedIn && AUTH_PAGES.some(p => pathname === p)) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  if (!isLoggedIn && PROTECTED_PATHS.some(p => pathname.startsWith(p))) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (!isLoggedIn &&
      pathname.startsWith('/api/whatsapp/') &&
      !pathname.includes('/webhook')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
})

export const config = {
  matcher: [
    // Exclude NextAuth API routes — they handle their own CSRF cookies.
    // Including them causes two conflicting CSRF tokens to be set.
    '/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
