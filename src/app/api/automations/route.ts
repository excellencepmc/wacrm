import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, queryOne } from '@/lib/db'
import { getTemplate } from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import { validateStepsForActivation, validateTriggerForActivation } from '@/lib/automations/validate'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const automations = await query('SELECT * FROM automations WHERE user_id=$1 ORDER BY created_at DESC', [session.user!.id])
  return NextResponse.json({ automations })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  let { name, description, trigger_type, trigger_config, is_active, steps } = body
  const { template } = body

  if (template && (!steps || !steps.length)) {
    const t = getTemplate(template)
    if (t) {
      name ??= t.name; description ??= t.description
      trigger_type ??= t.trigger_type; trigger_config ??= t.trigger_config
      steps = t.steps as unknown as BuilderStepInput[]
    }
  }
  if (!name || !trigger_type) return NextResponse.json({ error: 'name and trigger_type are required' }, { status: 400 })

  if (is_active) {
    const issues = [
      ...validateTriggerForActivation(trigger_type, trigger_config ?? {}),
      ...validateStepsForActivation((steps ?? []) as unknown as { step_type: string; step_config: Record<string, unknown> }[]),
    ]
    if (issues.length) return NextResponse.json({ error: 'Cannot activate automation with invalid configuration', issues }, { status: 400 })
  }

  const automation = await queryOne(
    `INSERT INTO automations(user_id,name,trigger_type,trigger_config,is_active)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [session.user!.id, name, trigger_type, JSON.stringify(trigger_config ?? {}), !!is_active],
  )
  if (!automation) return NextResponse.json({ error: 'insert failed' }, { status: 500 })

  if (steps?.length) {
    const err = await insertSteps((automation as {id:string}).id, steps)
    if (err) return NextResponse.json({ error: err }, { status: 500 })
  }
  return NextResponse.json({ automation }, { status: 201 })
}
