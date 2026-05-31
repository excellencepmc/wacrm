import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profiles = await query(
    'SELECT id, full_name, email, avatar_url, role FROM profiles WHERE user_id=$1',
    [session.user.id],
  )
  return NextResponse.json(profiles)
}
