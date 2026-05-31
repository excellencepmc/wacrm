"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus } from "@/types";
import { Search, ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-violet-500", pending: "bg-amber-500", closed: "bg-slate-500",
};
const FILTER_OPTIONS: { label: string; value: ConversationStatus | "all" }[] = [
  { label: "All", value: "all" }, { label: "Open", value: "open" },
  { label: "Pending", value: "pending" }, { label: "Closed", value: "closed" },
];

export function ConversationList({ activeConversationId, onSelect, conversations, onConversationsLoaded }: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationStatus | "all">("all");
  const [loading, setLoading] = useState(true);

  const onLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => { onLoadedRef.current = onConversationsLoaded; });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/conversations');
        if (cancelled) return;
        if (!res.ok) { console.error('Failed to fetch conversations:', res.status); setLoading(false); return; }
        const data = await res.json();
        onLoadedRef.current(data ?? []);
      } catch (err) {
        console.error('Failed to fetch conversations:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    let result = conversations;
    if (filter !== "all") result = result.filter(c => c.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const last = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || last.includes(q);
      });
    }
    return result;
  }, [conversations, filter, search]);

  const activeFilter = FILTER_OPTIONS.find(o => o.value === filter);

  return (
    <div className="flex h-full w-full flex-col border-r border-slate-800 bg-slate-900 lg:w-80">
      <div className="space-y-2 border-b border-slate-800 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations..."
            className="border-slate-700 bg-slate-800 pl-9 text-sm text-white placeholder-slate-500 focus:border-violet-500/50" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-slate-400 hover:text-white rounded-md hover:bg-slate-800">
            {activeFilter?.label ?? "All"} <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="border-slate-700 bg-slate-800">
            {FILTER_OPTIONS.map(opt => (
              <DropdownMenuItem key={opt.value} onClick={() => setFilter(opt.value)}
                className={cn("text-sm", filter === opt.value ? "text-violet-400" : "text-slate-300")}>
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center"><p className="text-sm text-slate-500">No conversations found</p></div>
        ) : (
          <div className="flex flex-col">
            {filtered.map(conv => (
              <ConversationItem key={conv.id} conversation={conv} isActive={conv.id === activeConversationId} onSelect={onSelect} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function ConversationItem({ conversation, isActive, onSelect }: { conversation: Conversation; isActive: boolean; onSelect: (c: Conversation) => void }) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Unknown";
  const initials = displayName.charAt(0).toUpperCase();
  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), { addSuffix: false }) : "";
  const hasUnread = (conversation.unread_count ?? 0) > 0;

  return (
    <button onClick={() => onSelect(conversation)}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-800/50",
        isActive && "border-l-2 border-violet-500 bg-slate-800/70",
        hasUnread && !isActive && "bg-slate-800/30",
      )}>
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-medium text-white">
        {contact?.avatar_url ? <img src={contact.avatar_url} alt={displayName} className="h-10 w-10 rounded-full object-cover" /> : initials}
        {hasUnread && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-violet-500 ring-2 ring-slate-900" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", hasUnread ? "font-bold text-white" : "font-medium text-white")}>
            {displayName}
          </span>
          <span className={cn("shrink-0 text-[10px]", hasUnread ? "font-semibold text-violet-400" : "text-slate-500")}>
            {timeAgo}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className={cn("truncate text-xs", hasUnread ? "font-medium text-slate-200" : "text-slate-400")}>
            {conversation.last_message_text || "No messages yet"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {hasUnread && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white">
                {conversation.unread_count}
              </span>
            )}
            <span className={cn("h-2 w-2 rounded-full", STATUS_COLORS[conversation.status as ConversationStatus] ?? "bg-slate-500")} />
          </div>
        </div>
      </div>
    </button>
  );
}
