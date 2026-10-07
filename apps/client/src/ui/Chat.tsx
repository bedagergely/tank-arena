import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { useRoomMessage } from "@colyseus/react";
import { MAX_CHAT_LENGTH } from "@tank-arena/shared";
import type { GameRoom } from "../net/client.ts";

interface Props {
  room: GameRoom;
}

interface FeedEntry {
  id: number;
  kind: "chat" | "system";
  name?: string;
  from?: string;
  text: string;
  at: number;
}

const MAX_FEED = 200;

export function Chat({ room }: Props) {
  // The server only relays chat; this component's state is the only copy of the feed.
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const nextId = useRef(1);
  const push = (entry: Omit<FeedEntry, "id">) =>
    setFeed((prev) => [...prev, { ...entry, id: nextId.current++ }].slice(-MAX_FEED));
  useRoomMessage(room, "chat", (m) => push({ kind: "chat", name: m.name, from: m.from, text: m.text, at: m.at }));
  useRoomMessage(room, "system", (m) => push({ kind: "system", text: m.text, at: m.at }));

  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed]);

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    room.send("chat", { text });
    setDraft("");
  }

  return (
    <section className="card border border-base-300 bg-base-200">
      <div className="card-body gap-2 p-4">
        <h3 className="text-xs font-semibold tracking-wide text-base-content/60 uppercase">Chat</h3>
        <ul className="flex h-64 flex-col gap-1 overflow-y-auto pr-1" ref={listRef}>
          {feed.map((m) =>
            m.kind === "system" ? (
              <li key={m.id} className="text-center text-sm text-base-content/50 italic">
                {m.text}
              </li>
            ) : (
              <li key={m.id} className={`chat ${m.from === room.sessionId ? "chat-end" : "chat-start"}`}>
                <div className="chat-header text-xs opacity-60">{m.name}</div>
                <div className={`chat-bubble ${m.from === room.sessionId ? "chat-bubble-primary" : ""}`}>{m.text}</div>
              </li>
            ),
          )}
        </ul>
        <form className="flex gap-2" onSubmit={onSubmit}>
          <input
            className="input input-sm flex-1"
            value={draft}
            maxLength={MAX_CHAT_LENGTH}
            placeholder="Say something…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
