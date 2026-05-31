import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { queryOne, query, execute } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const broadcast = await queryOne(
    'SELECT *, total AS total_recipients FROM broadcasts WHERE id=$1 AND user_id=$2',
    [id, session.user.id],
  )
  if (!broadcast) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await query(
    `SELECT br.id, br.broadcast_id, br.contact_id, br.phone, br.status,
            br.wamid, br.error, br.sent_at, br.delivered_at, br.read_at,
            br.variables, br.created_at,
            c.name AS contact_name, c.phone AS contact_phone
     FROM broadcast_recipients br
     LEFT JOIN contacts c ON c.id = br.contact_id
     WHERE br.broadcast_id=$1
     ORDER BY br.created_at DESC`,
    [id],
  )

  // Shape recipients to match what the UI expects: nested contact object
  const recipients = rows.map((r: Record<string, unknown>) => ({
    ...r,
    contact: {
      id: r.contact_id,
      name: r.contact_name as string | null,
      phone: (r.contact_phone ?? r.phone) as string,  // fallback to denormalized phone
    },
  }))

  return NextResponse.json({ broadcast, recipients })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await execute('DELETE FROM broadcasts WHERE id=$1 AND user_id=$2', [id, session.user.id])
  return NextResponse.json({ ok: true })
}
