import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { queryOne, query } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const auto = await queryOne('SELECT id FROM automations WHERE id=$1 AND user_id=$2', [id, session.user!.id])
  if (!auto) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const logs = await query(
    `SELECT al.*, c.id AS "contact.id", c.name AS "contact.name", c.phone AS "contact.phone"
     FROM automation_logs al LEFT JOIN contacts c ON c.id=al.contact_id
     WHERE al.automation_id=$1 ORDER BY al.started_at DESC LIMIT 100`,
    [id],
  )
  return NextResponse.json({ logs })
}
