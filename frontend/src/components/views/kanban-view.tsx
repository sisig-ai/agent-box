"use client";

// Ops Board: lanes, cards, filters, search, drag/drop and a 3s poll.
// Ported from the old Alpine implementation (static/js/kanban/*) onto
// ObsidianUI tokens. Card modal lives in ./kanban/card-modal.tsx, the filter
// bar in ./kanban/filter-bar.tsx.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  opsboardApi, type BoardData, type Card, type Lane, type Opname, type SearchHit,
} from "@/lib/api";
import {
  loadFilters, saveFilters, matches, activeOp, hasOp, setOpFilter, valueLabel,
  type Condition,
} from "@/lib/filters";
import { markedParts } from "@/lib/markdown";
import { cardSignature, unreadIds, markRead, markAllRead, visit } from "@/lib/attention";
import { syncedAt } from "@/lib/format";
import { CardModal } from "./kanban/card-modal";
import { FilterBar } from "./kanban/filter-bar";
import { useModal } from "@/components/modal-provider";
import { DashboardButton } from "@/components/block/dashboard-shell";
import "./kanban.css";

const POLL_MS = 3000;
const GROUP_KEY = "opsboard.group";

const CARD_HASH = /^#(?:\/kanban\/)?card-(\d+)(\/edit)?$/;

/* ----- one board card ----- */

interface CardTileProps {
  card: Card;
  hit: SearchHit | null;
  semanticHit: { score: number } | null;
  isSemantic: boolean;
  unread: boolean;
  opActive: boolean;
  laneNames: Record<number, string>;
  showLane: boolean;
  draggable: boolean;
  dragging: boolean;
  onOpen: (card: Card) => void;
  onToggleOp: (opname: string | null) => void;
  onEditOwner: (card: Card, value: string | null) => void;
  onDelete: (card: Card) => void;
  onDragStart: (e: React.DragEvent, card: Card) => void;
  onDragEnd: () => void;
  onDocClick: (prefix: string) => void;
}

function CardTile(props: CardTileProps) {
  const { card, hit, semanticHit, isSemantic, unread, opActive } = props;
  const [ownerEditing, setOwnerEditing] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState("");
  const deleteArmed = useRef(false);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownerRef = useRef<HTMLSpanElement>(null);

  const titleParts = markedParts(hit?.title_marked || card.title);
  const snippet = hit?.snippet
    ? { parts: markedParts(hit.snippet), comment: hit.snippet_source === "comment" }
    : null;
  const tasks = card.body_tasks;

  const tileClass = [
    "kb-card",
    card.archived_at ? "is-archived" : "",
    card.opname ? "has-op" : "",
    hit ? "kb-search-hit" : "",
    isSemantic ? "kb-semantic-hit" : "",
    unread ? "attention-unread" : "",
    props.dragging ? "dragging" : "",
  ].filter(Boolean).join(" ");

  const commitOwner = () => {
    setOwnerEditing(false);
    const value = ownerDraft.trim() || null;
    if (value !== (card.owner || null)) props.onEditOwner(card, value);
  };

  const onCardDelete = () => {
    if (deleteArmed.current) {
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      deleteArmed.current = false;
      props.onDelete(card);
      return;
    }
    deleteArmed.current = true;
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    deleteTimer.current = setTimeout(() => { deleteArmed.current = false; }, 3000);
  };

  return (
    <div
      className={tileClass}
      data-id={card.id}
      tabIndex={0}
      role="button"
      aria-label={`card ${card.title}`}
      draggable={props.draggable}
      onDragStart={(e) => props.onDragStart(e, card)}
      onDragEnd={props.onDragEnd}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("input, button, a, .kb-owner, .kb-opname")) return;
        props.onOpen(card);
      }}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) props.onOpen(card); }}
    >
      {card.opname && (
        <button
          type="button"
          className={`kb-opname${opActive ? " active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleOp(opActive ? null : card.opname);
          }}
        >
          <span className="kb-opname-ico">◆</span>
          <span className="kb-opname-txt">{card.opname}</span>
        </button>
      )}
      <div className="kb-card-title">
        {titleParts.map((part, i) => (
          <span key={i} className={part.mark ? "kb-hl" : undefined}>{part.text}</span>
        ))}
      </div>
      {card.body_preview && !snippet && (
        <div className="kb-card-preview">{card.body_preview}</div>
      )}
      {snippet && (
        <div className="kb-card-snippet">
          {snippet.comment && (
            <span className="kb-snippet-src" title="Matched a comment">c:</span>
          )}
          {snippet.parts.map((part, i) => (
            <span key={i} className={part.mark ? "kb-hl" : undefined}>{part.text}</span>
          ))}
        </div>
      )}
      <div className="kb-card-meta">
        {isSemantic && semanticHit && (
          <span className="kb-semantic-score" title="Matched by meaning, not by exact words">
            ≈ {semanticHit.score.toFixed(2)}
          </span>
        )}
        <span
          className={`kb-owner${card.owner ? "" : " none"}`}
          title="Click to set owner (blank clears)"
          ref={ownerRef}
          onClick={(e) => {
            e.stopPropagation();
            setOwnerDraft(card.owner || "");
            setOwnerEditing(true);
          }}
        >
          {ownerEditing ? (
            <input
              className="kb-inline"
              value={ownerDraft}
              maxLength={100}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => setOwnerDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitOwner(); }
                if (e.key === "Escape") setOwnerEditing(false);
              }}
              onBlur={commitOwner}
            />
          ) : (
            card.owner ? `@${card.owner}` : "+ owner"
          )}
        </span>
        {card.has_body && <span className="kb-badge kb-badge-body" title="Has a description">≡</span>}
        {tasks && tasks.total > 0 && (
          <span className={`kb-badge kb-badge-tasks${tasks.done === tasks.total ? " done" : ""}`}>
            ☑ {tasks.done}/{tasks.total}
          </span>
        )}
        {card.comment_count > 0 && <span className="kb-badge kb-badge-comments">c:{card.comment_count}</span>}
        {card.subtask_count > 0 && (
          <span className="kb-badge kb-badge-subtasks" title="Open subtasks">↳{card.subtask_count}</span>
        )}
        {props.showLane && (
          <span className="kb-badge kb-badge-lane" title="Lane this card sits in">
            {props.laneNames[card.lane_id] || "?"}
          </span>
        )}
        {card.archived_at && <span className="kb-badge kb-badge-archived">archived</span>}
        <span className="kb-id">#{card.id}</span>
        <button type="button" className="kb-icon kb-del" title="Delete card (click twice)" onClick={onCardDelete}>×</button>
      </div>
      {(card.docs || []).length > 0 && (
        <div className="kb-card-docs">
          {card.docs.map((prefix) => (
            <a
              key={prefix}
              className="kb-doc"
              href={`#/docs/${prefix}`}
              title={`Open ${prefix}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onDocClick(prefix);
              }}
            >
              ↳ {prefix}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----- one lane column ----- */

interface LaneColumnProps {
  lane: Lane;
  cards: Card[];
  boardCards: Card[];
  hitFor: (card: Card) => SearchHit | null;
  semanticFor: (card: Card) => { score: number } | null;
  isSemantic: (card: Card) => boolean;
  unreadSet: Set<number>;
  opActive: (opname: string | null) => boolean;
  laneNames: Record<number, string>;
  group: "lane" | "owner";
  searching: boolean;
  defaultOp: string;
  onOpen: (card: Card) => void;
  onToggleOp: (opname: string | null) => void;
  onEditOwner: (card: Card, value: string | null) => void;
  onDelete: (card: Card) => void;
  onRenameLane: (lane: Lane, name: string) => void;
  onDeleteLane: (lane: Lane) => void;
  onArchiveDone: () => void;
  onMoveToDone: (lane: Lane) => void;
  onAddCard: (laneId: number, card: { title: string; owner: string; opname: string }) => void;
  onDragStart: (e: React.DragEvent, card: Card) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent, laneId: number) => void;
  onDocClick: (prefix: string) => void;
}

function LaneColumn(props: LaneColumnProps) {
  const { lane, cards } = props;
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addOwner, setAddOwner] = useState("");
  const [addOpname, setAddOpname] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(lane.name);
  const [dropOver, setDropOver] = useState(false);
  const [armState, setArmState] = useState<"none" | "archive" | "move">("none");
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const opnames = useMemo(
    () => [...new Set(props.boardCards.map((c) => c.opname).filter(Boolean))] as string[],
    [props.boardCards],
  );

  const isDone = lane.name.toLowerCase() === "done";
  const isWaiting = lane.name.toLowerCase() === "waiting for command";
  const liveCount = cards.filter((c) => !c.archived_at && !c.parent_id).length;

  const arm = (kind: "archive" | "move" | "none", fire: () => void, label: string) => {
    if (armState === kind) {
      if (armTimer.current) clearTimeout(armTimer.current);
      setArmState("none");
      fire();
      return;
    }
    setArmState(kind);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmState("none"), 3000);
    void label;
  };

  const submitAdd = () => {
    const title = addTitle.trim();
    if (!title) { setAddOpen(false); return; }
    props.onAddCard(lane.id, { title, owner: addOwner, opname: addOpname });
    setAddOpen(false);
    setAddTitle("");
    setAddOwner("");
    setAddOpname("");
  };

  const commitRename = () => {
    setRenameOpen(false);
    const value = renameDraft.trim();
    if (value && value !== lane.name) props.onRenameLane(lane, value);
  };

  return (
    <div className={`kb-lane${dropOver ? " over" : ""}`} data-lane-id={lane.id}>
      <div className="kb-lane-head">
        {renameOpen ? (
          <input
            className="kb-inline kb-lane-rename"
            value={renameDraft}
            maxLength={60}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
              if (e.key === "Escape") setRenameOpen(false);
            }}
            onBlur={commitRename}
          />
        ) : (
          <span
            className="kb-lane-name"
            title="Click to rename"
            onClick={() => { setRenameDraft(lane.name); setRenameOpen(true); }}
          >
            {lane.name}
          </span>
        )}
        <span className="kb-count">{cards.length}</span>
        {isDone && (
          <button
            type="button"
            className="kb-archive-btn"
            disabled={!cards.length}
            onClick={() => arm("archive", props.onArchiveDone, "archive?")}
          >
            {armState === "archive" ? "archive?" : "Archive Done"}
          </button>
        )}
        {isWaiting && (
          <button
            type="button"
            className="kb-archive-btn kb-move-done-btn"
            disabled={!liveCount}
            onClick={() => arm("move", () => props.onMoveToDone(lane), "move?")}
          >
            {armState === "move" ? `move ${liveCount}?` : "Move to Done"}
          </button>
        )}
        <button
          type="button"
          className="kb-icon kb-lane-del"
          title="Delete empty lane"
          disabled={cards.length > 0}
          onClick={() => arm("none", () => props.onDeleteLane(lane), "delete?")}
        >
          ×
        </button>
      </div>
      <div
        className="kb-cards"
        data-lane-id={lane.id}
        ref={titleRef}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("text/plain")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false);
        }}
        onDrop={(e) => {
          setDropOver(false);
          props.onDrop(e, lane.id);
        }}
      >
        {cards.map((card) => (
          <CardTile
            key={card.id}
            card={card}
            hit={props.hitFor(card)}
            semanticHit={props.semanticFor(card)}
            isSemantic={props.isSemantic(card)}
            unread={props.unreadSet.has(card.id)}
            opActive={props.opActive(card.opname)}
            laneNames={props.laneNames}
            showLane={props.group === "owner"}
            draggable={props.group !== "owner" && !props.searching && !card.archived_at}
            dragging={false}
            onOpen={props.onOpen}
            onToggleOp={props.onToggleOp}
            onEditOwner={props.onEditOwner}
            onDelete={props.onDelete}
            onDragStart={props.onDragStart}
            onDragEnd={props.onDragEnd}
            onDocClick={props.onDocClick}
          />
        ))}
      </div>
      <div className="kb-add">
        {!addOpen ? (
          <button
            type="button"
            className="kb-add-open"
            onClick={() => {
              setAddOpen(true);
              setAddOpname(props.defaultOp || "");
              setTimeout(() => addInputRef.current?.focus(), 0);
            }}
          >
            + Add card
          </button>
        ) : (
          <form
            className="kb-add-form"
            data-lane-id={lane.id}
            onSubmit={(e) => { e.preventDefault(); submitAdd(); }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setAddOpen(false); } }}
          >
            <input
              ref={addInputRef}
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder="Card title"
              maxLength={500}
            />
            <input
              className="kb-add-owner"
              value={addOwner}
              onChange={(e) => setAddOwner(e.target.value)}
              placeholder="owner (optional)"
              maxLength={100}
            />
            <input
              className="kb-add-opname"
              value={addOpname}
              onChange={(e) => setAddOpname(e.target.value)}
              placeholder="opname (optional)"
              maxLength={100}
              list="kb-opname-list"
            />
            <div className="kb-add-actions">
              <DashboardButton type="submit">Add</DashboardButton>
              <DashboardButton type="button" variant="ghost" onClick={() => setAddOpen(false)}>Cancel</DashboardButton>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ----- the board view ----- */

export function KanbanView({ active }: { active: boolean }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [archived, setArchived] = useState<Card[] | null>(null);
  const [filters, setFilters] = useState<Condition[]>(() => loadFilters());
  const [group, setGroup] = useState<"lane" | "owner">(() =>
    (typeof window !== "undefined" && localStorage.getItem(GROUP_KEY) === "owner") ? "owner" : "lane");
  const [status, setStatus] = useState("loading…");
  const [statusError, setStatusError] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Record<number, SearchHit>>({});
  const [semantic, setSemantic] = useState<Record<number, { score: number }>>({});
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchNote, setSearchNote] = useState("");
  const [unreadSet, setUnreadSet] = useState<Set<number>>(new Set());
  const [addLaneOpen, setAddLaneOpen] = useState(false);
  const [laneDraft, setLaneDraft] = useState("");
  const [modalCardId, setModalCardId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [opnames, setOpnames] = useState<Opname[]>([]);
  const archivedLoad = useRef<Promise<void> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  const sigRef = useRef("");
  const laneInputRef = useRef<HTMLInputElement>(null);
  const openModal = useModal();

  /* ---- data ---- */

  const refresh = useCallback(async (force = false) => {
    try {
      const fresh = await opsboardApi.board();
      setData(fresh);
      if (force) setArchived(null);
      const sig = JSON.stringify(fresh);
      const changed = sig !== sigRef.current;
      sigRef.current = sig;
      // search re-runs on refresh while a query is active
      if (q) {
        void ensureArchived().then(() => runSearch(q, true));
      } else {
        setArchived(null);
      }
      if (changed) runAttention(fresh.cards);
      setStatus(`synced ${syncedAt()}`);
      setStatusError(false);
    } catch (err) {
      setStatus(`sync failed: ${(err as Error).message}`);
      setStatusError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const ensureArchived = useCallback(async () => {
    if (!q) { setArchived(null); return; }
    if (archived) return;
    if (!archivedLoad.current) {
      archivedLoad.current = opsboardApi.archived()
        .then((rows) => { setArchived(rows); })
        .catch(() => setArchived([]))
        .finally(() => { archivedLoad.current = null; });
    }
    await archivedLoad.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, archived]);

  const runAttention = useCallback((cards: Card[]) => {
    const items = cards
      .filter((card) => !card.archived_at)
      .map((card) => ({
        id: card.id,
        sig: cardSignature(card as unknown as Record<string, unknown>),
        lane: card.lane_id,
      }));
    const unread = unreadIds("kanban", items);
    visit("kanban", items, items.map((i) => i.id));
    setUnreadSet((prev) => {
      const next = new Set(prev);
      const live = new Set(items.map((i) => i.id));
      for (const id of unread) next.add(id);
      for (const id of [...next]) if (!live.has(id)) next.delete(id);
      return next;
    });
  }, []);

  /* ---- polling ---- */

  useEffect(() => {
    refresh(true);
    if (!active) return;
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /* ---- search ---- */

  const runSearch = useCallback(async (raw: string, quiet = false) => {
    const wanted = raw.trim();
    const seq = ++searchSeq.current;
    if (wanted.length < 2) {
      setQ("");
      setHits({});
      setSemantic({});
      setSearchTotal(0);
      setSearchNote("");
      setArchived(null);
      return;
    }
    setQ(wanted);
    try {
      const res = await opsboardApi.search(wanted, { limit: 200, archived: "include" });
      if (seq !== searchSeq.current) return;
      setHits(Object.fromEntries((res.cards || []).map((row) => [row.card_id, row])));
      setSearchTotal(res.total ?? Object.keys(hits).length);
      setSearchNote("");
    } catch (err) {
      if (seq !== searchSeq.current) return;
      setHits({});
      setSearchTotal(0);
      setSearchNote(`search failed: ${(err as Error).message}`);
    }
    if (!quiet) setSearchNote(noteText());
    void loadSemantic(wanted, seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSemantic = useCallback(async (query: string, seq: number) => {
    try {
      const res = await opsboardApi.semantic(query, { limit: 10, archived: "exclude" });
      if (seq !== searchSeq.current) return;
      setSemantic(Object.fromEntries((res.hits || []).map((hit) => [hit.id, hit])));
      setSearchNote(noteText());
    } catch (err) {
      if (seq !== searchSeq.current) return;
      setSemantic({});
      setSearchNote(noteText(`semantic unavailable: ${(err as Error).message}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noteText = useCallback((extra = "") => {
    if (!q) return "";
    const hitCount = Object.keys(hits).length;
    const archivedHits = Object.values(hits).filter((row) => row.archived_at).length;
    const semanticCount = Object.keys(semantic).length;
    return `search “${q}” · ${searchTotal} match${searchTotal === 1 ? "" : "es"}`
      + (archivedHits ? ` · ${archivedHits} archived` : "")
      + (searchTotal > hitCount ? ` · showing ${hitCount}` : "")
      + (semanticCount ? ` · ${semanticCount} semantic` : "")
      + (extra ? ` · ${extra}` : "");
  }, [q, hits, semantic, searchTotal]);

  const onSearchInput = (value: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(value), 180);
  };

  const clearSearch = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchSeq.current++;
    setQ("");
    setHits({});
    setSemantic({});
    setSearchTotal(0);
    setSearchNote("");
    setArchived(null);
  };

  /* ---- filters ---- */

  const setFiltersPersist = useCallback((list: Condition[]) => {
    setFilters(list);
    saveFilters(list);
  }, []);

  /* ---- derived board state ---- */

  const laneNames = useMemo(
    () => Object.fromEntries((data?.lanes || []).map((lane) => [lane.id, lane.name])),
    [data],
  );

  const pool = useMemo(
    () => (archived ? (data?.cards || []).concat(archived) : data?.cards || []),
    [data, archived],
  );

  const doneLane = useMemo(
    () => (data?.lanes || []).find((lane) => lane.name.toLowerCase() === "done") || null,
    [data],
  );

  const laneOf = useCallback((card: Card) =>
    (card.archived_at && doneLane ? doneLane.id : card.lane_id), [doneLane]);

  const searching = q !== "";

  const matchingCards = useMemo(() => {
    let list = pool;
    if (searching) {
      list = list.filter((card) => hits[card.id] || semantic[card.id]);
    }
    list = list.filter((card) => matches(filters, card, (c) => laneOf(c as Card) as string | number));
    return list.slice().sort((a, b) => ((a.archived_at ? 1 : 0) - (b.archived_at ? 1 : 0)));
  }, [pool, searching, hits, semantic, filters, laneOf]);

  const cardsFor = useCallback(
    (laneId: number) => matchingCards.filter((card) => laneOf(card) === laneId),
    [matchingCards, laneOf],
  );

  const ownerColumns = useMemo(() => {
    const byOwner = new Map<string, Card[]>();
    for (const card of matchingCards) {
      const key = (card.owner || "").trim();
      if (!byOwner.has(key)) byOwner.set(key, []);
      byOwner.get(key)!.push(card);
    }
    const named = [...byOwner.keys()].filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return [...named, ...(byOwner.has("") ? [""] : [])]
      .map((key) => ({ key, name: key ? `@${key}` : "unassigned", cards: byOwner.get(key) || [] }));
  }, [matchingCards]);

  const countText = useMemo(() => {
    const lanes = data?.lanes || [];
    const total = pool.length;
    const shown = matchingCards.length;
    const archivedCount = lanes.reduce((n, lane) => n + (lane.archived_count || 0), 0);
    const unit = group === "owner" ? `${ownerColumns.length} owners` : `${lanes.length} lanes`;
    return `${shown === total ? total : `${shown}/${total}`} card${total === 1 ? "" : "s"} · ${unit}`
      + (archivedCount ? ` · ${archivedCount} archived` : "")
      + (filters.length ? ` · ${filters.length} filter${filters.length === 1 ? "" : "s"}` : "")
      + (searchNote ? ` · ${searchNote}` : "");
  }, [data, pool, matchingCards, group, ownerColumns, filters.length, searchNote]);

  /* ---- mutations ---- */

  const mutate = useCallback(async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      setStatus((err as Error).message);
      setStatusError(true);
    }
    await refresh(true);
  }, [refresh]);

  const openCard = useCallback((card: Card) => {
    markRead("kanban", card.id, cardSignature(card as unknown as Record<string, unknown>), card.lane_id);
    setUnreadSet((prev) => { const next = new Set(prev); next.delete(card.id); return next; });
    setModalCardId(card.id);
    window.history.pushState(null, "", `#/kanban/card-${card.id}`);
  }, []);

  const closeModal = useCallback(() => {
    setModalCardId(null);
    if (CARD_HASH.test(window.location.hash)) {
      window.history.replaceState(null, "", "#/kanban");
    }
  }, []);

  /* ---- hash routing: #/kanban/card-<id>[/edit] and #card-<id> ---- */

  const syncHash = useCallback(() => {
    const m = window.location.hash.match(CARD_HASH);
    if (!m) {
      setModalCardId(null);
      return;
    }
    const id = Number(m[1]);
    const card = (data?.cards || []).find((c) => c.id === id);
    if (card) {
      markRead("kanban", card.id, cardSignature(card as unknown as Record<string, unknown>), card.lane_id);
      setUnreadSet((prev) => { const next = new Set(prev); next.delete(card.id); return next; });
    }
    setModalCardId(id);
  }, [data]);

  useEffect(() => {
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [syncHash]);

  /* ---- Esc: mark all read / clear search ---- */

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (modalCardId !== null) return;
      if (document.querySelector("dialog[open]")) return;
      const a = document.activeElement;
      if (a && a !== document.body && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || (a as HTMLElement).isContentEditable)) {
        // Esc inside the search box clears the search
        if (a.id === "kanban-search") clearSearch();
        return;
      }
      const items = (data?.cards || [])
        .filter((card) => !card.archived_at)
        .map((card) => ({
          id: card.id,
          sig: cardSignature(card as unknown as Record<string, unknown>),
          lane: card.lane_id,
        }));
      markAllRead("kanban", items);
      setUnreadSet(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, modalCardId, data]);

  /* ---- "/" focuses search ---- */

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      e.preventDefault();
      document.getElementById("kanban-search")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  /* ---- drag / drop ---- */

  const onDragStart = useCallback((e: React.DragEvent, card: Card) => {
    setDragId(card.id);
    setDraggingId(card.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(card.id));
  }, []);

  const onDragEnd = useCallback(() => {
    setDraggingId(null);
  }, []);

  const onDrop = useCallback((e: React.DragEvent, laneId: number) => {
    e.preventDefault();
    const id = dragId;
    setDragId(null);
    setDraggingId(null);
    if (id === null) return;
    const laneEl = e.currentTarget as HTMLElement;
    const others = [...laneEl.querySelectorAll<HTMLElement>(".kb-card:not(.dragging)")];
    const y = e.clientY;
    const index = others.findIndex((node) => {
      const r = node.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    const position = index === -1 ? others.length : index;
    void mutate(() => opsboardApi.patchCard(id, { status: String(laneId), position }));
  }, [dragId, mutate]);

  /* ---- render helpers ---- */

  const hitFor = useCallback((card: Card) => hits[card.id] || null, [hits]);
  const semanticFor = useCallback((card: Card) => semantic[card.id] || null, [semantic]);
  const isSemantic = useCallback(
    (card: Card) => searching && !hits[card.id] && !!semantic[card.id],
    [searching, hits, semantic],
  );
  const opActive = useCallback(
    (opname: string | null) => !!opname && hasOp(filters, opname),
    [filters],
  );
  const defaultOp = useMemo(() => activeOp(filters), [filters]);

  const onToggleOp = useCallback((opname: string | null) => {
    setFiltersPersist(setOpFilter(filters, opname || ""));
  }, [filters, setFiltersPersist]);

  const onEditOwner = useCallback((card: Card, value: string | null) => {
    if (value !== (card.owner || null)) void mutate(() => opsboardApi.patchCard(card.id, { owner: value }));
  }, [mutate]);

  const onDelete = useCallback((card: Card) => {
    void mutate(() => opsboardApi.deleteCard(card.id));
  }, [mutate]);

  const onDocClick = useCallback((prefix: string) => {
    window.location.hash = `#/docs/${prefix}`;
  }, []);

  const onArchiveDone = useCallback(() => {
    void mutate(async () => {
      const r = await opsboardApi.archiveDone();
      setStatus(`archived ${r.archived} card${r.archived === 1 ? "" : "s"}`);
    });
  }, [mutate]);

  const onMoveToDone = useCallback((lane: Lane) => {
    void mutate(async () => {
      const r = await opsboardApi.moveLane(lane.name, doneLane?.name || "Done");
      setStatus(`moved ${r.moved} card${r.moved === 1 ? "" : "s"} to ${r.to}`);
    });
  }, [mutate, doneLane]);

  const onRenameLane = useCallback((lane: Lane, name: string) => {
    void mutate(() => opsboardApi.patchLane(lane.id, { name }));
  }, [mutate]);

  const onDeleteLane = useCallback(async (lane: Lane) => {
    void mutate(() => opsboardApi.deleteLane(lane.id));
  }, [mutate]);

  const onAddCard = useCallback((laneId: number, card: { title: string; owner: string; opname: string }) => {
    const payload: Record<string, unknown> = {
      title: card.title,
      owner: card.owner.trim() || null,
      status: String(laneId),
    };
    if (card.opname.trim()) payload.opname = card.opname.trim();
    void mutate(() => opsboardApi.addCard(payload as never));
  }, [mutate]);

  const addLane = useCallback(() => {
    const name = laneDraft.trim();
    setAddLaneOpen(false);
    setLaneDraft("");
    if (name) void mutate(() => opsboardApi.addLane(name));
  }, [laneDraft, mutate]);

  useEffect(() => {
    opsboardApi.opnames().then((ops) => setOpnames(ops || [])).catch(() => {});
  }, []);

  /* ---- render ---- */

  const modalCard = modalCardId !== null ? (data?.cards || []).find((c) => c.id === modalCardId) || null : null;

  return (
    <section className="kanban" aria-label="Ops Board">
      <div className="kanban-head">
        <div className="kanban-title">
          <h2>Ops Board</h2>
          <span className="kanban-sub">drag cards between lanes · click a card to open · agents: /api/opsboard</span>
        </div>
        <div className="kanban-actions">
          <div className="kb-group" role="group" aria-label="Group cards">
            <button
              type="button"
              className={`kb-group-btn${group === "lane" ? " active" : ""}`}
              aria-pressed={group === "lane"}
              title="Group by lane (swimlane)"
              onClick={() => {
                setGroup("lane");
                try { localStorage.setItem(GROUP_KEY, "lane"); } catch { /* storage blocked */ }
              }}
            >[by lane]</button>
            <button
              type="button"
              className={`kb-group-btn${group === "owner" ? " active" : ""}`}
              aria-pressed={group === "owner"}
              title="Group by owner, with the lane on each card"
              onClick={() => {
                setGroup("owner");
                try { localStorage.setItem(GROUP_KEY, "owner"); } catch { /* storage blocked */ }
              }}
            >[by owner]</button>
          </div>
          <div className="kb-search" role="search">
            <input
              id="kanban-search"
              type="search"
              aria-label="Full-text search over cards, bodies and comments"
              title="Search titles, bodies, comments, opnames and owners — Esc clears"
              placeholder="search board…"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); clearSearch(); }
                if (e.key === "Enter") { e.preventDefault(); runSearch(e.currentTarget.value, true); }
              }}
            />
            <button type="button" className="kb-search-clear" title="Clear search" onClick={clearSearch}>×</button>
          </div>
          <FilterBar
            filters={filters}
            lanes={data?.lanes || []}
            cards={pool}
            laneNames={laneNames}
            onChange={setFiltersPersist}
          />
          {!addLaneOpen ? (
            <DashboardButton title="Add a lane" onClick={() => {
              setAddLaneOpen(true);
              setTimeout(() => laneInputRef.current?.focus(), 0);
            }}>+ lane</DashboardButton>
          ) : (
            <input
              ref={laneInputRef}
              className="kb-lane-input"
              maxLength={60}
              placeholder="Lane name"
              onChange={(e) => setLaneDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addLane(); }
                if (e.key === "Escape") { e.preventDefault(); setAddLaneOpen(false); setLaneDraft(""); }
              }}
              onBlur={addLane}
            />
          )}
          <DashboardButton title="Reload the board" onClick={() => refresh(true)}>⟳ refresh</DashboardButton>
        </div>
      </div>
      <div className={`kanban-board${group === "owner" ? " by-owner" : ""}${searching ? " searching" : ""}`} id="kanban-board">
        {group === "lane" && (data?.lanes || []).map((lane) => (
          <LaneColumn
            key={lane.id}
            lane={lane}
            cards={cardsFor(lane.id)}
            boardCards={data?.cards || []}
            hitFor={hitFor}
            semanticFor={semanticFor}
            isSemantic={isSemantic}
            unreadSet={unreadSet}
            opActive={opActive}
            laneNames={laneNames}
            group={group}
            searching={searching}
            defaultOp={defaultOp}
            onOpen={openCard}
            onToggleOp={onToggleOp}
            onEditOwner={onEditOwner}
            onDelete={onDelete}
            onRenameLane={onRenameLane}
            onDeleteLane={onDeleteLane}
            onArchiveDone={onArchiveDone}
            onMoveToDone={onMoveToDone}
            onAddCard={onAddCard}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDrop={onDrop}
            onDocClick={onDocClick}
          />
        ))}
        {group === "owner" && ownerColumns.map((col) => (
          <div key={col.key} className="kb-lane kb-owner-col" data-owner={col.key}>
            <div className="kb-lane-head">
              <span className="kb-lane-name">{col.name}</span>
              <span className="kb-count">{col.cards.length}</span>
            </div>
            <div className="kb-cards">
              {col.cards.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  hit={hitFor(card)}
                  semanticHit={semanticFor(card)}
                  isSemantic={isSemantic(card)}
                  unread={unreadSet.has(card.id)}
                  opActive={opActive(card.opname)}
                  laneNames={laneNames}
                  showLane
                  draggable={false}
                  dragging={draggingId === card.id}
                  onOpen={openCard}
                  onToggleOp={onToggleOp}
                  onEditOwner={onEditOwner}
                  onDelete={onDelete}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDocClick={onDocClick}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="kanban-status">
        <span className={statusError ? "err" : ""}>{status}</span>
        <span>{countText}</span>
      </div>
      <datalist id="kb-opname-list">
        {opnames.map((op) => <option key={op.opname} value={op.opname} />)}
      </datalist>
      {modalCardId !== null && (
        <CardModal
          cardId={modalCardId}
          lanes={data?.lanes || []}
          boardCards={data?.cards || []}
          opnames={opnames}
          onClose={closeModal}
          onRefresh={() => refresh(true)}
          onOpenCard={(id) => {
            setModalCardId(id);
            window.history.pushState(null, "", `#/kanban/card-${id}`);
          }}
          onDocClick={onDocClick}
        />
      )}
    </section>
  );
}
