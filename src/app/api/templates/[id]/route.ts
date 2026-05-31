import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { execute } from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as Record<string, unknown>
  const allowed = ['name','language','category','status','header_type','header_text','body_text','footer_text','buttons']
  const fields: string[] = [], vals: unknown[] = []
  for (const k of allowed) {
    if (k in body) {
      fields.push(`${k}=$${fields.length+1}`)
      vals.push(k === 'buttons' ? JSON.stringify(body[k]) : body[k])
    }
  }
  if (!fields.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  vals.push(id, session.user.id)
  await execute(
    `UPDATE message_templates SET ${fields.join(',')} WHERE id=$${vals.length-1} AND user_id=$${vals.length}`,
    vals,
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await execute('DELETE FROM message_templates WHERE id=$1 AND user_id=$2', [id, session.user.id])
  return NextResponse.json({ ok: true })
}
