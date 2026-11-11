import { useEffect, useState } from "react";
import { AccountPage } from "./AccountPage";
import { ActivityPage } from "./ActivityPage";
import { api, can, ROLE_LABEL, whenSessionExpires, type User } from "./api";
import { Board } from "./Board";
import { Login } from "./Login";
import { TeamPage } from "./TeamPage";

const PAGES = ["board", "activity", "team", "account"] as const;
type Page = (typeof PAGES)[number];

const pageFromHash = (): Page => {
  const page = location.hash.slice(1);
  return PAGES.find((p) => p === page) ?? "board";
};

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [team, setTeam] = useState<User[]>([]);
  const [page, setPage] = useState<Page>(pageFromHash);

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

  const tabs: { id: Page; label: string; show: boolean }[] = [
    { id: "board", label: "Board", show: true },
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
      {user.demo && <p className="notice">Demo workspace. Everything resets at midnight UTC.</p>}
      <main>
        {current === "board" && <Board user={user} team={team} />}
        {current === "activity" && <ActivityPage team={team} />}
        {current === "team" && <TeamPage me={user} team={team} setTeam={setTeam} />}
        {current === "account" && <AccountPage me={user} team={team} setTeam={setTeam} onDeleted={clearUser} />}
      </main>
    </div>
  );
}
