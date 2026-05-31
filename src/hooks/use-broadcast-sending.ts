"use client"
import { useState } from 'react'
import { Contact, MessageTemplate } from '@/types'

export type CustomFieldOperator = 'is' | 'is_not' | 'contains'

export interface CustomFieldFilter {
  fieldId: string; operator: CustomFieldOperator; value: string
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv'
  tagIds?: string[]
  customField?: CustomFieldFilter
  csvContacts?: { phone: string; name?: string }[]
  excludeTagIds?: string[]
}

export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string }

interface BroadcastPayload {
  name: string; template: MessageTemplate
  audience: AudienceConfig; variables: Record<string, VariableMapping>
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>
  isProcessing: boolean; progress: number
}

interface BroadcastApiResult {
  phone: string; status: 'sent' | 'failed'
  whatsapp_message_id?: string; error?: string
}

const SEND_BATCH_SIZE  = 10
const SEND_BATCH_DELAY = 1000

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export function resolveVariables(variables: Record<string, VariableMapping>, contact: Contact): string[] {
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a), bn = Number(b)
    return isFinite(an) && isFinite(bn) ? an - bn : a.localeCompare(b)
  })
  return keys.map(key => {
    const v = variables[key]
    if (v.type === 'static') return v.value
    if (v.type === 'field') {
      const m: Record<string, string | null | undefined> = {
        name: contact.name, phone: contact.phone, email: contact.email, company: contact.company,
      }
      return m[v.value] ?? ''
    }
    return ''
  })
}

async function patchRecipient(broadcastId: string, recipientId: string, status: string, wamid?: string | null, error?: string | null) {
  return fetch(`/api/broadcasts/${broadcastId}/recipients`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: recipientId, recipient_status: status, wamid: wamid ?? null, error: error ?? null }),
  }).catch(() => {})
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress,     setProgress]     = useState(0)

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true); setProgress(0)
    try {
      // 1. Resolve audience
      setProgress(5)
      const audRes = await fetch('/api/audience', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: payload.audience.type, tagIds: payload.audience.tagIds,
          excludeTagIds: payload.audience.excludeTagIds,
          customFieldId: payload.audience.customField?.fieldId,
          customFieldOperator: payload.audience.customField?.operator,
          customFieldValue: payload.audience.customField?.value,
          csvPhones: payload.audience.csvContacts?.map(c => c.phone),
        }),
      })
      if (!audRes.ok) throw new Error('Failed to resolve audience')
      const { contacts } = await audRes.json() as { contacts: Contact[] }
      if (!contacts.length) throw new Error('No contacts found for this audience.')

      // 2. Create broadcast
      setProgress(10)
      const bcRes = await fetch('/api/broadcasts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: payload.name, template_name: payload.template.name, template_language: payload.template.language ?? 'en_US', status: 'sending' }),
      })
      if (!bcRes.ok) throw new Error('Failed to create broadcast')
      const broadcast = await bcRes.json() as { id: string }

      // 3. Insert recipients
      setProgress(20)
      const insRes = await fetch(`/api/broadcasts/${broadcast.id}/recipients`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: contacts.map(c => ({ contact_id: c.id, phone: c.phone, variables: {} })) }),
      })
      if (!insRes.ok) {
        const e = await insRes.json().catch(() => ({})) as { error?: string }
        throw new Error(`Failed to insert recipients: ${e.error ?? insRes.status}`)
      }

      // 4. Fetch DB recipient IDs (to update status per recipient)
      setProgress(25)
      const detailRes = await fetch(`/api/broadcasts/${broadcast.id}`)
      if (!detailRes.ok) throw new Error('Failed to fetch recipients')
      const { recipients: dbRecs } = await detailRes.json() as { recipients: Array<{ id: string; phone: string }> }
      const phoneToId = new Map(dbRecs.filter(r => r.phone).map(r => [r.phone, r.id]))

      // 5. Send in batches
      setProgress(30)
      let failedCount = 0
      const total = contacts.length

      for (let i = 0; i < contacts.length; i += SEND_BATCH_SIZE) {
        const batch = contacts.slice(i, i + SEND_BATCH_SIZE)
        try {
          const sendRes = await fetch('/api/whatsapp/broadcast', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipients: batch.map(c => ({ phone: c.phone, params: resolveVariables(payload.variables, c) })),
              template_name: payload.template.name, template_language: payload.template.language ?? 'en_US',
            }),
          })
          const sendData = await sendRes.json() as { results?: BroadcastApiResult[]; error?: string }
          if (!sendRes.ok) throw new Error(sendData.error ?? 'Broadcast API failed')

          const byPhone = new Map<string, BroadcastApiResult>()
          for (const r of sendData.results ?? []) byPhone.set(r.phone, r)

          for (const contact of batch) {
            const rid    = phoneToId.get(contact.phone)
            const result = byPhone.get(contact.phone)
            if (!rid) continue
            if (result?.status === 'sent') {
              await patchRecipient(broadcast.id, rid, 'sent', result.whatsapp_message_id)
              // Create/update inbox conversation so the sent message appears there
              fetch('/api/conversations/ensure', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contact_id:   contact.id,
                  phone:        contact.phone,
                  content_type: 'template',
                  content_text: `[template:${payload.template.name}]`,
                  wamid:        result.whatsapp_message_id ?? null,
                }),
              }).catch(() => {}) // best-effort
            } else {
              failedCount++
              await patchRecipient(broadcast.id, rid, 'failed', null, result?.error ?? 'No response')
            }
          }
        } catch (err) {
          failedCount += batch.length
          for (const contact of batch) {
            const rid = phoneToId.get(contact.phone)
            if (rid) patchRecipient(broadcast.id, rid, 'failed', null, err instanceof Error ? err.message : 'Send error')
          }
        }
        setProgress(30 + Math.round(((i + batch.length) / total) * 65))
        if (i + SEND_BATCH_SIZE < contacts.length) await sleep(SEND_BATCH_DELAY)
      }

      // 6. Finalize broadcast status
      setProgress(97)
      const finalStatus = failedCount === total ? 'failed' : failedCount > 0 ? 'partial' : 'sent'
      await fetch(`/api/broadcasts/${broadcast.id}/recipients`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: finalStatus }),
      })

      setProgress(100)
      return broadcast.id
    } finally {
      setIsProcessing(false)
    }
  }

  return { createAndSendBroadcast, isProcessing, progress }
}
