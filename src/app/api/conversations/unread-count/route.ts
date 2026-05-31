import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { queryOne } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const row = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::int AS count FROM conversations WHERE user_id = $1 AND unread_count > 0',
    [session.user.id],
  )
  return NextResponse.json({ count: row?.count ?? 0 })
}
