import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { api, type User } from "./api";
import { ErrorText, useAction } from "./ui";

interface Props {
  me: User;
  team: User[];
  setTeam: Dispatch<SetStateAction<User[]>>;
  onDeleted: () => void;
}

export function AccountPage({ me, team, setTeam, onDeleted }: Props) {
  const passwordChange = useAction();
  const deletion = useAction();
  const [saved, setSaved] = useState(false);
  // Who else is an admin decides the warning, so start from a fresh list; others may have left since sign-in.
  const refreshTeam = () => api.users().then(setTeam);
  useEffect(() => {
    api.users().then(setTeam);
  }, [setTeam]);
  // The server refuses if this is out of date, so the warning always matches what happens.
  const lastAdmin = me.role === "admin" && !team.some((m) => m.id !== me.id && m.role === "admin");

  function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setSaved(false);
    passwordChange.run(async () => {
      await api.changePassword(String(data.get("current")), String(data.get("next")));
      form.reset();
      setSaved(true);
    });
  }

  function deleteAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    deletion.run(async () => {
      try {
        await api.deleteAccount(String(data.get("password")), lastAdmin);
      } catch (err) {
        // A refusal can mean the team changed under us; refresh so the warning is right on retry.
        await refreshTeam();
        throw err;
      }
      onDeleted();
    });
  }

  return (
    <section className="page narrow">
      <h1>Account</h1>
      <p className="muted">
        {me.name} · {me.email}
      </p>

      <h2>Change password</h2>
      <form className="stack" onSubmit={changePassword}>
        <label>
          Current password
          <input name="current" type="password" autoComplete="current-password" required />
        </label>
        <label>
          New password <span className="muted">(12+ characters)</span>
          <input name="next" type="password" autoComplete="new-password" minLength={12} required />
        </label>
        <button className="primary">Change password</button>
        {saved && (
          <p className="muted small" role="status">
            Password changed. You've been signed out everywhere else.
          </p>
        )}
        <ErrorText error={passwordChange.error} />
      </form>

      <h2>Delete account</h2>
      <form className="stack" onSubmit={deleteAccount}>
        <p className="muted small">
          {lastAdmin
            ? `You're the only admin, so this deletes the whole ${me.workspace} workspace: every task, comment and person in it.`
            : "You'll be signed out everywhere and your name and email removed. Your tasks, comments and history stay, shown as \"Deleted user\"."}{" "}
          This can't be undone.
        </p>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <label className="check">
          <input name="confirm" type="checkbox" required /> I understand this can't be undone
        </label>
        {/* The team list (which always includes you) decides the warning, so wait for it. */}
        <button className="danger" disabled={team.length === 0}>
          {lastAdmin ? "Delete account and workspace" : "Delete account"}
        </button>
        <ErrorText error={deletion.error} />
      </form>
    </section>
  );
}
