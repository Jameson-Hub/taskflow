import { useEffect, useRef, useState } from "react";
import { AccountPage } from "./AccountPage";
import { ActivityPage } from "./ActivityPage";
import { api, can, ROLE_LABEL, whenSessionExpires, type User } from "./api";
import { Board } from "./Board";
import { DashboardPage } from "./DashboardPage";
import { Login } from "./Login";
import { TeamPage } from "./TeamPage";
import { readShareToken, SharedBoard } from "./SharedBoard";
import { settleBeforeSignOut } from "./signOut";
import { ThemeToggle } from "./theme";
import { initials, parseHash } from "./ui";

const PAGES = ["board", "dashboard", "activity", "team", "account"] as const;
type Page = (typeof PAGES)[number];

const pageFromHash = (): Page => {
  const { page } = parseHash();
  return PAGES.find((p) => p === page) ?? "board";
};

/** Invite links look like `/#invite=<token>`; a fragment is never sent to the server. */
const readInviteToken = () => new URLSearchParams(location.hash.slice(1)).get("invite");

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [team, setTeam] = useState<User[]>([]);
  const [page, setPage] = useState<Page>(pageFromHash);
  // The one owner of an opened invite link: Login uses it to join, and it's dropped once someone signs in.
  const [inviteToken, setInviteToken] = useState(readInviteToken);
  const [shareToken, setShareToken] = useState(readShareToken);
  // Why the sign-in screen is showing when nobody signed out, e.g. the nightly demo reset ended the session.
  const [endedNotice, setEndedNotice] = useState("");
  // What kind of session was last open; none for a visitor who never signed in (their first check also gets a 401).
  const session = useRef<"demo" | "own" | null>(null);
  useEffect(() => {
    if (user !== undefined) session.current = user ? (user.demo_workspace ? "demo" : "own") : null;
  }, [user]);

  // Out of the address bar and history straight away, whether or not they join.
  useEffect(() => {
    if (inviteToken) history.replaceState(null, "", location.pathname);
  }, [inviteToken]);

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
    whenSessionExpires(() => {
      if (session.current === "demo") {
        setEndedNotice("The demo was reset (it does that every night at midnight UTC), so you were signed out. Pick a role to carry on.");
      } else if (session.current === "own") {
        setEndedNotice("Your session ended. Sign in again to carry on.");
      }
      setUser(null);
    });
    const onHash = () => {
      // Also catches an invite link pasted into a tab that's already open.
      const pasted = readInviteToken();
      if (pasted) setInviteToken(pasted);
      setShareToken(readShareToken());
      setPage(pageFromHash());
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // Loaded once per sign-in and shared by every page.
  const userId = user?.id;
  useEffect(() => {
    if (userId) api.users().then(setTeam);
  }, [userId]);

  // A share link shows the read-only board whoever is (or isn't) signed in.
  if (shareToken) return <SharedBoard key={shareToken} token={shareToken} />;
  if (user === undefined) return <div className="splash" aria-busy="true" />;
  if (user === null) {
    const signedIn = (u: User) => {
      setInviteToken(null);
      setEndedNotice("");
      setUser(u);
    };
    // Keyed by the invite, so a link pasted while on this screen opens the join form.
    return <Login key={inviteToken ?? "none"} inviteToken={inviteToken} notice={endedNotice} onSignedIn={signedIn} />;
  }
  if (inviteToken) {
    const signOutAndJoin = async () => {
      await api.logout();
      setUser(null); // Login then shows the join form for the same invite.
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
          <button className="ghost" onClick={() => setInviteToken(null)}>
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
    await settleBeforeSignOut();
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
        <div className="whoami">
          <span className="who">
            {user.name} <span className={`role role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
          </span>
          <ThemeToggle />
          <button className="ghost" onClick={signOut}>
            Sign out
          </button>
          <span className="avatar avatar-me" title={user.name} aria-hidden="true">
            {initials(user.name)}
          </span>
        </div>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <div className="project">
            <span className="project-avatar" aria-hidden="true">
              {initials(user.workspace)}
            </span>
            <div className="project-text">
              <span className="project-name" title="Workspace">
                {user.workspace}
              </span>
              <span className="project-kind">Team workspace</span>
            </div>
          </div>
          <p className="sidebar-heading">Planning</p>
          <nav className="tabs" aria-label="Sections">
            {tabs
              .filter((t) => t.show)
              .map((t) => (
                <a key={t.id} href={`#${t.id}`} aria-current={current === t.id ? "page" : undefined}>
                  <NavIcon page={t.id} />
                  {t.label}
                </a>
              ))}
          </nav>
        </aside>
        <div className="content">
          {user.demo_workspace && <p className="notice">Demo workspace. Everything resets at midnight UTC.</p>}
          <main>
            {current === "board" && <Board user={user} team={team} />}
            {current === "dashboard" && <DashboardPage me={user} />}
            {current === "activity" && <ActivityPage team={team} />}
            {current === "team" && <TeamPage me={user} team={team} setTeam={setTeam} />}
            {current === "account" && <AccountPage me={user} team={team} setTeam={setTeam} onDeleted={clearUser} />}
          </main>
        </div>
      </div>
    </div>
  );
}

/** Sidebar icons, drawn in the text colour so they follow the theme and the active state. */
const ICON_PATHS: Record<Page, string> = {
  board: "M3 4h5v16H3zM10 4h5v10h-5zM17 4h4v7h-4z",
  dashboard: "M4 13h6V4H4zm0 7h6v-5H4zm10 0h6v-9h-6zm0-16v5h6V4z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  team: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-7 9c0-3.3 3.1-6 7-6s7 2.7 7 6M17 11a3 3 0 1 0 0-6M22 20c0-2.6-1.8-4.8-4.5-5.6",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 8c0-3.9 3.6-6 8-6s8 2.1 8 6",
};

function NavIcon({ page }: { page: Page }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
      <path d={ICON_PATHS[page]} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
