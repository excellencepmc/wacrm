import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, execute, queryOne } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership
  const conv = await queryOne('SELECT id FROM conversations WHERE id=$1 AND user_id=$2', [id, session.user.id])
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const messages = await query(
    'SELECT * FROM messages WHERE conversation_id=$1 ORDER BY sent_at ASC, created_at ASC',
    [id],
  )
  return NextResponse.json(messages)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { unread_count?: number; status?: string; assigned_to?: string | null }

  const fields: string[] = [], vals: unknown[] = []
  if ('unread_count' in body) { fields.push(`unread_count=$${fields.length+1}`); vals.push(body.unread_count) }
  if ('status' in body)       { fields.push(`status=$${fields.length+1}`);       vals.push(body.status) }
  if ('assigned_to' in body)  { fields.push(`assigned_to=$${fields.length+1}`);  vals.push(body.assigned_to) }

  if (!fields.length) return NextResponse.json({ ok: true })

  vals.push(id, session.user.id)
  await execute(
    `UPDATE conversations SET ${fields.join(',')} WHERE id=$${vals.length-1} AND user_id=$${vals.length}`,
    vals,
  )
  return NextResponse.json({ ok: true })
}
