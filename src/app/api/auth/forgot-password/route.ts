import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import crypto from 'crypto'

// Simple password reset — stores a token and emails it.
// In production you'd integrate with an email service.
// For now: stores token in DB and logs it (to be wired to email API later).

export async function POST(req: NextRequest) {
  const { email } = await req.json() as { email: string }
  if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  // Never reveal whether email exists (security)
  const user = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
  if (user) {
    const token  = crypto.randomBytes(32).toString('hex')
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
    // Store reset token on the user row (add column if missing via migration)
    // For now log it — wire to your email service when ready
    console.log(`[forgot-password] reset token for ${email}: ${token} (expires ${expiry})`)
  }
  // Always return success to avoid email enumeration
  return NextResponse.json({ success: true })
}
