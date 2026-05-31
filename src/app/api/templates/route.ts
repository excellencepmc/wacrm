import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, queryOne, execute } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const templates = await query(
    'SELECT * FROM message_templates WHERE user_id=$1 ORDER BY name',
    [session.user.id],
  )
  return NextResponse.json(templates)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    name: string; language?: string; category?: string; status?: string
    header_type?: string; header_text?: string; body_text: string; footer_text?: string; buttons?: unknown[]
  }
  if (!body.name?.trim() || !body.body_text?.trim())
    return NextResponse.json({ error: 'name and body_text are required' }, { status: 400 })

  const t = await queryOne(
    `INSERT INTO message_templates(user_id,name,language,category,status,header_type,header_text,body_text,footer_text,buttons)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [session.user.id, body.name.trim(), body.language??'en_US', body.category??'MARKETING',
     body.status??'APPROVED', body.header_type??null, body.header_text??null,
     body.body_text.trim(), body.footer_text??null, JSON.stringify(body.buttons??[])],
  )
  return NextResponse.json(t, { status: 201 })
}
