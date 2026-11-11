import { useState, type FormEvent, type KeyboardEvent } from "react";
import { MAX_COMMENT } from "../shared/domain";
import type { User } from "./api";

const MAX_SUGGESTIONS = 5;
/** How a mention reads in a comment; sending and highlighting both match this. */
const token = (member: User) => `@${member.name}`;
/** The "@query" being typed at the end of the comment, if any. */
const typingMention = (text: string) => /(?:^|\s)@([^@\n]{0,30})$/.exec(text)?.[1];

/** Comment box with @-suggestions from the team; Enter picks the first suggestion while the list is open. */
export function CommentBox({ team, onSend }: { team: User[]; onSend: (body: string, mentions: number[]) => Promise<boolean> }) {
  const [text, setText] = useState("");
  // Exactly who was picked from the list, so "@Sam Cruz" never also counts as a "Sam".
  const [picked, setPicked] = useState<User[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const query = dismissed ? undefined : typingMention(text);
  const suggestions =
    query === undefined ? [] : team.filter((m) => m.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, MAX_SUGGESTIONS);

  function pick(member: User) {
    setText(`${text.slice(0, text.length - query!.length)}${member.name} `);
    setPicked((all) => (all.some((m) => m.id === member.id) ? all : [...all, member]));
  }

  const current = suggestions[Math.min(active, suggestions.length - 1)];

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!current) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (Math.min(i, suggestions.length - 1) + step + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(current);
    } else if (e.key === "Escape") {
      e.preventDefault(); // close the list, not the drawer
      setDismissed(true);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    // A pick whose "@Name" was deleted from the text no longer counts.
    const saved = await onSend(
      text,
      picked.filter((m) => text.includes(token(m))).map((m) => m.id),
    );
    if (!saved) return; // keep what they wrote
    setText("");
    setPicked([]);
  }

  return (
    <form className="comment-form" onSubmit={submit}>
      <div className="mention-box">
        <input
          placeholder="Write a comment… (@ to mention someone)"
          aria-label="Write a comment"
          required
          maxLength={MAX_COMMENT}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDismissed(false);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-autocomplete="list"
          aria-activedescendant={current ? `mention-${current.id}` : undefined}
          aria-expanded={suggestions.length > 0}
          aria-controls="mention-suggestions"
        />
        {suggestions.length > 0 && (
          <ul id="mention-suggestions" className="mention-suggestions" role="listbox" aria-label="Mention someone">
            {suggestions.map((m) => (
              <li key={m.id} id={`mention-${m.id}`} role="option" aria-selected={m === current}>
                <button type="button" onClick={() => pick(m)}>
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="primary">Send</button>
    </form>
  );
}

/** A comment's text with its mentions highlighted. */
export function CommentText({ body, mentions, team }: { body: string; mentions: number[]; team: User[] }) {
  // Longest first, so "@Sam Cruz" wins over a "@Sam" inside it.
  const names = team
    .filter((m) => mentions.includes(m.id))
    .map(token)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return <p>{body}</p>;
  const pattern = new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  return (
    <p>
      {body.split(pattern).map((part, i) =>
        names.includes(part) ? (
          <mark key={i} className="mention">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </p>
  );
}
