/**
 * Ask for changes in plain words: "make problem 3 worth 4 points." The reply says what changed,
 * and the changed problems light up in the list.
 */
import { CreatureArt } from "@goblins/ui";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../server/setup/draft";
import { MathText } from "./MathText";

export interface ChatPanelProps {
  readonly messages: ReadonlyArray<ChatMessage>;
  /** The teacher's message waiting on a reply, shown right away. */
  readonly pending: string | null;
  readonly onSend: (message: string) => void;
  /** Example requests that fit this worksheet, shown before the first message. */
  readonly suggestions: ReadonlyArray<string>;
  readonly disabled?: boolean;
}

export function ChatPanel({
  messages,
  pending,
  onSend,
  suggestions,
  disabled = false,
}: ChatPanelProps) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const count = messages.length + (pending === null ? 0 : 1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a message arrives
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [count]);

  const send = (message: string) => {
    const trimmed = message.trim();
    if (trimmed === "" || pending !== null || disabled) return;
    onSend(trimmed);
    setText("");
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send(text);
    }
  };

  return (
    <section className="setup-chat" aria-label="Ask for changes">
      <div className="setup-chat-list" ref={listRef} aria-live="polite">
        <div className="setup-chat-message" data-role="assistant">
          <CreatureArt id={0} size={32} title="" />
          <p className="setup-bubble">
            Here's what the grader will know. Fix anything by clicking it, or tell me what to
            change.
          </p>
        </div>
        {messages.map((message) => (
          <div key={message.id} className="setup-chat-message" data-role={message.role}>
            {message.role === "assistant" && <CreatureArt id={0} size={32} title="" />}
            <MathText text={message.content} className="setup-bubble" />
          </div>
        ))}
        {pending !== null && (
          <>
            <div className="setup-chat-message" data-role="teacher" data-pending>
              <p className="setup-bubble">{pending}</p>
            </div>
            <div className="setup-chat-message" data-role="assistant" data-pending>
              <CreatureArt id={0} size={32} title="" />
              <span className="sr-only">Working on it</span>
              <p className="setup-bubble setup-typing" aria-hidden="true">
                <span />
                <span />
                <span />
              </p>
            </div>
          </>
        )}
      </div>
      {messages.length === 0 && pending === null && (
        <div className="setup-chat-suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="setup-suggestion"
              disabled={disabled}
              onClick={() => send(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <form className="setup-chat-form" onSubmit={onSubmit}>
        <textarea
          aria-label="Message"
          className="setup-chat-input"
          placeholder="Tell the grader what to change…"
          value={text}
          rows={2}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="submit"
          className="setup-chat-send"
          aria-label="Send"
          disabled={disabled || pending !== null || text.trim() === ""}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M8 13V3M3.5 7.5L8 3l4.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
    </section>
  );
}
