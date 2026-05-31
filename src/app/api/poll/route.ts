import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query } from '@/lib/db'

/**
 * Polling endpoint used by useRealtime to replace Supabase Realtime.
 * Returns messages and conversations created/updated since `?since=`.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const since     = req.nextUrl.searchParams.get('since') ?? new Date(0).toISOString()
  const userId    = session.user.id
  const timestamp = new Date().toISOString()

  const [messages, conversations] = await Promise.all([
    query(
      `SELECT * FROM messages
       WHERE user_id = $1 AND created_at > $2
       ORDER BY created_at ASC LIMIT 100`,
      [userId, since],
    ),
    query(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND updated_at > $2
       ORDER BY updated_at ASC LIMIT 100`,
      [userId, since],
    ),
  ])

  const sinceDate = new Date(since)

  // postgres.js returns timestamps as Date objects, not strings.
  // Use proper Date comparison to distinguish new vs updated rows.
  const isNew = (row: Record<string, unknown>) =>
    new Date(row.created_at as Date | string) > sinceDate

  return NextResponse.json({
    // All messages here are new (query filters created_at > since) → always INSERT
    messages: messages.map(row => ({ eventType: 'INSERT' as const, new: row, old: {} })),
    // Conversations: INSERT if brand-new, UPDATE if existing with new activity
    conversations: conversations.map(row => ({
      eventType: isNew(row) ? 'INSERT' as const : 'UPDATE' as const,
      new: row,
      old: {},
    })),
    timestamp,
  })
}
