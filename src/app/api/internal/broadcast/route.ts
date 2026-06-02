import { NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164, phoneVariants, isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils'

const META_API_BASE = 'https://graph.facebook.com/v21.0'

interface Recipient { phone: string; params?: string[] }

/** Extract variable names from template body text, e.g. {{request_type}} → ['request_type'] */
function extractVarNames(bodyText: string): string[] {
  const matches = bodyText.match(/\{\{([^}]+)\}\}/g) || []
  return matches
    .map(m => m.replace(/\{\{|\}\}/g, '').trim())
    .filter(v => isNaN(Number(v))) // keep only named vars, skip positional {{1}}
}

async function sendTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  language: string,
  category: string,
  bodyText: string,
  params: string[],
): Promise<string> {
  const components: object[] = []

  if (params.length > 0) {
    const varNames = extractVarNames(bodyText)
    const useNamed = varNames.length > 0

    components.push({
      type: 'body',
      parameters: params.map((p, i) =>
        useNamed
          ? { type: 'text', parameter_name: varNames[i] ?? String(i + 1), text: String(p) }
          : { type: 'text', text: String(p) }
      ),
    })

    if (category.toLowerCase() === 'authentication') {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: String(params[0]) }],
      })
    }
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length > 0 && { components }),
    },
  }

  const resp = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err.error?.message ?? `Meta API error ${resp.status}`)
  }
  const data = await resp.json()
  return data.messages[0].id
}

export async function POST(request: Request) {
  const apiKey = request.headers.get('x-internal-api-key')
  if (!apiKey || apiKey !== process.env.WA_INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { recipients, template_name, template_params } = await request.json()

    if (!template_name) return NextResponse.json({ error: 'template_name is required' }, { status: 400 })

    const recipientList: Recipient[] = Array.isArray(recipients) && recipients.length ? recipients : []
    if (!recipientList.length) return NextResponse.json({ error: 'recipients array is required' }, { status: 400 })

    const tmpl = await queryOne<{ language: string; category: string; body_text: string }>(
      `SELECT language, category, body_text FROM message_templates WHERE name = $1 LIMIT 1`,
      [template_name],
    )
    if (!tmpl) return NextResponse.json({ error: `Template '${template_name}' not found` }, { status: 404 })

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
          sentId = await sendTemplate(
            config.phone_number_id, accessToken, v,
            template_name, tmpl.language, tmpl.category, tmpl.body_text, params
          )
          lastErr = null; break
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
