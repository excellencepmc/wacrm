import { NextRequest, NextResponse } from 'next/server'
import { queryOne, execute } from '@/lib/db'

const CORS = {
  'Access-Control-Allow-Origin': 'https://casasindhu.in',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  const { phone, code } = await req.json() as { phone?: string; code?: string }

  if (!phone || !/^[6-9]\d{9}$/.test(phone) || !code || !/^\d{4}$/.test(code)) {
    return NextResponse.json({ valid: false, error: 'Invalid input' }, { status: 400, headers: CORS })
  }

  const fullPhone = `91${phone}`

  const row = await queryOne<{ id: string }>(
    `SELECT id FROM otp_codes
     WHERE phone=$1 AND code=$2 AND used=false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [fullPhone, code],
  )

  if (!row) {
    return NextResponse.json({ valid: false }, { headers: CORS })
  }

  // Mark as used
  await execute('UPDATE otp_codes SET used=true WHERE id=$1', [row.id])

  return NextResponse.json({ valid: true }, { headers: CORS })
}
