import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { queryOne, execute } from '@/lib/db'
import { loadStepsTree, replaceSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import { validateStepsForActivation, validateTriggerForActivation } from '@/lib/automations/validate'

async function getSession() {
  const session = await auth()
  return session?.user?.id ? session : null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const automation = await queryOne('SELECT * FROM automations WHERE id=$1 AND user_id=$2', [id, session.user!.id])
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const steps = await loadStepsTree(id)
  return NextResponse.json({ automation, steps })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const existing = await queryOne<{ is_active: boolean; trigger_type: string; trigger_config: unknown }>(
    'SELECT is_active, trigger_type, trigger_config FROM automations WHERE id=$1 AND user_id=$2',
    [id, session.user!.id],
  )
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const willBeActive = typeof body.is_active === 'boolean' ? body.is_active : existing.is_active
  if (willBeActive) {
    const mergedTrigger = body.trigger_type ?? existing.trigger_type
    const mergedConfig  = body.trigger_config ?? existing.trigger_config
    const mergedSteps   = Array.isArray(body.steps) ? body.steps : await loadStepsTree(id)
    const issues = [
      ...validateTriggerForActivation(mergedTrigger, mergedConfig),
      ...validateStepsForActivation(mergedSteps),
    ]
    if (issues.length) return NextResponse.json({ error: 'Cannot keep automation active with invalid configuration', issues }, { status: 400 })
  }

  const fields: string[] = [], vals: unknown[] = []
  for (const k of ['name','description','trigger_type','is_active'] as const) {
    if (k in body) { fields.push(`${k}=$${fields.length+1}`); vals.push(body[k]) }
  }
  if ('trigger_config' in body) { fields.push(`trigger_config=$${fields.length+1}`); vals.push(JSON.stringify(body.trigger_config)) }
  if (fields.length) {
    vals.push(id)
    await execute(`UPDATE automations SET ${fields.join(',')} WHERE id=$${vals.length}`, vals)
  }
  if (Array.isArray(body.steps)) {
    const err = await replaceSteps(id, body.steps as BuilderStepInput[])
    if (err) return NextResponse.json({ error: err }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await execute('DELETE FROM automations WHERE id=$1 AND user_id=$2', [id, session.user!.id])
  return NextResponse.json({ ok: true })
}
