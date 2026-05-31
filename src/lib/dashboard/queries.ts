// Thin fetch wrappers — the actual SQL lives in /api/dashboard/route.ts.
// These functions keep the same signatures the dashboard page expects.
import type {
  ActivityItem, ConversationsSeriesPoint, MetricsBundle,
  PipelineDonutData, ResponseTimeSummary,
} from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any // kept for call-site compatibility; no longer used

export async function loadMetrics(_db: DB): Promise<MetricsBundle> {
  const res = await fetch('/api/dashboard?section=metrics')
  if (!res.ok) throw new Error('Failed to load metrics')
  return res.json()
}

export async function loadConversationsSeries(_db: DB, rangeDays: number): Promise<ConversationsSeriesPoint[]> {
  const res = await fetch(`/api/dashboard?section=conversations_series&days=${rangeDays}`)
  if (!res.ok) throw new Error('Failed to load conversations series')
  return res.json()
}

export async function loadPipelineDonut(_db: DB): Promise<PipelineDonutData> {
  const res = await fetch('/api/dashboard?section=pipeline_donut')
  if (!res.ok) throw new Error('Failed to load pipeline donut')
  return res.json()
}

export async function loadResponseTime(_db: DB): Promise<ResponseTimeSummary> {
  // Response time analysis is now handled server-side too.
  const res = await fetch('/api/dashboard?section=response_time')
  if (!res.ok) return { buckets: [], thisWeekAvg: null, lastWeekAvg: null }
  return res.json()
}

export async function loadActivity(_db: DB, limit = 20): Promise<ActivityItem[]> {
  const res = await fetch(`/api/dashboard?section=activity&limit=${limit}`)
  if (!res.ok) throw new Error('Failed to load activity')
  return res.json()
}
