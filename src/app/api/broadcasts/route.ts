import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, queryOne } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const broadcasts = await query(
    `SELECT *, total AS total_recipients
     FROM broadcasts WHERE user_id=$1 ORDER BY created_at DESC`,
    [session.user.id],
  )
  return NextResponse.json(broadcasts)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    name?: string; template_name?: string; template_language?: string; status?: string
  }
  if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const broadcast = await queryOne(
    `INSERT INTO broadcasts(user_id, name, template_name, template_language, status,
       total, sent_count, delivered_count, read_count, failed_count)
     VALUES ($1,$2,$3,$4,$5, 0,0,0,0,0)
     RETURNING *, total AS total_recipients`,
    [session.user.id, body.name.trim(), body.template_name ?? null,
     body.template_language ?? 'en_US', body.status ?? 'draft'],
  )
  return NextResponse.json(broadcast, { status: 201 })
}
