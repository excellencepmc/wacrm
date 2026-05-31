import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { queryOne, execute } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaTemplate { id:string; name:string; language:string; status:string; category:string; components?:{type:string;text?:string;format?:string}[] }

function normalizeCategory(m: string): string { const u=m.toUpperCase(); if(u==='UTILITY') return 'Utility'; if(u==='AUTHENTICATION') return 'Authentication'; return 'Marketing' }
function normalizeStatus(m: string): string { switch(m.toUpperCase()) { case 'APPROVED': return 'Approved'; case 'PENDING': case 'IN_APPEAL': case 'PENDING_DELETION': return 'Pending'; case 'REJECTED': case 'DISABLED': case 'PAUSED': return 'Rejected'; default: return 'Draft' } }

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = session.user.id

    const config = await queryOne<{ waba_id:string|null; phone_number_id:string; access_token:string }>(
      'SELECT waba_id, phone_number_id, access_token FROM whatsapp_config WHERE user_id=$1', [userId],
    )
    if (!config) return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 })
    if (!config.waba_id) return NextResponse.json({ error: 'WABA ID missing. Re-connect in Settings.' }, { status: 400 })

    const accessToken = decrypt(config.access_token)
    const metaTemplates: MetaTemplate[] = []
    let nextUrl: string|null = `${META_API_BASE}/${config.waba_id}/message_templates?limit=100&fields=id,name,language,status,category,components`
    let pages = 0
    while (nextUrl && pages < 20) {
      pages++
      const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!res.ok) {
        let msg = `Meta API error: ${res.status}`
        try { const b = await res.json(); if (b?.error?.message) msg = b.error.message } catch {}
        return NextResponse.json({ error: msg }, { status: 502 })
      }
      const body: { data?:MetaTemplate[]; paging?:{next?:string} } = await res.json()
      if (body.data) metaTemplates.push(...body.data)
      nextUrl = body.paging?.next ?? null
    }

    let inserted=0, updated=0
    const errors: {name:string;language:string;message:string}[] = []

    for (const t of metaTemplates) {
      const bdy = (t.components??[]).find(c=>c.type==='BODY')
      const hdr = (t.components??[]).find(c=>c.type==='HEADER')
      const ftr = (t.components??[]).find(c=>c.type==='FOOTER')
      try {
        const existing = await queryOne<{id:string}>('SELECT id FROM message_templates WHERE user_id=$1 AND name=$2 AND language=$3', [userId, t.name, t.language])
        if (existing?.id) {
          await execute(
            `UPDATE message_templates SET category=$1,header_type=$2,body_text=$3,footer_text=$4,status=$5,updated_at=NOW() WHERE id=$6`,
            [normalizeCategory(t.category), hdr?.format?.toLowerCase()??null, bdy?.text??'', ftr?.text??null, normalizeStatus(t.status), existing.id],
          )
          updated++
        } else {
          await execute(
            `INSERT INTO message_templates(user_id,name,language,category,header_type,body_text,footer_text,status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [userId, t.name, t.language, normalizeCategory(t.category), hdr?.format?.toLowerCase()??null, bdy?.text??'', ftr?.text??null, normalizeStatus(t.status)],
          )
          inserted++
        }
      } catch (err) {
        errors.push({ name: t.name, language: t.language, message: err instanceof Error ? err.message : String(err) })
      }
    }

    return NextResponse.json({ success: errors.length===0, total: metaTemplates.length, inserted, updated, errors, truncated: pages>=20 && nextUrl!==null })
  } catch (err) {
    console.error('Template sync error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to sync templates' }, { status: 500 })
  }
}
