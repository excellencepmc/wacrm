"use client";

import { useEffect, useState, useRef } from "react";

/**
 * Polls /api/conversations/unread-count every 5 s.
 * Replaces the Supabase Realtime subscription from the original hook.
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchCount = async () => {
      try {
        const res = await fetch("/api/conversations/unread-count");
        if (!res.ok || !mountedRef.current) return;
        const { count } = await res.json() as { count: number };
        setTotal(count ?? 0);
      } catch {
        // ignore — next poll will retry
      }
    };

    fetchCount(); // immediate first load
    const timer = setInterval(fetchCount, 5000);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, []);

  return total;
}
