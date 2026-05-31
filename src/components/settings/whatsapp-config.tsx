"use client"

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Eye, EyeOff, Copy, CheckCircle2, XCircle,
  Loader2, ExternalLink, Zap, AlertTriangle, RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'

const MASKED_TOKEN = '••••••••••••••••'

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown'
type ResetReason = 'token_corrupted' | 'meta_api_error' | null

export function WhatsAppConfig() {
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [testing, setTesting]           = useState(false)
  const [resetting, setResetting]       = useState(false)
  const [showToken, setShowToken]       = useState(false)
  const [hasConfig, setHasConfig]       = useState(false)
  const [connectionStatus, setStatus]   = useState<ConnectionStatus>('unknown')
  const [resetReason, setResetReason]   = useState<ResetReason>(null)
  const [statusMessage, setStatusMsg]   = useState('')

  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [wabaId, setWabaId]               = useState('')
  const [accessToken, setAccessToken]     = useState('')
  const [verifyToken, setVerifyToken]     = useState('')
  const [tokenEdited, setTokenEdited]     = useState(false)

  const webhookUrl =
    (process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== 'undefined' ? window.location.origin : '')) + '/api/whatsapp/webhook'

  /** Single API call: fetches form field values AND connection status at once. */
  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res     = await fetch('/api/whatsapp/config')
      const payload = await res.json() as {
        has_config?: boolean
        phone_number_id?: string
        waba_id?: string
        connected?: boolean
        reason?: string
        needs_reset?: boolean
        message?: string
        phone_info?: { verified_name?: string }
      }

      const configured = payload.has_config ?? false
      setHasConfig(configured)

      if (configured) {
        setPhoneNumberId(payload.phone_number_id ?? '')
        setWabaId(payload.waba_id ?? '')
        setAccessToken(MASKED_TOKEN)
        setTokenEdited(false)
      } else {
        setPhoneNumberId('')
        setWabaId('')
        setAccessToken('')
        setTokenEdited(false)
      }

      if (payload.connected) {
        setStatus('connected')
        setResetReason(null)
        setStatusMsg('')
      } else {
        setStatus('disconnected')
        setResetReason(
          payload.needs_reset        ? 'token_corrupted' :
          payload.reason === 'meta_api_error' ? 'meta_api_error' : null
        )
        setStatusMsg(payload.message ?? '')
      }
    } catch (err) {
      console.error('fetchConfig error:', err)
      toast.error('Failed to load WhatsApp configuration')
      setStatus('disconnected')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  async function handleSave() {
    if (!phoneNumberId.trim()) { toast.error('Phone Number ID is required'); return }
    if (!hasConfig && (!accessToken.trim() || !tokenEdited)) {
      toast.error('Access Token is required for initial setup'); return
    }
    if (hasConfig && !tokenEdited) {
      toast.error('Please re-enter the Access Token to save changes'); return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        phone_number_id: phoneNumberId.trim(),
        waba_id:         wabaId.trim() || null,
        verify_token:    verifyToken.trim() || null,
        access_token:    accessToken.trim(),
      }

      const res  = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json() as { error?: string; phone_info?: { verified_name?: string } }

      if (!res.ok) { toast.error(data.error ?? 'Failed to save configuration'); return }

      toast.success(
        data.phone_info?.verified_name
          ? `Connected to ${data.phone_info.verified_name}`
          : 'Configuration saved successfully'
      )
      await fetchConfig()
    } catch (err) {
      console.error('Save error:', err)
      toast.error('Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  async function handleTestConnection() {
    setTesting(true)
    try {
      const res     = await fetch('/api/whatsapp/config')
      const payload = await res.json() as { connected?: boolean; needs_reset?: boolean; reason?: string; message?: string; phone_info?: { verified_name?: string } }

      if (payload.connected) {
        setStatus('connected'); setResetReason(null); setStatusMsg('')
        toast.success(payload.phone_info?.verified_name ? `Connected to ${payload.phone_info.verified_name}` : 'API connection successful')
      } else {
        setStatus('disconnected')
        setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null)
        setStatusMsg(payload.message ?? '')
        toast.error(payload.message ?? 'API connection failed')
      }
    } catch (err) {
      console.error('Test connection error:', err)
      setStatus('disconnected')
      toast.error('Connection test failed. Check network and try again.')
    } finally {
      setTesting(false)
    }
  }

  async function handleReset() {
    if (!confirm('This will delete the current WhatsApp config so you can re-enter it. Continue?')) return
    setResetting(true)
    try {
      const res  = await fetch('/api/whatsapp/config', { method: 'DELETE' })
      const data = await res.json() as { error?: string }
      if (!res.ok) { toast.error(data.error ?? 'Failed to reset configuration'); return }

      toast.success('Configuration cleared. You can now re-enter your credentials.')
      setHasConfig(false)
      setPhoneNumberId(''); setWabaId(''); setAccessToken(''); setVerifyToken('')
      setTokenEdited(false); setStatus('disconnected'); setResetReason(null); setStatusMsg('')
    } catch (err) {
      console.error('Reset error:', err)
      toast.error('Failed to reset configuration')
    } finally {
      setResetting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-violet-500" />
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px] mt-4">
      <div className="space-y-6">

        {/* Corrupted-token banner */}
        {resetReason === 'token_corrupted' && (
          <Alert className="bg-amber-950/40 border-amber-600/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <AlertTitle className="text-amber-200 mb-1">Stored token can&apos;t be decrypted</AlertTitle>
                <AlertDescription className="text-amber-100/80 text-sm">{statusMessage}</AlertDescription>
                <Button onClick={handleReset} disabled={resetting} size="sm" className="mt-3 bg-amber-600 hover:bg-amber-700 text-white">
                  {resetting ? <><Loader2 className="size-4 animate-spin" />Resetting...</> : <><RotateCcw className="size-4" />Reset Configuration</>}
                </Button>
              </div>
            </div>
          </Alert>
        )}

        {/* Connection status */}
        <Alert className="bg-slate-900 border-slate-700">
          <div className="flex items-center gap-2">
            {connectionStatus === 'connected'
              ? <CheckCircle2 className="size-4 text-violet-500" />
              : <XCircle className="size-4 text-red-500" />}
            <AlertTitle className="text-white mb-0">
              {connectionStatus === 'connected' ? 'Connected' : 'Not Connected'}
            </AlertTitle>
          </div>
          <AlertDescription className="text-slate-400">
            {connectionStatus === 'connected'
              ? 'Your WhatsApp Business API is connected and ready to send/receive messages.'
              : statusMessage || 'Configure your Meta API credentials below to connect your WhatsApp Business account.'}
          </AlertDescription>
        </Alert>

        {/* Credentials form */}
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">API Credentials</CardTitle>
            <CardDescription className="text-slate-400">Enter your Meta WhatsApp Business API credentials.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Phone Number ID</Label>
              <Input placeholder="e.g. 100234567890123" value={phoneNumberId}
                onChange={e => setPhoneNumberId(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">WhatsApp Business Account ID</Label>
              <Input placeholder="e.g. 100234567890456" value={wabaId}
                onChange={e => setWabaId(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500" />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Permanent Access Token</Label>
              <div className="relative">
                <Input type={showToken ? 'text' : 'password'} placeholder="Enter your access token"
                  value={accessToken}
                  onChange={e => { setAccessToken(e.target.value); setTokenEdited(true) }}
                  onFocus={() => { if (accessToken === MASKED_TOKEN) { setAccessToken(''); setTokenEdited(true) } }}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 pr-10" />
                <button type="button" onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {hasConfig && !tokenEdited && (
                <p className="text-xs text-slate-500">Token is hidden for security. Re-enter it to update configuration.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Webhook Verify Token</Label>
              <Input placeholder="Create a custom verify token" value={verifyToken}
                onChange={e => setVerifyToken(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500" />
              <p className="text-xs text-slate-500">A custom string you create. Must match the token you set in Meta webhook settings.</p>
            </div>
          </CardContent>
        </Card>

        {/* Webhook URL */}
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Webhook Configuration</CardTitle>
            <CardDescription className="text-slate-400">Use this URL as your webhook callback in the Meta App Dashboard.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label className="text-slate-300">Webhook Callback URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="bg-slate-800 border-slate-700 text-slate-300 font-mono text-sm" />
                <Button variant="outline" size="icon"
                  onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('Webhook URL copied') }}
                  className="shrink-0 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800">
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <Button onClick={handleSave} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
            {saving ? <><Loader2 className="size-4 animate-spin" />Saving...</> : 'Save Configuration'}
          </Button>
          <Button variant="outline" onClick={handleTestConnection} disabled={testing || !hasConfig}
            className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800">
            {testing ? <><Loader2 className="size-4 animate-spin" />Testing...</> : <><Zap className="size-4" />Test API Connection</>}
          </Button>
          {hasConfig && (
            <Button variant="outline" onClick={handleReset} disabled={resetting}
              className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40">
              {resetting ? <><Loader2 className="size-4 animate-spin" />Resetting...</> : <><RotateCcw className="size-4" />Reset Configuration</>}
            </Button>
          )}
        </div>
      </div>

      {/* Setup guide sidebar */}
      <div>
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base">Setup Instructions</CardTitle>
            <CardDescription className="text-slate-400">Follow these steps to connect your WhatsApp Business API.</CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion>
              {[
                { step: 1, title: 'Create a Meta App', items: ['Go to developers.facebook.com', 'Click "My Apps" → "Create App"', 'Select "Business" as the app type', 'Fill in details and create'] },
                { step: 2, title: 'Add WhatsApp Product', items: ['In your app dashboard, click "Add Product"', 'Find "WhatsApp" and click "Set Up"', 'Follow the wizard to link your business'] },
                { step: 3, title: 'Get API Credentials', items: ['Go to WhatsApp → API Setup', 'Copy your Phone Number ID', 'Copy your WhatsApp Business Account ID', 'Generate a Permanent Access Token from Business Settings → System Users'] },
                { step: 4, title: 'Configure Webhooks', items: ['Go to WhatsApp → Configuration', 'Click "Edit" on the Webhook section', 'Paste the Webhook Callback URL from above', 'Enter the same Verify Token you set here', 'Subscribe to "messages" webhook field'] },
              ].map(({ step, title, items }) => (
                <AccordionItem key={step} className="border-slate-700">
                  <AccordionTrigger className="text-slate-300 hover:text-white hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">{step}</span>
                      {title}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-slate-400">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      {items.map(item => <li key={item}>{item}</li>)}
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            <div className="mt-4 pt-4 border-t border-slate-700">
              <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300 transition-colors">
                <ExternalLink className="size-3.5" />Meta WhatsApp API Documentation
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
