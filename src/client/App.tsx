import { useEffect, useState } from "react";
import { AccountPage } from "./AccountPage";
import { ActivityPage } from "./ActivityPage";
import { api, can, ROLE_LABEL, whenSessionExpires, type User } from "./api";
import { Board } from "./Board";
import { DashboardPage } from "./DashboardPage";
import { inviteToken, Login } from "./Login";
import { TeamPage } from "./TeamPage";
import { parseHash } from "./ui";

const PAGES = ["board", "dashboard", "activity", "team", "account"] as const;
type Page = (typeof PAGES)[number];

const pageFromHash = (): Page => {
  const { page } = parseHash();
  return PAGES.find((p) => p === page) ?? "board";
};

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [team, setTeam] = useState<User[]>([]);
  const [page, setPage] = useState<Page>(pageFromHash);
  // An invite link opened while signed in: offer to sign out and join rather than ignore it.
  const [invitePending, setInvitePending] = useState(() => inviteToken() !== null);

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
    whenSessionExpires(() => setUser(null));
    const onHash = () => setPage(pageFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // Loaded once per sign-in and shared by every page.
  const userId = user?.id;
  useEffect(() => {
    if (userId) api.users().then(setTeam);
  }, [userId]);

  if (user === undefined) return <div className="splash" aria-busy="true" />;
  if (user === null) return <Login onSignedIn={setUser} />;
  if (invitePending) {
    const dismiss = () => {
      history.replaceState(null, "", location.pathname);
      setInvitePending(false);
    };
    const signOutAndJoin = async () => {
      await api.logout();
      setInvitePending(false);
      setUser(null); // Login picks the invite up from the address bar.
    };
    return (
      <div className="login">
        <div className="login-card stack">
          <p>
            This is an invite link, but you're signed in as <strong>{user.name}</strong>. Sign out to join with a new account.
          </p>
          <button className="primary" onClick={signOutAndJoin}>
            Sign out and join
          </button>
          <button className="ghost" onClick={dismiss}>
            Stay signed in
          </button>
        </div>
      </div>
    );
  }

  const tabs: { id: Page; label: string; show: boolean }[] = [
    { id: "board", label: "Board", show: true },
    { id: "dashboard", label: "Dashboard", show: true },
    { id: "activity", label: "Activity", show: can.viewActivity(user) },
    { id: "team", label: "Team", show: can.manageTeam(user) },
    { id: "account", label: "Account", show: !user.demo },
  ];
  const current = tabs.find((t) => t.id === page && t.show)?.id ?? "board";

  function clearUser() {
    location.hash = "";
    setUser(null);
  }

  async function signOut() {
    await api.logout();
    clearUser();
  }

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          TaskFlow
        </a>
        <span className="workspace-name" title="Workspace">
          {user.workspace}
        </span>
        <nav className="tabs" aria-label="Sections">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <a key={t.id} href={`#${t.id}`} aria-current={current === t.id ? "page" : undefined}>
                {t.label}
              </a>
            ))}
        </nav>
        <div className="whoami">
          <span className="who">
            {user.name} <span className={`role role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
          </span>
          <button className="ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      {user.demo_workspace && <p className="notice">Demo workspace. Everything resets at midnight UTC.</p>}
      <main>
        {current === "board" && <Board user={user} team={team} />}
        {current === "dashboard" && <DashboardPage me={user} />}
        {current === "activity" && <ActivityPage team={team} />}
        {current === "team" && <TeamPage me={user} team={team} setTeam={setTeam} />}
        {current === "account" && <AccountPage me={user} team={team} setTeam={setTeam} onDeleted={clearUser} />}
      </main>
    </div>
  );
}
