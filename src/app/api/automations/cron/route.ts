import { NextResponse } from 'next/server'
import { query, execute } from '@/lib/db'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  if (request.headers.get('x-cron-secret') !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const due = await query<Record<string, unknown>>(
    "SELECT * FROM automation_pending_executions WHERE status='pending' AND run_at <= $1 ORDER BY run_at ASC LIMIT 50",
    [new Date().toISOString()],
  )
  if (!due.length) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const row of due) {
    const claimed = await execute(
      "UPDATE automation_pending_executions SET status='running' WHERE id=$1 AND status='pending'",
      [row.id],
    )
    if (!claimed) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      user_id: (row.user_id ?? '') as string,
      contact_id: (row.contact_id as string|null) ?? null,
      log_id: (row.log_id as string|null) ?? null,
      parent_step_id: (row.parent_step_id as string|null) ?? null,
      branch: (row.branch as 'yes'|'no'|null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    })
    processed++
  }
  return NextResponse.json({ processed })
}
