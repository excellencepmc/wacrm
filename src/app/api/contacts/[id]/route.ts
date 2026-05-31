import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, queryOne, execute } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [deals, notes, tags] = await Promise.all([
    query(
      `SELECT d.*, json_build_object('id',ps.id,'name',ps.name,'color',ps.color) AS stage
       FROM deals d LEFT JOIN pipeline_stages ps ON ps.id=d.stage_id
       WHERE d.contact_id=$1 AND d.user_id=$2 ORDER BY d.created_at DESC`,
      [id, session.user.id],
    ),
    query('SELECT * FROM contact_notes WHERE contact_id=$1 ORDER BY created_at DESC', [id]),
    query(
      `SELECT ct.id AS contact_tag_id, t.* FROM contact_tags ct
       JOIN tags t ON t.id=ct.tag_id WHERE ct.contact_id=$1`,
      [id],
    ),
  ])
  return NextResponse.json({ deals, notes, tags })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as Record<string, unknown>
  const allowed = ['name','phone','email','company','avatar_url']
  const fields: string[] = [], vals: unknown[] = []
  for (const k of allowed) {
    if (k in body) { fields.push(`${k}=$${fields.length+1}`); vals.push(body[k]) }
  }
  if (!fields.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  vals.push(id, session.user.id)
  await execute(
    `UPDATE contacts SET ${fields.join(',')} WHERE id=$${vals.length-1} AND user_id=$${vals.length}`,
    vals,
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await execute('DELETE FROM contacts WHERE id=$1 AND user_id=$2', [id, session.user.id])
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { note_text } = await req.json() as { note_text: string }
  if (!note_text?.trim()) return NextResponse.json({ error: 'note_text required' }, { status: 400 })

  const note = await queryOne(
    'INSERT INTO contact_notes(contact_id,user_id,note_text) VALUES($1,$2,$3) RETURNING *',
    [id, session.user.id, note_text.trim()],
  )
  return NextResponse.json(note, { status: 201 })
}
