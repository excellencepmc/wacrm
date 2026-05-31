import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, queryOne, execute } from '@/lib/db'

const uid = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const original = await queryOne<Record<string,unknown>>(
    'SELECT * FROM automations WHERE id=$1 AND user_id=$2', [id, session.user!.id],
  )
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const copy = await queryOne<{id:string}>(
    `INSERT INTO automations(user_id,name,trigger_type,trigger_config,is_active)
     VALUES ($1,$2,$3,$4,false) RETURNING id`,
    [session.user!.id, `${original.name} (Copy)`, original.trigger_type, JSON.stringify(original.trigger_config ?? {})],
  )
  if (!copy) return NextResponse.json({ error: 'copy failed' }, { status: 500 })

  const steps = await query<{id:string;parent_step_id:string|null;branch:string|null;step_type:string;config:unknown;position:number}>(
    'SELECT id,parent_step_id,branch,step_type,config,position FROM automation_steps WHERE automation_id=$1 ORDER BY position ASC',
    [id],
  )
  if (steps.length) {
    const idMap = new Map<string,string>()
    for (const s of steps) idMap.set(s.id, uid())
    for (const s of steps) {
      await execute(
        'INSERT INTO automation_steps(id,automation_id,parent_step_id,branch,step_type,config,position) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [idMap.get(s.id), copy.id, s.parent_step_id ? idMap.get(s.parent_step_id) ?? null : null, s.branch, s.step_type, JSON.stringify(s.config ?? {}), s.position],
      )
    }
  }
  const automation = await queryOne('SELECT * FROM automations WHERE id=$1', [copy.id])
  return NextResponse.json({ automation }, { status: 201 })
}
