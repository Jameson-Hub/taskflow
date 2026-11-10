import type { Dispatch, FormEvent, SetStateAction } from "react";
import { api, ROLE_LABEL, type Role, type User } from "./api";
import { ErrorText, Options, useAction } from "./ui";

interface Props {
  me: User;
  team: User[];
  setTeam: Dispatch<SetStateAction<User[]>>;
}

export function TeamPage({ me, team, setTeam }: Props) {
  const { error, run } = useAction();

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
      <p className="muted">Admins add people and set roles. Demo accounts keep their roles so the demo stays usable.</p>

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
      <p className="muted small">New people can sign in with email on the login page until the nightly reset.</p>
    </section>
  );
}
