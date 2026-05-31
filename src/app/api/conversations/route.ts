import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const conversations = await query(
    `SELECT c.*,
       json_build_object('id', ct.id, 'name', ct.name, 'phone', ct.phone,
         'email', ct.email, 'company', ct.company, 'avatar_url', ct.avatar_url) AS contact
     FROM conversations c
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.user_id = $1
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
    [session.user.id],
  )
  return NextResponse.json(conversations)
}
