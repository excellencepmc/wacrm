import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { query, queryOne } from '@/lib/db'
import { daysAgoStart, lastNDayKeys, localDayKey, mondayIndex, startOfLocalDay } from '@/lib/dashboard/date-utils'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const uid = session.user.id

  const section = req.nextUrl.searchParams.get('section') ?? 'metrics'

  if (section === 'metrics') {
    const todayStart = startOfLocalDay().toISOString()
    const yestStart  = daysAgoStart(1).toISOString()
    const [openConv, newToday, newYest, cToday, cYest, deals, mToday, mYest] = await Promise.all([
      queryOne<{count:string}>('SELECT COUNT(*) AS count FROM conversations WHERE user_id=$1 AND status=\'open\'', [uid]),
      queryOne<{count:string}>('SELECT COUNT(*) AS count FROM conversations WHERE user_id=$1 AND status=\'open\' AND created_at>=$2', [uid, todayStart]),
      queryOne<{count:string}>('SELECT COUNT(*) AS count FROM conversations WHERE user_id=$1 AND status=\'open\' AND created_at>=$2 AND created_at<$3', [uid, yestStart, todayStart]),
      queryOne<{count:string}>('SELECT COUNT(*) AS count FROM contacts WHERE user_id=$1 AND created_at>=$2', [uid, todayStart]),
      queryOne<{count:string}>('SELECT COUNT(*) AS count FROM contacts WHERE user_id=$1 AND created_at>=$2 AND created_at<$3', [uid, yestStart, todayStart]),
      query<{value:number|null}>('SELECT value FROM deals WHERE user_id=$1 AND status=\'open\'', [uid]),
      queryOne<{count:string}>('SELECT COUNT(*) AS count FROM messages WHERE user_id=$1 AND direction=\'outbound\' AND created_at>=$2', [uid, todayStart]),
      queryOne<{count:string}>('SELECT COUNT(*) AS count FROM messages WHERE user_id=$1 AND direction=\'outbound\' AND created_at>=$2 AND created_at<$3', [uid, yestStart, todayStart]),
    ])
    const dealVal = deals.reduce((s,d) => s + (d.value??0), 0)
    return NextResponse.json({
      activeConversations: { current: Number(openConv?.count??0), previous: Number(newToday?.count??0) - Number(newYest?.count??0) },
      newContactsToday: { current: Number(cToday?.count??0), previous: Number(cYest?.count??0) },
      openDealsValue: dealVal, openDealsCount: deals.length,
      messagesSentToday: { current: Number(mToday?.count??0), previous: Number(mYest?.count??0) },
    })
  }

  if (section === 'conversations_series') {
    const days = parseInt(req.nextUrl.searchParams.get('days') ?? '7')
    const start = daysAgoStart(days-1).toISOString()
    const rows = await query<{created_at:string; direction:string}>(
      'SELECT created_at, direction FROM messages WHERE user_id=$1 AND created_at>=$2 ORDER BY created_at ASC',
      [uid, start],
    )
    const keys = lastNDayKeys(days)
    const buckets = new Map(keys.map(k => [k, { incoming:0, outgoing:0 }]))
    for (const r of rows) {
      const k = localDayKey(r.created_at)
      const b = buckets.get(k)
      if (b) { if (r.direction==='inbound') b.incoming++; else b.outgoing++ }
    }
    return NextResponse.json(keys.map(day => ({ day, ...(buckets.get(day)??{incoming:0,outgoing:0}) })))
  }

  if (section === 'pipeline_donut') {
    const [stages, deals] = await Promise.all([
      query<{id:string;name:string;color:string}>('SELECT id,name,color FROM pipeline_stages WHERE user_id=$1 ORDER BY position', [uid]),
      query<{stage_id:string;value:number|null}>('SELECT stage_id,value FROM deals WHERE user_id=$1 AND status=\'open\'', [uid]),
    ])
    const byStage = new Map<string,{count:number;total:number}>()
    for (const d of deals) { const r=byStage.get(d.stage_id)??{count:0,total:0}; r.count++; r.total+=(d.value??0); byStage.set(d.stage_id,r) }
    const slices = stages.map(s => ({ id:s.id, name:s.name, color:s.color||'#64748b', dealCount:byStage.get(s.id)?.count??0, totalValue:byStage.get(s.id)?.total??0 })).filter(s => s.totalValue>0||s.dealCount>0)
    return NextResponse.json({ stages: slices, totalValue: slices.reduce((s,x) => s+x.totalValue, 0) })
  }

  if (section === 'activity') {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20')
    const [msgs, contacts, deals, broadcasts, logs] = await Promise.all([
      query(`SELECT m.id,m.content,m.created_at,m.conversation_id,c.name AS contact_name,c.phone AS contact_phone FROM messages m LEFT JOIN conversations cv ON cv.id=m.conversation_id LEFT JOIN contacts c ON c.id=cv.contact_id WHERE m.user_id=$1 AND m.direction='inbound' ORDER BY m.created_at DESC LIMIT 10`, [uid]),
      query(`SELECT id,name,phone,created_at FROM contacts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`, [uid]),
      query(`SELECT d.id,d.title,d.updated_at,ps.name AS stage_name FROM deals d LEFT JOIN pipeline_stages ps ON ps.id=d.stage_id WHERE d.user_id=$1 ORDER BY d.updated_at DESC LIMIT 10`, [uid]),
      query(`SELECT id,name,status,total,created_at FROM broadcasts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`, [uid]),
      query(`SELECT al.id,al.trigger_event,al.status,al.started_at,a.name AS auto_name,c.name AS contact_name,c.phone AS contact_phone FROM automation_logs al LEFT JOIN automations a ON a.id=al.automation_id LEFT JOIN contacts c ON c.id=al.contact_id WHERE al.user_id=$1 ORDER BY al.started_at DESC LIMIT 10`, [uid]),
    ])
    const items: Array<{id:string;kind:string;text:string;at:string;href?:string}> = []
    for (const m of msgs as any[]) items.push({ id:`msg-${m.id}`, kind:'message', text:`New message from ${m.contact_name||m.contact_phone||'Unknown'}`, at:m.created_at, href:`/inbox?c=${m.conversation_id}` })
    for (const c of contacts as any[]) items.push({ id:`contact-${c.id}`, kind:'contact', text:`New contact: ${c.name||c.phone}`, at:c.created_at, href:'/contacts' })
    for (const d of deals as any[]) items.push({ id:`deal-${d.id}`, kind:'deal', text:d.stage_name?`Deal "${d.title}" in ${d.stage_name}`:`Deal "${d.title}" updated`, at:d.updated_at, href:'/pipelines' })
    for (const b of broadcasts as any[]) items.push({ id:`broadcast-${b.id}`, kind:'broadcast', text:`Broadcast "${b.name}" ${b.status} (${b.total} recipients)`, at:b.created_at, href:'/broadcasts' })
    for (const l of logs as any[]) items.push({ id:`auto-${l.id}`, kind:'automation', text:`Automation "${l.auto_name||'Automation'}" ${l.status==='failed'?'failed for':'triggered for'} ${l.contact_name||l.contact_phone||'a contact'}`, at:l.started_at })
    return NextResponse.json(items.sort((a,b) => a.at>b.at?-1:1).slice(0,limit))
  }

  return NextResponse.json({ error: 'Unknown section' }, { status: 400 })
}
