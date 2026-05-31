import { NextResponse } from 'next/server'
import { query, queryOne, execute } from '@/lib/db'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { getMediaUrl } from '@/lib/whatsapp/meta-api'
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'

interface WhatsAppMessage {
  id: string; from: string; timestamp: string; type: string
  text?: { body: string }
  image?: { id: string; mime_type: string; caption?: string }
  video?: { id: string; mime_type: string; caption?: string }
  document?: { id: string; mime_type: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string }
  sticker?: { id: string; mime_type: string }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji: string }
}
interface WhatsAppWebhookEntry {
  id: string
  changes: Array<{ value: { messaging_product: string; metadata: { display_phone_number: string; phone_number_id: string }; contacts?: Array<{ profile: { name: string }; wa_id: string }>; messages?: WhatsAppMessage[]; statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string }> }; field: string }>
}

// GET — webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode'), challenge = searchParams.get('hub.challenge'), verifyToken = searchParams.get('hub.verify_token')
    if (mode !== 'subscribe' || !challenge || !verifyToken) return NextResponse.json({ error: 'Missing verification parameters' }, { status: 400 })

    const configs = await query<{ id: string; verify_token: string | null }>('SELECT id, verify_token FROM whatsapp_config')
    let matchedId = ''
    let matchedVerifyToken = ''
    for (const cfg of configs) {
      if (!cfg.verify_token) continue
      try { if (decrypt(cfg.verify_token) === verifyToken) { matchedId = cfg.id; matchedVerifyToken = cfg.verify_token; break } } catch { /* skip */ }
    }
    const matchedConfig = matchedId ? { id: matchedId, verify_token: matchedVerifyToken } : null
    if (!matchedConfig) return NextResponse.json({ error: 'Verification token mismatch' }, { status: 403 })

    if (isLegacyFormat(matchedConfig.verify_token)) {
      execute('UPDATE whatsapp_config SET verify_token=$1 WHERE id=$2', [encrypt(verifyToken), matchedConfig.id]).catch(err => console.warn('[webhook] verify_token upgrade failed:', err))
    }
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  } catch (err) {
    console.error('Webhook GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — receive messages
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] rejected invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  let body: { entry?: WhatsAppWebhookEntry[] }
  try { body = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  processWebhook(body).catch(err => console.error('Webhook processing error:', err))
  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return
  for (const entry of body.entry) {
    for (const change of entry.changes) {
      const value = change.value
      if (value.statuses) for (const s of value.statuses) await handleStatusUpdate(s)
      if (!value.messages || !value.contacts) continue
      const config = await queryOne<{ user_id: string; access_token: string; phone_number_id: string }>(
        'SELECT user_id, access_token, phone_number_id FROM whatsapp_config WHERE phone_number_id=$1',
        [value.metadata.phone_number_id],
      )
      if (!config) { console.error('No config for phone_number_id:', value.metadata.phone_number_id); continue }
      const accessToken = decrypt(config.access_token)
      for (let i = 0; i < value.messages.length; i++) {
        await processMessage(value.messages[i], value.contacts[i] ?? value.contacts[0], config.user_id, accessToken)
      }
    }
  }
}

const LADDER = ['pending','sent','delivered','read','replied'] as const
const ladderLevel = (s: string) => (LADDER as readonly string[]).indexOf(s)
function validTransition(cur: string, inc: string): boolean {
  if (inc === 'failed') return cur === 'pending' || cur === 'sent'
  if (cur === 'failed') return false
  const ci = ladderLevel(cur), ii = ladderLevel(inc)
  return ii >= 0 && (ci < 0 || ii > ci)
}

async function handleStatusUpdate(status: { id: string; status: string; timestamp: string }) {
  await execute("UPDATE messages SET status=$1 WHERE wamid=$2", [status.status, status.id])
  const rec = await queryOne<{ id: string; status: string }>('SELECT id, status FROM broadcast_recipients WHERE wamid=$1', [status.id])
  if (!rec || !validTransition(rec.status, status.status)) return
  const ts = new Date(parseInt(status.timestamp)*1000).toISOString()
  const up: Record<string,unknown> = { status: status.status }
  if (status.status === 'delivered') up.delivered_at = ts
  if (status.status === 'read')      up.read_at      = ts
  await execute(
    `UPDATE broadcast_recipients SET status=$1, delivered_at=$2, read_at=$3 WHERE id=$4`,
    [status.status, up.delivered_at ?? null, up.read_at ?? null, rec.id],
  )
}

async function flagBroadcastReplyIfAny(userId: string, contactId: string) {
  try {
    const row = await queryOne<{ id: string }>(
      `SELECT br.id FROM broadcast_recipients br
       JOIN broadcasts b ON b.id = br.broadcast_id
       WHERE br.contact_id=$1 AND b.user_id=$2 AND br.status IN ('sent','delivered','read')
       ORDER BY br.created_at DESC LIMIT 1`,
      [contactId, userId],
    )
    if (row) await execute("UPDATE broadcast_recipients SET status='replied', read_at=NOW() WHERE id=$1", [row.id])
  } catch (err) { console.error('flagBroadcastReplyIfAny failed:', err) }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  userId: string,
  accessToken: string,
) {
  const senderPhone = normalizePhone(message.from)
  const { contentText, mediaUrl } = await parseMessageContent(message, accessToken)

  const contactOutcome = await findOrCreateContact(userId, senderPhone, contact.profile.name)
  if (!contactOutcome) return

  const conversation = await findOrCreateConversation(userId, contactOutcome.contact.id)
  if (!conversation) return

  const ALLOWED = new Set(['text','image','document','audio','video','location','template'])
  const contentType = ALLOWED.has(message.type) ? message.type : message.type === 'sticker' ? 'image' : 'text'

  const priorRow = await queryOne<{ count: string }>(
    "SELECT COUNT(*) AS count FROM messages WHERE conversation_id=$1 AND direction='inbound'",
    [conversation.id],
  )
  const isFirstInbound = Number(priorRow?.count ?? 0) === 0

  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO messages(conversation_id, user_id, direction, content_type, content_text, media_url, status, wamid, sent_at)
     VALUES ($1,$2,'inbound',$3,$4,$5,'delivered',$6,$7) RETURNING id`,
    [conversation.id, userId, contentType, contentText, mediaUrl, message.id,
     new Date(parseInt(message.timestamp)*1000).toISOString()],
  )
  if (!inserted) { console.error('Error inserting message'); return }

  await execute(
    'UPDATE conversations SET last_message=$1, last_message_at=NOW(), unread_count=unread_count+1, updated_at=NOW() WHERE id=$2',
    [contentText || `[${message.type}]`, conversation.id],
  )

  await flagBroadcastReplyIfAny(userId, contactOutcome.contact.id)

  const inboundText = contentText ?? message.text?.body ?? ''
  const triggers: string[] = ['new_message_received','keyword_match']
  if (contactOutcome.wasCreated)  triggers.unshift('new_contact_created')
  if (isFirstInbound)             triggers.unshift('first_inbound_message')
  for (const triggerType of triggers) {
    runAutomationsForTrigger({ userId, triggerType: triggerType as never, contactId: contactOutcome.contact.id, context: { message_text: inboundText, conversation_id: conversation.id } })
      .catch(err => console.error('[automations] dispatch failed:', err))
  }
}

async function parseMessageContent(message: WhatsAppMessage, accessToken: string) {
  const verifyUrl = async (mediaId: string) => {
    try { await getMediaUrl({ mediaId, accessToken }); return `/api/whatsapp/media/${mediaId}` }
    catch { return null }
  }
  switch (message.type) {
    case 'text':     return { contentText: message.text?.body ?? null, mediaUrl: null }
    case 'image':    return { contentText: message.image?.caption ?? null,    mediaUrl: message.image?.id    ? await verifyUrl(message.image.id)    : null }
    case 'video':    return { contentText: message.video?.caption ?? null,    mediaUrl: message.video?.id    ? await verifyUrl(message.video.id)    : null }
    case 'document': return { contentText: message.document?.caption ?? message.document?.filename ?? null, mediaUrl: message.document?.id ? await verifyUrl(message.document.id) : null }
    case 'audio':    return { contentText: null, mediaUrl: message.audio?.id   ? await verifyUrl(message.audio.id)   : null }
    case 'sticker':  return { contentText: null, mediaUrl: message.sticker?.id ? await verifyUrl(message.sticker.id) : null }
    case 'location': { const l = message.location!; return { contentText: [l.name, l.address, `${l.latitude},${l.longitude}`].filter(Boolean).join(' - '), mediaUrl: null } }
    case 'reaction': return { contentText: message.reaction?.emoji ?? null, mediaUrl: null }
    default:         return { contentText: `[Unsupported: ${message.type}]`, mediaUrl: null }
  }
}

type ContactRow = { id: string; phone: string; name: string | null }

async function findOrCreateContact(userId: string, phone: string, name: string): Promise<{ contact: ContactRow; wasCreated: boolean } | null> {
  const contacts = await query<ContactRow>('SELECT id, phone, name FROM contacts WHERE user_id=$1', [userId])
  const existing = contacts.find(c => phonesMatch(c.phone, phone))
  if (existing) {
    if (name && name !== existing.name) await execute('UPDATE contacts SET name=$1, updated_at=NOW() WHERE id=$2', [name, existing.id])
    return { contact: existing, wasCreated: false }
  }
  const newRow = await queryOne<ContactRow>(
    'INSERT INTO contacts(user_id,phone,name) VALUES($1,$2,$3) RETURNING id,phone,name',
    [userId, phone, name || phone],
  )
  if (!newRow) { console.error('Error creating contact'); return null }
  return { contact: newRow, wasCreated: true }
}

async function findOrCreateConversation(userId: string, contactId: string) {
  const existing = await queryOne<{ id: string; unread_count: number }>(
    'SELECT id, unread_count FROM conversations WHERE user_id=$1 AND contact_id=$2 LIMIT 1',
    [userId, contactId],
  )
  if (existing) return existing
  return queryOne<{ id: string; unread_count: number }>(
    'INSERT INTO conversations(user_id,contact_id,phone,status,unread_count) SELECT $1,$2,phone,\'open\',0 FROM contacts WHERE id=$2 RETURNING id, unread_count',
    [userId, contactId],
  )
}
