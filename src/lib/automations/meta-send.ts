import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164, phoneVariants, isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils'
import { queryOne, execute } from '@/lib/db'

interface SendTextArgs     { userId: string; conversationId: string; contactId: string; text: string }
interface SendTemplateArgs { userId: string; conversationId: string; contactId: string; templateName: string; language?: string; params?: string[] }

export async function engineSendText(args: SendTextArgs) { return sendViaMeta({ ...args, kind: 'text' }) }
export async function engineSendTemplate(args: SendTemplateArgs) { return sendViaMeta({ ...args, kind: 'template' }) }

type SendInput = (SendTextArgs & { kind: 'text' }) | (SendTemplateArgs & { kind: 'template' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const contact = await queryOne<{ id: string; phone: string }>(
    'SELECT id, phone FROM contacts WHERE id = $1 AND user_id = $2',
    [input.contactId, input.userId],
  )
  if (!contact?.phone) throw new Error('contact not found for this user')

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) throw new Error(`contact phone invalid: ${contact.phone}`)

  const config = await queryOne<{ phone_number_id: string; access_token: string }>(
    'SELECT phone_number_id, access_token FROM whatsapp_config WHERE user_id = $1',
    [input.userId],
  )
  if (!config) throw new Error('WhatsApp not configured for this account')

  const accessToken = decrypt(config.access_token)

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      const r = await sendTemplateMessage({ phoneNumberId: config.phone_number_id, accessToken, to: phone, templateName: input.templateName, language: input.language, params: input.params })
      return r.messageId
    }
    const r = await sendTextMessage({ phoneNumberId: config.phone_number_id, accessToken, to: phone, text: input.text })
    return r.messageId
  }

  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized, waMessageId = '', lastError: unknown = null
  for (const v of variants) {
    try { waMessageId = await attempt(v); workingPhone = v; lastError = null; break }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await execute('UPDATE contacts SET phone = $1 WHERE id = $2', [workingPhone, contact.id])
  }

  const contentType  = input.kind === 'template' ? 'template' : 'text'
  const contentText  = input.kind === 'text' ? input.text : null
  const templateName = input.kind === 'template' ? input.templateName : null

  try {
    await execute(
      `INSERT INTO messages(conversation_id, direction, content_type, content_text, status, wamid)
       VALUES ($1,'outbound',$2,$3,'sent',$4)`,
      [input.conversationId, contentType, contentText ?? templateName, waMessageId],
    )
  } catch (err) {
    throw new Error(`sent to Meta but DB insert failed: ${err instanceof Error ? err.message : err}`)
  }

  await execute(
    `UPDATE conversations SET last_message=$1, last_message_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [input.kind === 'template' ? `[template:${input.templateName}]` : input.text, input.conversationId],
  )

  return { whatsapp_message_id: waMessageId }
}
