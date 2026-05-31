import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, execute } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tags = await query(
    `SELECT ct.id, ct.contact_id, ct.tag_id FROM contact_tags ct
     JOIN contacts c ON c.id = ct.contact_id
     WHERE ct.contact_id=$1 AND c.user_id=$2`,
    [id, session.user.id],
  )
  return NextResponse.json(tags)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tag_ids = [] } = await req.json() as { tag_ids: string[] }

  await execute('DELETE FROM contact_tags WHERE contact_id=$1', [id])
  for (const tag_id of tag_ids) {
    await execute(
      'INSERT INTO contact_tags(contact_id, tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [id, tag_id],
    )
  }
  return NextResponse.json({ ok: true })
}
