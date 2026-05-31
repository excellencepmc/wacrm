import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { withTransaction, execute } from '@/lib/db'

interface Recipient {
  contact_id?: string
  phone: string
  variables?: Record<string, string>
}

// POST — batch insert recipients
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { recipients } = await req.json() as { recipients: Recipient[] }
  if (!recipients?.length) return NextResponse.json({ ok: true })

  try {
    await withTransaction(async (client) => {
      // Batch in chunks of 200 rows
      for (let i = 0; i < recipients.length; i += 200) {
        const chunk = recipients.slice(i, i + 200)

        // broadcast_id is $1; each row adds 3 params: contact_id, phone, variables
        // Row j uses params $1, $(j*3+2), $(j*3+3), $(j*3+4)
        const valueClauses = chunk.map((_, j) => {
          const o = j * 3
          return `($1, $${o+2}, $${o+3}, $${o+4}, 'pending')`
        }).join(', ')

        const flat: unknown[] = [id]
        for (const r of chunk) {
          flat.push(r.contact_id ?? null, r.phone, JSON.stringify(r.variables ?? {}))
        }

        await client.query(
          `INSERT INTO broadcast_recipients(broadcast_id, contact_id, phone, variables, status)
           VALUES ${valueClauses}
           ON CONFLICT DO NOTHING`,
          flat,
        )
      }

      // Sync total count on broadcast
      await client.query(
        `UPDATE broadcasts
         SET total = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id=$1)
         WHERE id = $1`,
        [id],
      )
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[recipients POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// PATCH — update broadcast status or individual recipient
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    status?: string
    recipient_id?: string
    recipient_status?: string
    wamid?: string
    error?: string
  }

  if (body.recipient_id) {
    await execute(
      `UPDATE broadcast_recipients
       SET status = $1,
           wamid = $2,
           error = $3,
           sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END
       WHERE id = $4`,
      [body.recipient_status ?? 'failed', body.wamid ?? null, body.error ?? null, body.recipient_id],
    )
  } else if (body.status) {
    await execute(
      `UPDATE broadcasts SET
         status        = $1,
         total         = (SELECT COUNT(*)   FROM broadcast_recipients WHERE broadcast_id=$2),
         sent_count    = (SELECT COUNT(*)   FROM broadcast_recipients WHERE broadcast_id=$2 AND status='sent'),
         failed_count  = (SELECT COUNT(*)   FROM broadcast_recipients WHERE broadcast_id=$2 AND status='failed'),
         delivered_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id=$2 AND status='delivered'),
         read_count    = (SELECT COUNT(*)   FROM broadcast_recipients WHERE broadcast_id=$2 AND status='read'),
         sent_at = CASE WHEN $1 IN ('sent','failed') THEN NOW() ELSE sent_at END
       WHERE id=$2 AND user_id=$3`,
      [body.status, id, session.user.id],
    )
  }
  return NextResponse.json({ ok: true })
}
