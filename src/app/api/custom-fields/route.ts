import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const fields = await query(
    'SELECT * FROM custom_fields WHERE user_id=$1 ORDER BY name',
    [session.user.id],
  )
  return NextResponse.json(fields)
}
