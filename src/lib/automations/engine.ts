import type {
  Automation, AutomationLogStepResult, AutomationStep, AutomationTriggerType,
  ConditionStepConfig, KeywordMatchTriggerConfig, SendMessageStepConfig,
  SendTemplateStepConfig, SendWebhookStepConfig, TagStepConfig,
  UpdateContactFieldStepConfig, WaitStepConfig, CreateDealStepConfig,
  AssignConversationStepConfig,
} from '@/types'
import { query, queryOne, execute } from '@/lib/db'
import { engineSendText, engineSendTemplate } from './meta-send'

export interface AutomationContext {
  message_text?: string; conversation_id?: string
  vars?: Record<string, unknown>; tag_id?: string; agent_id?: string
}
export interface DispatchInput {
  userId: string; triggerType: AutomationTriggerType
  contactId?: string | null; context?: AutomationContext
}

export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {
  try {
    const automations = await query<Automation>(
      'SELECT * FROM automations WHERE user_id=$1 AND trigger_type=$2 AND is_active=true',
      [input.userId, input.triggerType],
    )
    if (!automations.length) return
    for (const automation of automations) {
      if (!triggerMatches(automation, input.context)) continue
      try { await executeAutomation(automation, input) }
      catch (err) { console.error('[automations] execute failed:', automation.id, err) }
    }
  } catch (err) { console.error('[automations] dispatch failed:', err) }
}

export async function resumePendingExecution(pending: {
  id: string; automation_id: string; user_id: string; contact_id: string | null
  log_id: string | null; parent_step_id: string | null; branch: 'yes'|'no'|null
  next_step_position: number; context: AutomationContext
}): Promise<void> {
  const automation = await queryOne<Automation>('SELECT * FROM automations WHERE id=$1', [pending.automation_id])
  if (!automation) { await execute("UPDATE automation_pending_executions SET status='failed' WHERE id=$1", [pending.id]); return }
  try {
    await executeStepsFrom({
      automation, contactId: pending.contact_id, context: pending.context ?? {},
      parentStepId: pending.parent_step_id, branch: pending.branch,
      startPosition: pending.next_step_position, logId: pending.log_id, triggerEvent: 'resumed_wait',
    })
    await execute("UPDATE automation_pending_executions SET status='done' WHERE id=$1", [pending.id])
  } catch (err) {
    console.error('[automations] resume failed:', err)
    await execute("UPDATE automation_pending_executions SET status='failed' WHERE id=$1", [pending.id])
  }
}

async function executeAutomation(automation: Automation, input: DispatchInput) {
  const log = await queryOne<{ id: string }>(
    `INSERT INTO automation_logs(automation_id, user_id, contact_id, trigger_event, steps_executed, status)
     VALUES ($1,$2,$3,$4,'[]','success') RETURNING id`,
    [automation.id, automation.user_id, input.contactId ?? null, input.triggerType],
  )
  if (!log?.id) { console.error('[automations] cannot create log'); return }

  await executeStepsFrom({
    automation, contactId: input.contactId ?? null, context: input.context ?? {},
    parentStepId: null, branch: null, startPosition: 0,
    logId: log.id, triggerEvent: input.triggerType,
  })
  await execute(
    'UPDATE automations SET execution_count=execution_count+1, last_executed_at=NOW() WHERE id=$1',
    [automation.id],
  )
}

interface ExecuteArgs {
  automation: Automation; contactId: string | null; context: AutomationContext
  parentStepId: string | null; branch: 'yes'|'no'|null; startPosition: number
  logId: string | null; triggerEvent: string
}

async function executeStepsFrom(args: ExecuteArgs): Promise<void> {
  let steps: AutomationStep[]
  if (args.parentStepId === null) {
    steps = await query<AutomationStep>(
      'SELECT * FROM automation_steps WHERE automation_id=$1 AND parent_step_id IS NULL AND position>=$2 ORDER BY position ASC',
      [args.automation.id, args.startPosition],
    )
  } else {
    steps = await query<AutomationStep>(
      'SELECT * FROM automation_steps WHERE automation_id=$1 AND parent_step_id=$2 AND branch=$3 AND position>=$4 ORDER BY position ASC',
      [args.automation.id, args.parentStepId, args.branch ?? 'yes', args.startPosition],
    )
  }
  if (!steps.length) { if (args.parentStepId === null && args.logId) await finalizeLog(args.logId, 'success', null); return }

  const results: AutomationLogStepResult[] = []
  let status: 'success'|'partial'|'failed' = 'success', errorMessage: string | null = null

  for (const step of steps) {
    if (step.step_type === 'wait') {
      const cfg = step.step_config as WaitStepConfig
      await execute(
        `INSERT INTO automation_pending_executions
         (automation_id,user_id,contact_id,log_id,parent_step_id,branch,next_step_position,context,run_at,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
        [args.automation.id, args.automation.user_id, args.contactId, args.logId,
         args.parentStepId, args.branch, step.position+1, JSON.stringify(args.context),
         new Date(Date.now()+waitMs(cfg)).toISOString()],
      )
      results.push({ step_id: step.id, step_type: step.step_type, status: 'success', detail: `waiting ${cfg.amount} ${cfg.unit}` })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    try {
      if (step.step_type === 'condition') {
        const cfg = step.step_config as ConditionStepConfig
        const taken = await evaluateCondition(cfg, args)
        results.push({ step_id: step.id, step_type: 'condition', status: 'success', detail: `branch=${taken?'yes':'no'}` })
        await executeStepsFrom({ ...args, parentStepId: step.id, branch: taken?'yes':'no', startPosition: 0, logId: args.logId })
        continue
      }
      const detail = await runStep(step, args)
      results.push({ step_id: step.id, step_type: step.step_type, status: 'success', detail })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ step_id: step.id, step_type: step.step_type, status: 'failed', detail: msg })
      status = 'failed'; errorMessage = msg; break
    }
  }

  if (args.parentStepId === null) await appendResults(args.logId, results, status, errorMessage)
  else await appendResults(args.logId, results, null, errorMessage)
}

async function runStep(step: AutomationStep, args: ExecuteArgs): Promise<string> {
  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig
      if (!args.contactId) throw new Error('send_message needs a contact')
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('send_message has empty text')
      const convId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendText({ userId: args.automation.user_id, conversationId: convId, contactId: args.contactId, text })
      return `sent via Meta (${whatsapp_message_id})`
    }
    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig
      if (!args.contactId) throw new Error('send_template needs a contact')
      if (!cfg.template_name) throw new Error('send_template needs template_name')
      const convId = await resolveConversationId(args)
      const params = cfg.variables
        ? Object.keys(cfg.variables).sort((a,b) => { const na=Number(a),nb=Number(b); const ai=isFinite(na),bi=isFinite(nb); return ai&&bi?na-nb:ai?-1:bi?1:a.localeCompare(b) }).map(k => String(cfg.variables![k]))
        : []
      const { whatsapp_message_id } = await engineSendTemplate({ userId: args.automation.user_id, conversationId: convId, contactId: args.contactId, templateName: cfg.template_name, language: cfg.language, params })
      return `template sent via Meta (${whatsapp_message_id})`
    }
    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag_id')
      await execute('INSERT INTO contact_tags(contact_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [args.contactId, cfg.tag_id])
      return `tag ${cfg.tag_id} added`
    }
    case 'remove_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag_id')
      await execute('DELETE FROM contact_tags WHERE contact_id=$1 AND tag_id=$2', [args.contactId, cfg.tag_id])
      return `tag ${cfg.tag_id} removed`
    }
    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig
      if (!args.contactId) throw new Error('assign_conversation needs a contact')
      let agentId = cfg.agent_id
      if (cfg.mode === 'round_robin') {
        const profile = await queryOne<{user_id:string}>('SELECT id AS user_id FROM users WHERE id=$1 LIMIT 1', [args.automation.user_id])
        agentId = profile?.user_id
      }
      if (!agentId) return 'no agent resolved'
      await execute('UPDATE conversations SET assigned_to=$1 WHERE user_id=$2 AND contact_id=$3', [agentId, args.automation.user_id, args.contactId])
      return `assigned to ${agentId}`
    }
    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig
      if (!args.contactId) throw new Error('update_contact_field needs a contact')
      const allowed = new Set(['name','email','company'])
      if (!allowed.has(cfg.field)) return `field ${cfg.field} not writable from automations`
      await execute(`UPDATE contacts SET ${cfg.field}=$1, updated_at=NOW() WHERE id=$2`, [cfg.value, args.contactId])
      return `${cfg.field} updated`
    }
    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig
      if (!cfg.pipeline_id||!cfg.stage_id) throw new Error('create_deal needs pipeline + stage')
      await execute(
        'INSERT INTO deals(user_id,pipeline_id,stage_id,contact_id,title,value,position) VALUES($1,$2,$3,$4,$5,$6,0)',
        [args.automation.user_id, cfg.pipeline_id, cfg.stage_id, args.contactId, interpolate(cfg.title, args), cfg.value??0],
      )
      return 'deal created'
    }
    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig
      if (!cfg.url) throw new Error('send_webhook needs url')
      const body = cfg.body_template ? interpolate(cfg.body_template, args) : JSON.stringify(args.context)
      const res = await fetch(cfg.url, { method:'POST', headers:{'content-type':'application/json',...(cfg.headers??{})}, body })
      if (!res.ok) throw new Error(`webhook returned ${res.status}`)
      return `webhook ${res.status}`
    }
    case 'close_conversation': {
      if (!args.contactId) throw new Error('close_conversation needs a contact')
      await execute('UPDATE conversations SET status=\'closed\', updated_at=NOW() WHERE user_id=$1 AND contact_id=$2', [args.automation.user_id, args.contactId])
      return 'conversation closed'
    }
    default: return `unknown step: ${step.step_type}`
  }
}

async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  if (args.context.conversation_id) return args.context.conversation_id
  if (!args.contactId) throw new Error('cannot resolve conversation: no contact')
  const row = await queryOne<{id:string}>('SELECT id FROM conversations WHERE user_id=$1 AND contact_id=$2 LIMIT 1', [args.automation.user_id, args.contactId])
  if (!row?.id) throw new Error('no conversation for contact')
  return row.id
}

function triggerMatches(automation: Automation, ctx: AutomationContext|undefined): boolean {
  if (automation.trigger_type !== 'keyword_match') return true
  const cfg = automation.trigger_config as KeywordMatchTriggerConfig
  if (!cfg?.keywords?.length) return false
  const text = (ctx?.message_text ?? '').toString()
  if (!text) return false
  const hay = cfg.case_sensitive ? text : text.toLowerCase()
  return cfg.keywords.some(raw => { const k=cfg.case_sensitive?raw:raw.toLowerCase(); return cfg.match_type==='exact'?hay===k:hay.includes(k) })
}

async function evaluateCondition(cfg: ConditionStepConfig, args: ExecuteArgs): Promise<boolean> {
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId||!cfg.operand) return false
      const row = await queryOne<{count:string}>('SELECT COUNT(*) AS count FROM contact_tags WHERE contact_id=$1 AND tag_id=$2', [args.contactId, cfg.operand])
      return Number(row?.count??0) > 0
    }
    case 'contact_field': {
      if (!args.contactId||!cfg.operand) return false
      const row = await queryOne<Record<string,unknown>>(`SELECT ${cfg.operand} FROM contacts WHERE id=$1`, [args.contactId])
      return row?.[cfg.operand] != null && String(row[cfg.operand]) === String(cfg.value??'')
    }
    case 'message_content': return (args.context.message_text??'').toString().toLowerCase().includes((cfg.value??'').toLowerCase())
    case 'time_of_day': {
      const [from,to] = (cfg.operand??'').split('-')
      if (!from||!to) return false
      const now=new Date(), mins=now.getHours()*60+now.getMinutes()
      const parse=(s:string)=>{const[h,m]=s.split(':').map(Number);return(h||0)*60+(m||0)}
      const f=parse(from),t=parse(to)
      return f<=t?mins>=f&&mins<t:mins>=f||mins<t
    }
    default: return false
  }
}

function waitMs(cfg: WaitStepConfig): number {
  const u = cfg.unit==='days'?86_400_000:cfg.unit==='hours'?3_600_000:60_000
  return Math.max(1_000, cfg.amount*u)
}
function interpolate(s: string, args: ExecuteArgs): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_,key) => {
    const[ns,prop]=String(key).split('.')
    if(ns==='message'&&prop==='text') return String(args.context.message_text??'')
    if(ns==='vars'&&prop) return String(args.context.vars?.[prop]??'')
    return ''
  })
}

async function appendResults(logId: string|null, newItems: AutomationLogStepResult[], status: 'success'|'partial'|'failed'|null, errorMessage: string|null) {
  if (!logId) return
  const existing = await queryOne<{steps_executed:AutomationLogStepResult[]}>(
    'SELECT steps_executed FROM automation_logs WHERE id=$1', [logId],
  )
  const merged = [...(existing?.steps_executed??[]), ...newItems]
  if (status !== null) {
    await execute('UPDATE automation_logs SET steps_executed=$1, status=$2, error_message=$3 WHERE id=$4',
      [JSON.stringify(merged), status, errorMessage, logId])
  } else {
    await execute('UPDATE automation_logs SET steps_executed=$1 WHERE id=$2', [JSON.stringify(merged), logId])
  }
}

async function finalizeLog(logId: string|null, status: 'success'|'partial'|'failed', errorMessage: string|null) {
  if (!logId) return
  await execute('UPDATE automation_logs SET status=$1, error_message=$2 WHERE id=$3', [status, errorMessage, logId])
}
