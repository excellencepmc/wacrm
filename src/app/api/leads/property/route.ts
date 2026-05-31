import { NextRequest, NextResponse } from 'next/server'
import { execute } from '@/lib/db'

const CORS = {
  'Access-Control-Allow-Origin': 'https://casasindhu.in',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

interface LeadPayload {
  phone: string
  name?: string
  tag?: string           // e.g. "2BHK · Vaishali Nagar, Jaipur · ₹15K–20K"
  requirement?: Record<string, unknown>  // full search context from OtpModal
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as LeadPayload
  const { phone, name, tag, requirement = {} } = body

  if (!phone || !/^\d{10}$/.test(phone)) {
    return NextResponse.json({ error: 'Invalid phone' }, { status: 400, headers: CORS })
  }

  const fullPhone = `+91${phone}`

  // Save lead to DB
  await execute(
    'INSERT INTO property_leads(phone, name, tag, requirement) VALUES($1,$2,$3,$4)',
    [fullPhone, name ?? null, tag ?? null, JSON.stringify(requirement)],
  )

  // Send email notification
  await sendLeadEmail(fullPhone, name, tag, requirement).catch(err =>
    console.error('[leads] email failed:', err),
  )

  return NextResponse.json({ success: true }, { headers: CORS })
}

async function sendLeadEmail(
  phone: string,
  name: string | undefined,
  tag: string | undefined,
  requirement: Record<string, unknown>,
) {
  const emailApiUrl  = process.env.EMAIL_API_URL
  const apiUsername  = process.env.EMAIL_API_USERNAME
  const apiPassword  = process.env.EMAIL_API_PASSWORD
  const notifyTo     = process.env.LEAD_NOTIFY_TO
  const senderId     = process.env.LEAD_FROM_SENDER_ID

  if (!emailApiUrl || !notifyTo || !senderId) return

  // Get auth token
  const loginRes = await fetch(`${emailApiUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: apiUsername, password: apiPassword }),
  })
  if (!loginRes.ok) throw new Error('Email API login failed')
  const { access_token } = await loginRes.json() as { access_token: string }

  const req = requirement as {
    city?: string; areas?: string[]; bhk?: string[]; budget?: string
    furnishing?: string[]; propType?: string[]; floor?: string
    moveIn?: string; parking?: boolean; petFriendly?: boolean; lift?: boolean
  }

  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })

  const bodyHtml = `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f1f5f9;margin:0;padding:24px}
  .card{max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .header{background:linear-gradient(135deg,#0D6B7A,#0f8a9e);padding:28px 32px;color:#fff}
  .header h1{margin:0;font-size:20px;font-weight:800}
  .header p{margin:4px 0 0;font-size:13px;opacity:.75}
  .body{padding:28px 32px}
  .row{display:flex;padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px}
  .row:last-child{border-bottom:none}
  .label{width:140px;flex-shrink:0;color:#64748b;font-weight:600}
  .value{color:#0f172a;font-weight:700}
  .badge{display:inline-block;background:#e0f2fe;color:#0369a1;border-radius:100px;padding:3px 10px;font-size:12px;font-weight:700;margin:2px 3px 2px 0}
  .footer{padding:16px 32px 24px;text-align:center;font-size:12px;color:#94a3b8}
</style>
</head><body>
<div class="card">
  <div class="header">
    <h1>🏠 New Rental Lead</h1>
    <p>A verified prospect submitted their property requirement</p>
  </div>
  <div class="body">
    <div class="row"><span class="label">📱 WhatsApp</span><span class="value">${phone}</span></div>
    ${name ? `<div class="row"><span class="label">👤 Name</span><span class="value">${name}</span></div>` : ''}
    <div class="row"><span class="label">🕐 Date &amp; Time</span><span class="value">${now} IST</span></div>
    ${req.city ? `<div class="row"><span class="label">🌆 City</span><span class="value">${req.city}</span></div>` : ''}
    ${req.areas?.length ? `<div class="row"><span class="label">📍 Areas</span><span class="value">${req.areas.map(a => `<span class="badge">${a}</span>`).join('')}</span></div>` : ''}
    ${req.bhk?.length ? `<div class="row"><span class="label">🛏 BHK</span><span class="value">${req.bhk.map(b => `<span class="badge">${b}</span>`).join('')}</span></div>` : ''}
    ${req.budget ? `<div class="row"><span class="label">💰 Budget</span><span class="value">${req.budget}</span></div>` : ''}
    ${req.furnishing?.length ? `<div class="row"><span class="label">🪑 Furnishing</span><span class="value">${req.furnishing.join(', ')}</span></div>` : ''}
    ${req.propType?.length ? `<div class="row"><span class="label">🏢 Property Type</span><span class="value">${req.propType.join(', ')}</span></div>` : ''}
    ${req.moveIn && req.moveIn !== 'Immediately' ? `<div class="row"><span class="label">📅 Move-in</span><span class="value">${req.moveIn}</span></div>` : ''}
    ${(req.parking || req.petFriendly || req.lift) ? `<div class="row"><span class="label">✅ Amenities</span><span class="value">${[req.parking && 'Parking', req.petFriendly && 'Pet Friendly', req.lift && 'Lift'].filter(Boolean).join(', ')}</span></div>` : ''}
    ${tag ? `<div class="row"><span class="label">🏷 Tag</span><span class="value">${tag}</span></div>` : ''}
  </div>
  <div class="footer">CasaSindhu Rental Leads · rental.lead@casasindhu.com</div>
</div>
</body></html>`

  const subject = `New Rental Lead: ${req.bhk?.join('/') ?? 'Property'} in ${req.areas?.[0] ?? req.city ?? 'Jaipur'} — ${phone}`

  await fetch(`${emailApiUrl}/api/emails/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
    body: JSON.stringify({
      from_email: 'rental.lead@casasindhu.com',
      to_emails: [notifyTo],
      subject,
      body_html: bodyHtml,
      sender_id: senderId,
    }),
  })
}
