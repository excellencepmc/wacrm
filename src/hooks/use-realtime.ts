"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Message, Conversation } from "@/types";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  enabled?: boolean;
  /** Poll interval in ms (default 4000) */
  pollInterval?: number;
}

/**
 * Replaces Supabase Realtime with polling.
 * Fetches /api/poll?since=<timestamp> every `pollInterval` ms and
 * fires the same callbacks as the original Realtime hook so callers
 * need no changes.
 */
export function useRealtime({
  channelName,
  onMessageEvent,
  onConversationEvent,
  enabled = true,
  pollInterval = 4000,
}: UseRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const onMessageRef      = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  const sinceRef          = useRef<string>(new Date().toISOString());
  const timerRef          = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { onMessageRef.current      = onMessageEvent; });
  useEffect(() => { onConversationRef.current = onConversationEvent; });

  const poll = useCallback(async () => {
    try {
      const url = `/api/poll?since=${encodeURIComponent(sinceRef.current)}&channel=${channelName}`;
      const res = await fetch(url);
      if (!res.ok) return;

      const { messages = [], conversations = [], timestamp } = await res.json() as {
        messages:      Array<{ eventType: string; new: Message;      old: Partial<Message>      }>;
        conversations: Array<{ eventType: string; new: Conversation; old: Partial<Conversation> }>;
        timestamp:     string;
      };

      if (timestamp) sinceRef.current = timestamp;

      messages.forEach(e =>
        onMessageRef.current?.({
          eventType: e.eventType as RealtimeEvent<Message>["eventType"],
          new: e.new,
          old: e.old,
        })
      );
      conversations.forEach(e =>
        onConversationRef.current?.({
          eventType: e.eventType as RealtimeEvent<Conversation>["eventType"],
          new: e.new,
          old: e.old,
        })
      );
    } catch {
      // silently ignore network errors — next poll will retry
    }
  }, [channelName]);

  useEffect(() => {
    if (!enabled) { setIsConnected(false); return; }
    setIsConnected(true);
    timerRef.current = setInterval(poll, pollInterval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      setIsConnected(false);
    };
  }, [enabled, poll, pollInterval]);

  const unsubscribe = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsConnected(false);
  }, []);

  return { isConnected, unsubscribe };
}
