import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const CORS = {
  'Access-Control-Allow-Origin': 'https://casasindhu.in',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  // Rate-limit by IP to prevent abuse
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown'
  const limit = checkRateLimit(`otp:${ip}`, RATE_LIMITS.send)
  if (!limit.success) return rateLimitResponse(limit)

  const { phone } = await req.json() as { phone?: string }
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400, headers: CORS })
  }

  const fullPhone = `91${phone}`

  // Fetch the WhatsApp config (system-level, no user auth needed here)
  const config = await queryOne<{ phone_number_id: string; access_token: string }>(
    'SELECT phone_number_id, access_token FROM whatsapp_config LIMIT 1',
  )
  if (!config) {
    return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 503, headers: CORS })
  }

  // Generate a 4-digit OTP
  const otp = String(Math.floor(1000 + Math.random() * 9000))

  // Invalidate any previous unused OTPs for this phone
  await execute(
    'UPDATE otp_codes SET used=true WHERE phone=$1 AND used=false',
    [fullPhone],
  )

  // Store the new OTP (expires in 10 minutes)
  await execute(
    'INSERT INTO otp_codes(phone, code) VALUES($1, $2)',
    [fullPhone, otp],
  )

  // Send via WhatsApp — template name is configurable via OTP_TEMPLATE_NAME env var.
  // Default: casasindhu_otp (simple utility template with 1 variable: the OTP code)
  // Create this template in Meta → WhatsApp Manager → Templates:
  //   Name: casasindhu_otp  Category: UTILITY  Language: English
  //   Body: "Your OTP for CasaSindhu verification is *{{1}}*. Valid for 10 minutes. Do not share."
  const templateName = process.env.OTP_TEMPLATE_NAME ?? 'casasindhu_otp'

  // Look up the template's language from the DB so it always matches Meta
  const template = await queryOne<{ language: string; category: string }>(
    "SELECT language, category FROM message_templates WHERE name=$1 AND status='Approved' LIMIT 1",
    [templateName],
  )
  if (!template) {
    return NextResponse.json({ error: `OTP template "${templateName}" not found or not approved` }, { status: 503, headers: CORS })
  }

  try {
    const accessToken = decrypt(config.access_token)
    // Authentication templates require OTP in body AND in button (copy-code) component
    const components: unknown[] = [
      {
        type: 'body',
        parameters: [{ type: 'text', text: otp }],
      },
    ]
    if (template.category === 'Authentication') {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: otp }],
      })
    }
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${config.phone_number_id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: fullPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: template.language },
            components,
          },
        }),
      }
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(err.error?.message ?? `Meta API ${res.status}`)
    }
  } catch (err) {
    console.error('[otp/send] WhatsApp send failed:', err)
    return NextResponse.json({ error: 'Failed to send OTP. Please try again.' }, { status: 500, headers: CORS })
  }

  return NextResponse.json({ success: true }, { headers: CORS })
}
