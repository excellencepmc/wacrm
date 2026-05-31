"use client"

import { useEffect, useState } from "react"
import type { MessageTemplate } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, ChevronRight, LayoutTemplate, Loader2 } from "lucide-react"

interface TemplatePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (template: MessageTemplate, params: string[]) => void
}

function extractVariables(body: string): number[] {
  const ids = new Set<number>()
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) ids.add(Number(m[1]))
  return Array.from(ids).sort((a, b) => a - b)
}

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const v = params[Number(raw) - 1]
    return v?.trim() ? v : `{{${raw}}}`
  })
}

export function TemplatePicker({ open, onOpenChange, onSelect }: TemplatePickerProps) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState<MessageTemplate | null>(null)
  const [params,    setParams]    = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    fetch('/api/templates')
      .then(r => r.json())
      .then((data: MessageTemplate[]) => {
        if (cancelled) return
        // Only approved templates are sendable via Meta
        setTemplates((data ?? []).filter(t => t.status === 'Approved'))
      })
      .catch(err => { if (!cancelled) console.error('Failed to fetch templates:', err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  function handleOpenChange(next: boolean) {
    if (!next) { setSelected(null); setParams([]) }
    onOpenChange(next)
  }

  function pickTemplate(template: MessageTemplate) {
    const vars = extractVariables(template.body_text)
    if (vars.length === 0) { onSelect(template, []); handleOpenChange(false); return }
    setSelected(template)
    setParams(new Array(vars.length).fill(""))
  }

  function confirm() {
    if (!selected) return
    onSelect(selected, params)
    handleOpenChange(false)
  }

  const variables  = selected ? extractVariables(selected.body_text) : []
  const canConfirm = !!selected && variables.every((_, i) => (params[i] ?? "").trim().length > 0)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <LayoutTemplate className="h-4 w-4 text-violet-400" />
            {selected ? selected.name : "Send template"}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {selected
              ? "Fill in the placeholders to render this template."
              : "Pick an approved WhatsApp template to send to this contact."}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-md border border-slate-800 bg-slate-950/50 p-6 text-center">
                <p className="text-sm text-slate-300">No approved templates</p>
                <p className="mt-1 text-xs text-slate-500">
                  Approve a template in Meta WhatsApp Manager, then sync it from Settings → Templates.
                </p>
              </div>
            ) : (
              templates.map(t => (
                <button key={t.id} type="button" onClick={() => pickTemplate(t)}
                  className="w-full rounded-md border border-slate-800 bg-slate-950/50 p-3 text-left transition-colors hover:border-violet-500/40 hover:bg-slate-900">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-white">{t.name}</p>
                        <Badge className="border border-violet-600/30 bg-violet-600/20 text-[10px] text-violet-400">{t.category}</Badge>
                        {t.language && <span className="text-[10px] uppercase text-slate-500">{t.language}</span>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{t.body_text}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-500" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-slate-800 bg-slate-950/50 p-3">
              <p className="mb-1 text-xs text-slate-400">Preview</p>
              <p className="whitespace-pre-wrap text-sm text-slate-200">{renderBodyPreview(selected.body_text, params)}</p>
              {selected.footer_text && <p className="mt-2 text-xs italic text-slate-500">{selected.footer_text}</p>}
            </div>
            {variables.map((v, i) => (
              <div key={v} className="space-y-1">
                <Label className="text-xs text-slate-300">{`Variable {{${v}}}`}</Label>
                <Input value={params[i] ?? ""} onChange={e => { const n=[...params]; n[i]=e.target.value; setParams(n) }}
                  placeholder={`Value for {{${v}}}`}
                  className="border-slate-700 bg-slate-800 text-white placeholder:text-slate-500" />
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button variant="outline" onClick={() => { setSelected(null); setParams([]) }}
                className="border-slate-700 text-slate-300 hover:bg-slate-800">
                <ArrowLeft className="h-4 w-4" />Back
              </Button>
              <Button disabled={!canConfirm} onClick={confirm}
                className="bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                Send template
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => handleOpenChange(false)}
              className="border-slate-700 text-slate-300 hover:bg-slate-800">
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
