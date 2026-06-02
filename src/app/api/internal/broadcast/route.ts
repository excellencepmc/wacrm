import { NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164, phoneVariants, isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils'

interface Recipient { phone: string; params?: string[] }

// Internal service-to-service endpoint — protected by API key, no session required
export async function POST(request: Request) {
  const apiKey = request.headers.get('x-internal-api-key')
  if (!apiKey || apiKey !== process.env.WA_INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { recipients, template_name, template_language, template_params } = await request.json()

    if (!template_name) return NextResponse.json({ error: 'template_name is required' }, { status: 400 })

    const recipientList: Recipient[] = Array.isArray(recipients) && recipients.length
      ? recipients
      : []

    if (!recipientList.length) return NextResponse.json({ error: 'recipients array is required' }, { status: 400 })

    // Use the first available WhatsApp config (single-tenant internal use)
    const config = await queryOne<{ phone_number_id: string; access_token: string }>(
      'SELECT phone_number_id, access_token FROM whatsapp_config LIMIT 1',
    )
    if (!config) return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 })

    const accessToken = decrypt(config.access_token)
    const sharedParams: string[] = Array.isArray(template_params) ? template_params : []

    const results = []
    let sent = 0, failed = 0

    for (const r of recipientList) {
      const sanitized = sanitizePhoneForMeta(r.phone)
      if (!isValidE164(sanitized)) { results.push({ phone: r.phone, status: 'failed', error: 'Invalid phone' }); failed++; continue }

      const params = r.params ?? sharedParams
      const variants = phoneVariants(sanitized)
      let sentId: string | null = null, lastErr: string | null = null

      for (const v of variants) {
        try {
          const res = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: v,
            templateName: template_name,
            language: template_language ?? 'en_US',
            params,
          })
          sentId = res.messageId; lastErr = null; break
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!isRecipientNotAllowedError(msg)) { lastErr = msg; break }
          lastErr = msg
        }
      }

      if (sentId) { results.push({ phone: r.phone, status: 'sent', whatsapp_message_id: sentId }); sent++ }
      else { results.push({ phone: r.phone, status: 'failed', error: lastErr ?? 'Unknown' }); failed++ }
    }

    return NextResponse.json({ success: true, total: recipientList.length, sent, failed, results })
  } catch (err) {
    console.error('[internal/broadcast] error:', err)
    return NextResponse.json({ error: 'Failed to process broadcast' }, { status: 500 })
  }
}
