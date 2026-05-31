// Replaces the Supabase service-role admin client.
// Automation engine and webhook handler now use the shared pg pool directly.
export { pool as adminPool, query, queryOne, execute } from '@/lib/db'
