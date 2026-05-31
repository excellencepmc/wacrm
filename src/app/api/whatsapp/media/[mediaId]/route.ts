import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { queryOne } from '@/lib/db'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function GET(_req: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  try {
    const { mediaId } = await params
    if (!mediaId) return NextResponse.json({ error: 'Media ID is required' }, { status: 400 })

    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const config = await queryOne<{ access_token: string }>(
      'SELECT access_token FROM whatsapp_config WHERE user_id=$1', [session.user.id],
    )
    if (!config) return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 })

    const accessToken = decrypt(config.access_token)
    const mediaInfo   = await getMediaUrl({ mediaId, accessToken })
    const { buffer, contentType } = await downloadMedia({ downloadUrl: mediaInfo.url, accessToken })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (err) {
    console.error('Error in WhatsApp media GET:', err)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 })
  }
}
