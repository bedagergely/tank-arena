import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { MAX_CHAT_LENGTH } from "@tank-arena/shared";
import type { GameRoom } from "../net/client.ts";
import { useChatFeed } from "../net/hooks.ts";

interface Props {
  room: GameRoom;
}

export function Chat({ room }: Props) {
  const feed = useChatFeed(room);
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
