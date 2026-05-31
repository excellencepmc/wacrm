import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { queryOne, execute } from '@/lib/db'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const config = await queryOne<{
      phone_number_id: string; waba_id: string | null;
      access_token: string; status: string
    }>(
      'SELECT phone_number_id, waba_id, access_token, status FROM whatsapp_config WHERE user_id = $1',
      [session.user.id],
    )

    if (!config) {
      return NextResponse.json({
        connected: false, reason: 'no_config', has_config: false,
        message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
      })
    }

    let accessToken: string
    try { accessToken = decrypt(config.access_token) }
    catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json({
        has_config: true,
        phone_number_id: config.phone_number_id,
        waba_id: config.waba_id ?? '',
        connected: false, reason: 'token_corrupted', needs_reset: true,
        message: 'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. Click "Reset Configuration" and re-save.',
      })
    }

    // Non-sensitive fields safe to return to the client for form pre-fill
    const formFields = {
      has_config: true,
      phone_number_id: config.phone_number_id,
      waba_id: config.waba_id ?? '',
    }

    try {
      const phoneInfo = await verifyPhoneNumber({ phoneNumberId: config.phone_number_id, accessToken })
      return NextResponse.json({ ...formFields, connected: true, phone_info: phoneInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      return NextResponse.json({ ...formFields, connected: false, reason: 'meta_api_error', message: `Meta API rejected the credentials: ${message}` })
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json({ connected: false, reason: 'unknown', message: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { phone_number_id, waba_id, access_token, verify_token } = await request.json() as {
      phone_number_id: string; waba_id?: string; access_token: string; verify_token?: string
    }

    if (!access_token || !phone_number_id) {
      return NextResponse.json({ error: 'access_token and phone_number_id are required' }, { status: 400 })
    }

    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId: phone_number_id, accessToken: access_token })
    } catch (err) {
      return NextResponse.json({ error: `Meta API error: ${err instanceof Error ? err.message : err}` }, { status: 400 })
    }

    let encryptedToken: string, encryptedVerify: string | null
    try {
      encryptedToken  = encrypt(access_token)
      encryptedVerify = verify_token ? encrypt(verify_token) : null
    } catch {
      return NextResponse.json({ error: 'Failed to encrypt token. Check ENCRYPTION_KEY.' }, { status: 500 })
    }

    const existing = await queryOne('SELECT id FROM whatsapp_config WHERE user_id = $1', [session.user.id])
    if (existing) {
      await execute(
        `UPDATE whatsapp_config SET phone_number_id=$1, waba_id=$2, access_token=$3,
         verify_token=$4, status='connected', connected_at=NOW(), updated_at=NOW()
         WHERE user_id=$5`,
        [phone_number_id, waba_id ?? null, encryptedToken, encryptedVerify, session.user.id],
      )
    } else {
      await execute(
        `INSERT INTO whatsapp_config(user_id, phone_number_id, waba_id, access_token, verify_token, status)
         VALUES ($1,$2,$3,$4,$5,'connected')`,
        [session.user.id, phone_number_id, waba_id ?? null, encryptedToken, encryptedVerify],
      )
    }

    return NextResponse.json({ success: true, phone_info: phoneInfo })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    await execute('DELETE FROM whatsapp_config WHERE user_id = $1', [session.user.id])
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
