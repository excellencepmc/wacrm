import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, queryOne } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uid    = session.user.id
  const search = req.nextUrl.searchParams.get('search') ?? ''
  const page   = parseInt(req.nextUrl.searchParams.get('page') ?? '0', 10)
  const limit  = parseInt(req.nextUrl.searchParams.get('limit') ?? '25', 10)
  const offset = page * limit

  const whereBase = 'WHERE c.user_id = $1'
  const params: unknown[] = [uid]

  let whereClause = whereBase
  if (search.trim()) {
    params.push(`%${search.trim()}%`)
    const n = params.length
    whereClause += ` AND (c.name ILIKE $${n} OR c.phone ILIKE $${n} OR c.email ILIKE $${n})`
  }

  const [countRow, contacts] = await Promise.all([
    queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM contacts c ${whereClause}`,
      params,
    ),
    query(
      `SELECT c.* FROM contacts c ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
  ])

  const total = parseInt(countRow?.count ?? '0', 10)

  // Fetch tags for this page of contacts
  if (contacts.length) {
    const ids = contacts.map((c: Record<string,unknown>) => c.id)
    const tagRows = await query(
      `SELECT ct.contact_id, t.* FROM contact_tags ct
       JOIN tags t ON t.id = ct.tag_id
       WHERE ct.contact_id = ANY($1::uuid[])`,
      [ids],
    )
    const tagsByContact: Record<string, unknown[]> = {}
    for (const row of tagRows as Array<{ contact_id: string } & Record<string,unknown>>) {
      const { contact_id, ...tag } = row
      if (!tagsByContact[contact_id]) tagsByContact[contact_id] = []
      tagsByContact[contact_id].push(tag)
    }
    for (const c of contacts as Array<Record<string,unknown>>) {
      (c as Record<string,unknown>).tags = tagsByContact[c.id as string] ?? []
    }
  }

  return NextResponse.json({ contacts, total, page, limit })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, phone, email, company, avatar_url } = await req.json() as Record<string, string>
  if (!phone?.trim()) return NextResponse.json({ error: 'phone is required' }, { status: 400 })

  const contact = await queryOne(
    `INSERT INTO contacts(user_id, name, phone, email, company, avatar_url)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [session.user.id, name||null, phone.trim(), email||null, company||null, avatar_url||null],
  )
  return NextResponse.json(contact, { status: 201 })
}
