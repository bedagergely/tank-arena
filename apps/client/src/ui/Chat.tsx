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
    <section className="chat">
      <h3>Chat</h3>
      <ul className="chat-feed" ref={listRef}>
        {feed.map((m) =>
          m.kind === "system" ? (
            <li key={m.id} className="chat-system">
              {m.text}
            </li>
          ) : (
            <li key={m.id} className={m.from === room.sessionId ? "chat-self" : ""}>
              <strong>{m.name}</strong> {m.text}
            </li>
          ),
        )}
      </ul>
      <form className="chat-form" onSubmit={onSubmit}>
        <input
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Say something…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
