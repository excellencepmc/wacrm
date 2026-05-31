import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-compatible auth config — no database imports.
 * Used by middleware (Edge Runtime) and merged into the full auth.ts.
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/login',
    error:  '/login',
  },
  session: { strategy: 'jwt' },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id   = user.id
        token.role = (user as typeof user & { role?: string }).role
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        ;(session.user as typeof session.user & { role?: string }).role = token.role as string
      }
      return session
    },
  },
  providers: [], // filled in by auth.ts — empty here for edge compat
}
