import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { api, ROLE_LABEL, type Role, type ShareStatus, type User } from "./api";
import { CopyField, ErrorText, longDate, Options, useAction } from "./ui";

interface Props {
  me: User;
  team: User[];
  setTeam: Dispatch<SetStateAction<User[]>>;
}

export function TeamPage({ me, team, setTeam }: Props) {
  const { error, run } = useAction();
  const [inviteLink, setInviteLink] = useState("");

  function createInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const role = new FormData(e.currentTarget).get("role") as Role;
    run(async () => {
      const { token } = await api.createInvite(role);
      setInviteLink(`${location.origin}/#invite=${token}`);
    });
  }

  const changeRole = (member: User, role: Role) =>
    run(async () => {
      const updated = await api.setRole(member.id, role);
      setTeam((all) => all.map((m) => (m.id === updated.id ? updated : m)));
    });

  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    run(async () => {
      const created = await api.createUser({
        name: String(data.get("name")),
        email: String(data.get("email")),
        role: data.get("role") as Role,
        password: String(data.get("password")),
      });
      setTeam((all) => [...all, created]);
      form.reset();
    });
  }

  return (
    <section className="page">
      <h1>Team</h1>
      <p className="muted">
        Admins add people to <strong>{me.workspace}</strong> and set their roles.
        {me.demo && " Demo accounts keep their roles so the demo stays usable."}
      </p>

      <ErrorText error={error} />

      <table className="team">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {team.map((m) => (
            <tr key={m.id}>
              <td>
                {m.name} {m.id === me.id && <span className="muted small">(you)</span>}
              </td>
              <td className="muted">{m.email}</td>
              <td>
                <select
                  aria-label={`Role for ${m.name}`}
                  value={m.role}
                  disabled={m.demo}
                  title={m.demo ? "Demo accounts keep their roles" : undefined}
                  onChange={(e) => changeRole(m, e.target.value as Role)}
                >
                  <Options labels={ROLE_LABEL} />
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {me.demo_workspace ? (
        <>
          <h2>Add a person</h2>
          <form className="invite" onSubmit={invite}>
            <label>
              Name
              <input name="name" required maxLength={80} />
            </label>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <label>
              Role
              <select name="role" defaultValue="member">
                <Options labels={ROLE_LABEL} />
              </select>
            </label>
            <label>
              Password
              <input name="password" type="password" minLength={12} required autoComplete="new-password" />
            </label>
            <button className="primary">Add</button>
          </form>
          <p className="muted small">In the demo, use an @example.com address. New people can sign in with it until the nightly reset.</p>
        </>
      ) : (
        <>
          <h2>Invite someone</h2>
          <form className="invite" onSubmit={createInvite}>
            <label>
              Role
              <select name="role" defaultValue="member">
                <Options labels={ROLE_LABEL} />
              </select>
            </label>
            <button className="primary">Create invite link</button>
          </form>
          {inviteLink && <CopyField key={inviteLink} label="Invite link" value={inviteLink} />}
          <p className="muted small">Send the link to one person. It works once, for 7 days, and they choose their own password.</p>
        </>
      )}
      <ShareSettings demo={me.demo_workspace} />
    </section>
  );
}

/** The Team page's controls for the workspace's share link (admins only). */
function ShareSettings({ demo }: { demo: boolean }) {
  const { error, setError, run } = useAction();
  const [status, setStatus] = useState<ShareStatus | null>(null);
  // Only known right after it's made: the server keeps a hash, not the link.
  const [link, setLink] = useState("");

  useEffect(() => {
    api.shareStatus().then(setStatus, (err: Error) => setError(err.message));
  }, [setError]);

  const create = () =>
    run(async () => {
      const { token } = await api.createShare();
      setLink(`${location.origin}/#share=${token}`);
      setStatus({ enabled: true, created_at: new Date().toISOString() });
    });

  const stop = () =>
    run(async () => {
      await api.stopShare();
      setLink("");
      setStatus({ enabled: false });
    });

  if (!status) return <ErrorText error={error} />;
  return (
    <>
      <h2>Share the board</h2>
      <p className="muted small">
        A read-only link anyone can open without signing in. It shows titles, status, priority, assignees, due dates, labels and checklist
        progress; never descriptions, comments or emails.{demo && " In the demo, any visitor can replace or turn off this link, and the nightly reset clears it."}
      </p>
      <div className="row">
        <button className="primary" onClick={create}>
          {status.enabled ? "Replace link" : "Create share link"}
        </button>
        {status.enabled && <button onClick={stop}>Turn off</button>}
      </div>
      {link ? (
        <CopyField key={link} label="Share link" value={link} />
      ) : (
        status.enabled && (
          <p className="muted small">
            A link is on (made {longDate(status.created_at.slice(0, 10))}). Replace it to get a copy; the
            old one stops working.
          </p>
        )
      )}
      <ErrorText error={error} />
    </>
  );
}
