import { useEffect, useState, type FormEvent } from "react";
import { api, ROLE_LABEL, type Invite, type Role, type User } from "./api";
import { ErrorText, useAction } from "./ui";

const DEMOS: { role: Role; blurb: string }[] = [
  { role: "admin", blurb: "Everything, plus team and roles" },
  { role: "manager", blurb: "Runs the board, sees activity" },
  { role: "member", blurb: "Works on their own tasks" },
];

type Mode = "demo" | "signin" | "signup" | "join";

const MODES: { mode: Mode; label: string }[] = [
  { mode: "demo", label: "Try the demo" },
  { mode: "signin", label: "Sign in" },
  { mode: "signup", label: "Create account" },
];

/** `inviteToken` comes from App, which owns the invite link; it's null when the page wasn't opened from one. */
export function Login({ inviteToken, onSignedIn }: { inviteToken: string | null; onSignedIn: (user: User) => void }) {
  const { error, setError, run } = useAction();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(inviteToken ? "join" : "demo");
  const [invite, setInvite] = useState<Invite | null>(null);

  useEffect(() => {
    if (inviteToken) run(async () => setInvite(await api.invite(inviteToken)));
  }, [inviteToken, run]);

  async function signIn(attempt: () => Promise<User>) {
    setBusy(true);
    await run(async () => onSignedIn(await attempt()));
    setBusy(false);
  }

  function switchTo(next: Mode) {
    setError("");
    setMode(next);
  }

  function submitSignIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    signIn(() => api.login(String(form.get("email")), String(form.get("password")), form.has("remember")));
  }

  function submitJoin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    signIn(() =>
      api.join({
        token: inviteToken ?? "",
        name: String(form.get("name")),
        email: String(form.get("email")),
        password: String(form.get("password")),
      }),
    );
  }

  function submitSignUp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    signIn(() =>
      api.signup({
        name: String(form.get("name")),
        email: String(form.get("email")),
        password: String(form.get("password")),
        workspace: String(form.get("workspace")),
        website: String(form.get("website")),
      }),
    );
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1>
          <img src="/favicon.svg" alt="" width={32} height={32} /> TaskFlow
        </h1>

        {mode === "join" ? (
          <form className="stack" onSubmit={submitJoin}>
            {invite ? (
              <p>
                Join <strong>{invite.workspace}</strong> as {ROLE_LABEL[invite.role]}. Pick your own password.
              </p>
            ) : (
              <p className="muted">{error ? "" : "Checking your invite…"}</p>
            )}
            <NewAccountFields />
            <button className="primary" disabled={busy || !invite}>
              Join workspace
            </button>
            <button type="button" className="ghost" onClick={() => switchTo("signin")}>
              I already have an account
            </button>
          </form>
        ) : (
          <div className="segmented" role="tablist" aria-label="How to get in">
            {MODES.map((m) => (
              <button key={m.mode} role="tab" aria-selected={mode === m.mode} onClick={() => switchTo(m.mode)}>
                {m.label}
              </button>
            ))}
          </div>
        )}

        {mode === "demo" && (
          <>
            <p className="muted">A shared demo board that resets every night. Pick a role to look around.</p>
            <div className="demo-grid">
              {DEMOS.map((d) => (
                <button key={d.role} className="demo" disabled={busy} onClick={() => signIn(() => api.demoLogin(d.role))}>
                  <span className={`role role-${d.role}`}>{ROLE_LABEL[d.role]}</span>
                  <span className="muted small">{d.blurb}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {mode === "signin" && (
          <form className="stack" onSubmit={submitSignIn}>
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <label className="check">
              <input name="remember" type="checkbox" /> Remember me for 30 days
            </label>
            <button className="primary" disabled={busy}>
              Sign in
            </button>
            <p className="muted small">
              Forgot your password? There's no reset by email, so create a new account with a different address. Unused workspaces are deleted after 30 days.
            </p>
          </form>
        )}

        {mode === "signup" && (
          <form className="stack" onSubmit={submitSignUp}>
            <p className="muted small">You get your own private board and can add your team. Workspaces unused for 30 days are deleted.</p>
            <NewAccountFields />
            <label>
              Workspace name
              <input name="workspace" placeholder="e.g. Acme Design" required maxLength={80} />
            </label>
            <label className="trap" aria-hidden="true">
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
            <button className="primary" disabled={busy}>
              Create account
            </button>
          </form>
        )}

        <ErrorText error={error} />
      </div>
    </div>
  );
}

/** What someone picks for themselves, whether creating a workspace or joining one. */
function NewAccountFields() {
  return (
    <>
      <label>
        Your name
        <input name="name" autoComplete="name" required maxLength={80} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password <span className="muted">(12+ characters)</span>
        <input name="password" type="password" autoComplete="new-password" minLength={12} required />
      </label>
    </>
  );
}
