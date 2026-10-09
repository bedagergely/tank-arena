import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { useRoomMessage } from "@colyseus/react";
import { MAX_CHAT_LENGTH } from "@tank-arena/shared";
import type { GameRoom } from "../net/client.ts";
import { BTN, BTN_PRIMARY, BTN_SM, CARD, CARD_BODY, INPUT_SM } from "./controls.ts";

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
    <section className={CARD}>
      <div className={`${CARD_BODY} gap-2 p-3`}>
        <h3 className="mb-2 font-display text-lg text-primary">Chat</h3>
        <ul ref={listRef} className="m-0 flex h-[260px] list-none flex-col gap-1 overflow-y-auto p-0 pr-1 text-[0.92rem]">
          {feed.map((m) =>
            m.kind === "system" ? (
              <li key={m.id} className="text-base-content/50 italic">
                {m.text}
              </li>
            ) : (
              <li key={m.id} className="break-words">
                <strong className={m.from === room.sessionId ? "text-primary" : ""}>{m.name}</strong> {m.text}
              </li>
            ),
          )}
        </ul>
        <form className="mt-2 flex gap-1.5" onSubmit={onSubmit}>
          <input
            className={`${INPUT_SM} flex-1`}
            value={draft}
            maxLength={MAX_CHAT_LENGTH}
            placeholder="Say something…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className={`${BTN} ${BTN_PRIMARY} ${BTN_SM}`} type="submit" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
