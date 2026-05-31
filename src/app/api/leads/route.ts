import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, queryOne } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url  = req.nextUrl
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0))
  const limit = 25
  const search = url.searchParams.get('search')?.trim() ?? ''

  const where = search
    ? `WHERE phone ILIKE $3 OR tag ILIKE $3 OR requirement::text ILIKE $3`
    : ''
  const params: unknown[] = [limit, page * limit]
  if (search) params.push(`%${search}%`)

  const [leads, countRow] = await Promise.all([
    query(
      `SELECT id, phone, name, tag, requirement, created_at
       FROM property_leads ${where}
       ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params,
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count FROM property_leads ${where}`,
      search ? [`%${search}%`] : [],
    ),
  ])

  return NextResponse.json({ leads, total: Number(countRow?.count ?? 0) })
}
