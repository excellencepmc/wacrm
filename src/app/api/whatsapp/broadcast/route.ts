import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { queryOne } from '@/lib/db'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164, phoneVariants, isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

interface BroadcastResult { phone: string; status: 'sent'|'failed'; whatsapp_message_id?: string; error?: string }
interface Recipient { phone: string; params?: string[] }

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const userId = session.user.id

    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)

    const { recipients: newR, phone_numbers, template_name, template_language, template_params } = await request.json()

    let recipients: Recipient[]
    if (Array.isArray(newR) && newR.length) {
      recipients = newR
    } else if (Array.isArray(phone_numbers) && phone_numbers.length) {
      const shared: string[] = Array.isArray(template_params) ? template_params : []
      recipients = phone_numbers.map((phone: string) => ({ phone, params: shared }))
    } else {
      return NextResponse.json({ error: 'Provide either `recipients` or `phone_numbers`' }, { status: 400 })
    }
    if (!template_name) return NextResponse.json({ error: 'template_name is required' }, { status: 400 })

    const config = await queryOne<{ phone_number_id: string; access_token: string }>(
      'SELECT phone_number_id, access_token FROM whatsapp_config WHERE user_id=$1', [userId],
    )
    if (!config) return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 })

    const accessToken = decrypt(config.access_token)
    const results: BroadcastResult[] = []
    let sentCount = 0, failedCount = 0

    for (const r of recipients) {
      const sanitized = sanitizePhoneForMeta(r.phone)
      if (!isValidE164(sanitized)) { results.push({ phone: r.phone, status: 'failed', error: 'Invalid phone number' }); failedCount++; continue }

      const variants = phoneVariants(sanitized)
      let sentId: string|null = null, lastErr: string|null = null
      for (const v of variants) {
        try {
          const res = await sendTemplateMessage({ phoneNumberId: config.phone_number_id, accessToken, to: v, templateName: template_name, language: template_language||'en_US', params: r.params??[] })
          sentId = res.messageId; lastErr = null; break
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!isRecipientNotAllowedError(msg)) { lastErr = msg; break }
          lastErr = msg
        }
      }
      if (sentId) { results.push({ phone: r.phone, status: 'sent', whatsapp_message_id: sentId }); sentCount++ }
      else { results.push({ phone: r.phone, status: 'failed', error: lastErr??'Unknown' }); failedCount++ }
    }

    return NextResponse.json({ success: true, total: recipients.length, sent: sentCount, failed: failedCount, results })
  } catch (err) {
    console.error('Broadcast error:', err)
    return NextResponse.json({ error: 'Failed to process broadcast' }, { status: 500 })
  }
}
