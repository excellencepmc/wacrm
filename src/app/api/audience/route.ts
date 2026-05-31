/**
 * Audience resolution endpoint — used by step2 (estimate) and
 * use-broadcast-sending (full contact list).
 *
 * POST /api/audience
 * Body: { type, tagIds?, excludeTagIds?, customFieldId?, customFieldOperator?, customFieldValue?, csvPhones? }
 * Returns: { contacts: [{id,name,phone}], count }
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, queryOne } from '@/lib/db'

interface AudienceRequest {
  type: 'all' | 'tags' | 'custom_field' | 'csv'
  tagIds?: string[]
  excludeTagIds?: string[]
  customFieldId?: string
  customFieldOperator?: 'is' | 'is_not' | 'contains'
  customFieldValue?: string
  csvPhones?: string[]          // for estimate only
  countOnly?: boolean
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const uid = session.user.id

  const body = await req.json() as AudienceRequest
  const { type, tagIds, excludeTagIds, customFieldId, customFieldOperator, customFieldValue, csvPhones, countOnly } = body

  // Resolve base contact IDs
  let contactIds: string[] = []

  if (type === 'all') {
    const rows = await query<{ id: string }>('SELECT id FROM contacts WHERE user_id=$1', [uid])
    contactIds = rows.map(r => r.id)
  } else if (type === 'tags' && tagIds?.length) {
    const rows = await query<{ contact_id: string }>(
      `SELECT DISTINCT ct.contact_id FROM contact_tags ct
       JOIN contacts c ON c.id=ct.contact_id
       WHERE ct.tag_id=ANY($1::uuid[]) AND c.user_id=$2`,
      [tagIds, uid],
    )
    contactIds = rows.map(r => r.contact_id)
  } else if (type === 'custom_field' && customFieldId && customFieldValue) {
    let op = '='
    let val: string = customFieldValue
    if (customFieldOperator === 'is_not') op = '!='
    if (customFieldOperator === 'contains') { op = 'ILIKE'; val = `%${customFieldValue}%` }

    const rows = await query<{ contact_id: string }>(
      `SELECT cv.contact_id FROM contact_custom_values cv
       JOIN contacts c ON c.id=cv.contact_id
       WHERE cv.custom_field_id=$1 AND cv.value ${op} $2 AND c.user_id=$3`,
      [customFieldId, val, uid],
    )
    contactIds = rows.map(r => r.contact_id)
  } else if (type === 'csv' && csvPhones?.length) {
    if (countOnly) return NextResponse.json({ count: csvPhones.length, contacts: [] })
    // Return existing contacts + mark unknowns
    const existing = await query<{ id: string; phone: string; name: string | null }>(
      `SELECT id, phone, name FROM contacts WHERE user_id=$1 AND phone=ANY($2::text[])`,
      [uid, csvPhones],
    )
    return NextResponse.json({ contacts: existing, count: csvPhones.length })
  }

  // Apply exclusions
  if (excludeTagIds?.length && contactIds.length) {
    const excluded = await query<{ contact_id: string }>(
      `SELECT DISTINCT contact_id FROM contact_tags WHERE tag_id=ANY($1::uuid[]) AND contact_id=ANY($2::uuid[])`,
      [excludeTagIds, contactIds],
    )
    const excludedSet = new Set(excluded.map(r => r.contact_id))
    contactIds = contactIds.filter(id => !excludedSet.has(id))
  }

  if (countOnly) return NextResponse.json({ count: contactIds.length, contacts: [] })

  if (!contactIds.length) return NextResponse.json({ count: 0, contacts: [] })

  const contacts = await query<{ id: string; phone: string; name: string | null }>(
    `SELECT id, phone, name FROM contacts WHERE id=ANY($1::uuid[])`,
    [contactIds],
  )

  return NextResponse.json({ count: contacts.length, contacts })
}
