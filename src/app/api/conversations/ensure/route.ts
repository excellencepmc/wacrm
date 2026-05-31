/**
 * POST /api/conversations/ensure
 * Find or create a conversation for a contact, then insert an outbound message.
 * Called after a broadcast/send so the message appears in the inbox.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { queryOne, execute } from '@/lib/db'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uid = session.user.id
  const { contact_id, phone, content_type, content_text, wamid } = await req.json() as {
    contact_id?: string; phone: string
    content_type?: string; content_text?: string; wamid?: string
  }

  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  // Find or create conversation
  let conv = await queryOne<{ id: string }>(
    `SELECT id FROM conversations WHERE user_id=$1 AND contact_id=$2 LIMIT 1`,
    [uid, contact_id ?? null],
  )
  if (!conv && contact_id) {
    conv = await queryOne<{ id: string }>(
      `INSERT INTO conversations(user_id, contact_id, phone, status, unread_count)
       VALUES ($1,$2,$3,'open',0) RETURNING id`,
      [uid, contact_id, phone],
    )
  }
  if (!conv) {
    // No contact_id — match by phone
    conv = await queryOne<{ id: string }>(
      `SELECT id FROM conversations WHERE user_id=$1 AND phone=$2 LIMIT 1`,
      [uid, phone],
    )
  }
  if (!conv) {
    conv = await queryOne<{ id: string }>(
      `INSERT INTO conversations(user_id, contact_id, phone, status, unread_count)
       VALUES ($1,$2,$3,'open',0) RETURNING id`,
      [uid, contact_id ?? null, phone],
    )
  }
  if (!conv) return NextResponse.json({ error: 'Could not create conversation' }, { status: 500 })

  // Insert outbound message
  if (wamid || content_text) {
    await execute(
      `INSERT INTO messages(conversation_id, user_id, direction, content_type, content_text, status, wamid, sent_at)
       VALUES ($1,$2,'outbound',$3,$4,'sent',$5,NOW())
       ON CONFLICT (wamid) DO NOTHING`,
      [conv.id, uid, content_type ?? 'template', content_text ?? null, wamid ?? null],
    )
    await execute(
      `UPDATE conversations SET last_message=$1, last_message_at=NOW(), updated_at=NOW() WHERE id=$2`,
      [content_text ?? `[${content_type ?? 'template'}]`, conv.id],
    )
  }

  return NextResponse.json({ conversation_id: conv.id })
}
