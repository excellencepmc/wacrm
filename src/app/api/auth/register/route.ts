import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { queryOne, execute } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const { fullName, email, password } = await req.json() as {
      fullName: string; email: string; password: string
    }

    if (!fullName?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    const hash = await bcrypt.hash(password, 12)
    await execute(
      'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3)',
      [email.toLowerCase(), hash, fullName.trim()],
    )

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error('[register]', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
