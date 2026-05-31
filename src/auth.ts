import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { queryOne } from '@/lib/db'
import { authConfig } from './auth.config'

interface DbUser {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  role: string
  password_hash: string
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await queryOne<DbUser>(
          'SELECT id, email, full_name, avatar_url, role, password_hash FROM users WHERE email = $1',
          [credentials.email],
        )
        if (!user) return null

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password_hash,
        )
        if (!valid) return null

        return {
          id:    user.id,
          email: user.email,
          name:  user.full_name,
          image: user.avatar_url,
          role:  user.role,
        }
      },
    }),
  ],
})
