"use client"

import { useState, useEffect, useCallback } from 'react'
import { format } from 'date-fns'
import { Search, Home, ChevronLeft, ChevronRight, MessageSquare, Eye, X, Phone, MapPin, BedDouble, Wallet, Calendar, Sofa, Building2, Layers } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Requirement {
  city?: string
  areas?: string[]
  bhk?: string[]
  budget?: string
  furnishing?: string[]
  propType?: string[]
  floor?: string
  moveIn?: string
  parking?: boolean
  petFriendly?: boolean
  lift?: boolean
}

interface Lead {
  id: string
  phone: string
  name: string | null
  tag: string | null
  requirement: Requirement
  created_at: string
}

const PAGE_SIZE = 25

function LeadDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const router = useRouter()
  const req = lead.requirement

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/10 text-sm font-bold text-violet-400">
              {lead.phone.replace(/\D/g, '').slice(-2)}
            </div>
            <div>
              <p className="font-semibold text-white">{lead.phone}</p>
              <p className="text-xs text-slate-400">{format(new Date(lead.created_at), 'dd MMM yyyy, HH:mm')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Tag */}
          {lead.tag && (
            <div className="rounded-xl border border-slate-800 bg-slate-800/50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Summary</p>
              <p className="text-sm text-slate-200">{lead.tag}</p>
            </div>
          )}

          {/* Requirement details */}
          <div className="rounded-xl border border-slate-800 bg-slate-800/50 px-4 py-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property Requirement</p>

            {req.city && (
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <p className="text-[11px] text-slate-500">City</p>
                  <p className="text-sm text-white">{req.city}</p>
                </div>
              </div>
            )}

            {req.areas?.length ? (
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <p className="text-[11px] text-slate-500">Areas</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {req.areas.map(a => (
                      <Badge key={a} className="border-slate-700 bg-slate-700/60 text-xs text-slate-300">{a}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {req.bhk?.length ? (
              <div className="flex items-start gap-3">
                <BedDouble className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <p className="text-[11px] text-slate-500">BHK</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {req.bhk.map(b => (
                      <Badge key={b} className="border-violet-700/30 bg-violet-500/10 text-xs text-violet-400">{b}</Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {req.budget && (
              <div className="flex items-start gap-3">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <p className="text-[11px] text-slate-500">Budget</p>
                  <p className="text-sm font-semibold text-amber-400">{req.budget}</p>
                </div>
              </div>
            )}

            {req.furnishing?.length ? (
              <div className="flex items-start gap-3">
                <Sofa className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <p className="text-[11px] text-slate-500">Furnishing</p>
                  <p className="text-sm text-white">{req.furnishing.join(', ')}</p>
                </div>
              </div>
            ) : null}

            {req.propType?.length ? (
              <div className="flex items-start gap-3">
                <Home className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <p className="text-[11px] text-slate-500">Property Type</p>
                  <p className="text-sm text-white">{req.propType.join(', ')}</p>
                </div>
              </div>
            ) : null}

            {req.floor && req.floor !== 'Any Floor' && (
              <div className="flex items-start gap-3">
                <Layers className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <p className="text-[11px] text-slate-500">Floor</p>
                  <p className="text-sm text-white">{req.floor}</p>
                </div>
              </div>
            )}

            {req.moveIn && req.moveIn !== 'Immediately' && (
              <div className="flex items-start gap-3">
                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <p className="text-[11px] text-slate-500">Move-in</p>
                  <p className="text-sm text-white">{req.moveIn}</p>
                </div>
              </div>
            )}

            {(req.parking || req.petFriendly || req.lift) && (
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-[11px] text-slate-500">Amenities</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {req.parking    && <Badge className="border-green-700/30 bg-green-500/10 text-xs text-green-400">🚗 Parking</Badge>}
                    {req.petFriendly && <Badge className="border-green-700/30 bg-green-500/10 text-xs text-green-400">🐾 Pet Friendly</Badge>}
                    {req.lift       && <Badge className="border-green-700/30 bg-green-500/10 text-xs text-green-400">🛗 Lift</Badge>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-t border-slate-800 p-4 flex gap-3">
          <Button
            className="flex-1 bg-violet-600 text-white hover:bg-violet-500"
            onClick={() => {
              const digits = lead.phone.replace(/\D/g, '')
              window.open(`https://wa.me/${digits}`, '_blank')
            }}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            WhatsApp
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800"
            onClick={() => {
              const digits = lead.phone.replace(/\D/g, '')
              router.push(`/contacts?search=${digits}`)
              onClose()
            }}
          >
            <Phone className="mr-2 h-4 w-4" />
            View Contact
          </Button>
        </div>
      </div>
    </>
  )
}

export default function LeadsPage() {
  const [leads,      setLeads]      = useState<Lead[]>([])
  const [total,      setTotal]      = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [page,       setPage]       = useState(0)
  const [viewLead,   setViewLead]   = useState<Lead | null>(null)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
      if (search.trim()) params.set('search', search.trim())
      const res = await fetch(`/api/leads?${params}`)
      if (!res.ok) return
      const data = await res.json() as { leads: Lead[]; total: number }
      setLeads(data.leads ?? [])
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => { void fetchLeads() }, [fetchLeads])
  useEffect(() => { setPage(0) }, [search])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      {viewLead && <LeadDrawer lead={viewLead} onClose={() => setViewLead(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Rental Leads</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Verified prospects from casasindhu.in — {total.toLocaleString()} total
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search phone, area, BHK…"
          className="border-slate-700 bg-slate-800 pl-9 text-sm text-white placeholder-slate-500 focus:border-violet-500/50"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800">
              <Home className="h-6 w-6 text-slate-600" />
            </div>
            <p className="text-sm text-slate-400">No leads found</p>
            <p className="text-xs text-slate-600">Leads appear when someone verifies on casasindhu.in</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">WhatsApp</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requirement</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Budget</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {leads.map(lead => {
                const req = lead.requirement
                return (
                  <tr key={lead.id} className="transition-colors hover:bg-slate-800/30">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                      {format(new Date(lead.created_at), 'dd MMM yy')}<br />
                      <span className="text-slate-600">{format(new Date(lead.created_at), 'HH:mm')}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">
                          {lead.phone.replace(/\D/g, '').slice(-2)}
                        </div>
                        <div>
                          <p className="font-medium text-white">{lead.phone}</p>
                          {lead.name && <p className="text-xs text-slate-500">{lead.name}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {req.bhk?.map(b => (
                          <Badge key={b} className="border-violet-700/30 bg-violet-500/10 text-[10px] text-violet-400">{b}</Badge>
                        ))}
                        {req.areas?.slice(0, 2).map(a => (
                          <Badge key={a} className="border-slate-700 bg-slate-800 text-[10px] text-slate-300">{a}</Badge>
                        ))}
                        {(req.areas?.length ?? 0) > 2 && (
                          <Badge className="border-slate-700 bg-slate-800 text-[10px] text-slate-500">+{(req.areas?.length ?? 0) - 2} more</Badge>
                        )}
                        {req.city && !req.areas?.length && (
                          <Badge className="border-slate-700 bg-slate-800 text-[10px] text-slate-300">{req.city}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {req.budget ? (
                        <span className="text-sm font-semibold text-amber-400">{req.budget}</span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1.5 px-2.5 text-xs text-slate-400 hover:bg-violet-500/10 hover:text-violet-400"
                          onClick={() => setViewLead(lead)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-slate-500 hover:text-green-400"
                          onClick={() => window.open(`https://wa.me/${lead.phone.replace(/\D/g, '')}`, '_blank')}
                          title="Open WhatsApp"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>{total} leads · page {page + 1} of {totalPages}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="h-8 w-8 p-0 text-slate-400 hover:text-white disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              className="h-8 w-8 p-0 text-slate-400 hover:text-white disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
