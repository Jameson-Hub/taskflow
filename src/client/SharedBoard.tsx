import { useEffect, useState } from "react";
import { STATUSES } from "../shared/domain";
import { columnOf } from "../shared/moves";
import { api, STATUS_LABEL, type SharedTask } from "./api";
import { ThemeToggle } from "./theme";
import { CardFace, ErrorText } from "./ui";

/** Share links look like `/#share=<token>`. Unlike invites the token stays in the address bar, so the page can be bookmarked. */
export const readShareToken = () => new URLSearchParams(location.hash.slice(1)).get("share");

/** The board as a share link shows it to anyone: no sign-in, nothing to click or change. */
export function SharedBoard({ token }: { token: string }) {
  const [board, setBoard] = useState<{ workspace: string; tasks: SharedTask[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true; // a late answer for a link the tab has moved on from is ignored
    api.sharedBoard(token).then(
      (b) => current && setBoard(b),
      (err: Error) => current && setError(err.message),
    );
    return () => {
      current = false;
    };
  }, [token]);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          TaskFlow
        </a>
        <span className="workspace-name">Read-only</span>
        <div className="whoami">
          <ThemeToggle />
        </div>
      </header>
      <main className="board-page">
        <ErrorText error={error} />
        {!board && !error && <div className="splash" aria-busy="true" />}
        {board && (
          <>
            <h1 className="shared-title">{board.workspace}</h1>
            <div className="board">
              {STATUSES.map((status) => {
                const cards = columnOf(board.tasks, status);
                return (
                  <section key={status} className="column" aria-label={STATUS_LABEL[status]}>
                    <h2>
                      {STATUS_LABEL[status]} <span className="count">{cards.length}</span>
                    </h2>
                    <ul>
                      {cards.map((task) => (
                        <li key={task.id} className="card">
                          <div className="card-body">
                            <CardFace task={task} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
