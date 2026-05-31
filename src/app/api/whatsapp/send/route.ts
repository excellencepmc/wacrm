import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { queryOne, execute } from '@/lib/db'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164, phoneVariants, isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = session.user.id

    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversation_id, message_type, content_text, media_url, template_name, template_params } = await request.json()

    if (!conversation_id || !message_type) return NextResponse.json({ error: 'conversation_id and message_type are required' }, { status: 400 })
    if (message_type === 'text' && !content_text) return NextResponse.json({ error: 'content_text is required for text messages' }, { status: 400 })
    if (message_type === 'template' && !template_name) return NextResponse.json({ error: 'template_name is required' }, { status: 400 })

    const conv = await queryOne<{ id: string; contact_id: string }>(
      'SELECT id, contact_id FROM conversations WHERE id=$1 AND user_id=$2', [conversation_id, userId],
    )
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    const contact = await queryOne<{ id: string; phone: string }>(
      'SELECT id, phone FROM contacts WHERE id=$1', [conv.contact_id],
    )
    if (!contact?.phone) return NextResponse.json({ error: 'Contact phone number not found' }, { status: 400 })

    const sanitized = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitized)) return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 })

    const config = await queryOne<{ id: string; phone_number_id: string; access_token: string }>(
      'SELECT id, phone_number_id, access_token FROM whatsapp_config WHERE user_id=$1', [userId],
    )
    if (!config) return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 })

    const accessToken = decrypt(config.access_token)

    if (isLegacyFormat(config.access_token)) {
      execute('UPDATE whatsapp_config SET access_token=$1 WHERE id=$2', [encrypt(accessToken), config.id])
        .catch(err => console.warn('[send] access_token upgrade failed:', err))
    }

    const attempt = async (phone: string): Promise<string> => {
      if (message_type === 'template') {
        const r = await sendTemplateMessage({ phoneNumberId: config.phone_number_id, accessToken, to: phone, templateName: template_name, params: template_params||[] })
        return r.messageId
      }
      const r = await sendTextMessage({ phoneNumberId: config.phone_number_id, accessToken, to: phone, text: content_text })
      return r.messageId
    }

    let waMessageId = '', workingPhone = sanitized
    try {
      const variants = phoneVariants(sanitized)
      let lastErr: unknown = null
      for (const v of variants) {
        try { waMessageId = await attempt(v); workingPhone = v; lastErr = null; break }
        catch (err) { const m = err instanceof Error ? err.message : String(err); if (!isRecipientNotAllowedError(m)) throw err; lastErr = err }
      }
      if (lastErr) throw lastErr
    } catch (err) {
      return NextResponse.json({ error: `Meta API error: ${err instanceof Error ? err.message : err}` }, { status: 502 })
    }

    if (workingPhone !== sanitized) {
      await execute('UPDATE contacts SET phone=$1 WHERE id=$2', [workingPhone, contact.id])
    }

    const msg = await queryOne<{ id: string }>(
      `INSERT INTO messages(conversation_id, user_id, direction, content_type, content_text, media_url, status, wamid)
       VALUES ($1,$2,'outbound',$3,$4,$5,'sent',$6) RETURNING id`,
      [conversation_id, userId, message_type, content_text||template_name||null, media_url||null, waMessageId],
    )
    if (!msg) return NextResponse.json({ error: 'Message sent but failed to save to DB' }, { status: 500 })

    await execute(
      'UPDATE conversations SET last_message=$1, last_message_at=NOW(), updated_at=NOW() WHERE id=$2',
      [content_text || `[${message_type}]`, conversation_id],
    )

    return NextResponse.json({ success: true, message_id: msg.id, whatsapp_message_id: waMessageId })
  } catch (err) {
    console.error('Send error:', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
