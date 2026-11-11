import { beforeEach, describe, expect, it } from "vitest";
import { LIVE } from "../src/shared/domain";
import { addTeammate, api, freshDatabase, loginAs, riley, sessionCookie, signUp } from "./helpers";

beforeEach(freshDatabase);

/** Opens the board's live connection the way the browser does, and collects what it's sent. */
async function connect(cookie: string) {
  const res = await api("/api/live", { cookie, headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const socket = res.webSocket!;
  const messages: string[] = [];
  socket.addEventListener("message", (e) => messages.push(String(e.data)));
  socket.accept();
  return { messages, close: () => socket.close() };
}

/** Lets messages already in flight arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

describe("live board updates", () => {
  it("tell everyone with the board open when a task changes", async () => {
    const member = await connect(await loginAs("member"));
    const manager = await loginAs("manager");

    await api("/api/tasks", { method: "POST", cookie: manager, body: { title: "Ship real-time" } });
    await settle();

    expect(member.messages).toEqual([LIVE.changed]);
    member.close();
  });

  it("stay inside the workspace", async () => {
    const outsider = await connect(sessionCookie(await signUp()));
    await api("/api/tasks", { method: "POST", cookie: await loginAs("manager"), body: { title: "Demo only" } });
    await settle();

    expect(outsider.messages).toEqual([]);
    outsider.close();
  });

  it("cover comments too", async () => {
    const manager = await loginAs("manager");
    const watcher = await connect(manager);
    const [task] = (await (await api("/api/tasks", { cookie: manager })).json()) as { id: number }[];
    await api(`/api/tasks/${task!.id}/comments`, { method: "POST", cookie: await loginAs("member"), body: { body: "Hi" } });
    await settle();

    expect(watcher.messages).toEqual([LIVE.changed]);
    watcher.close();
  });

  it("cover someone leaving, since their name and assignments change on the board", async () => {
    const admin = sessionCookie(await signUp());
    const { cookie: teammate } = await addTeammate(admin);
    const watcher = await connect(admin);

    await api("/api/me", { method: "DELETE", cookie: teammate, body: { password: riley.password } });
    await settle();

    expect(watcher.messages).toEqual([LIVE.changed]);
    watcher.close();
  });

  it("need a signed-in user and a WebSocket from this site", async () => {
    expect((await api("/api/live", { headers: { Upgrade: "websocket" } })).status).toBe(401);
    const cookie = await loginAs("member");
    expect((await api("/api/live", { cookie })).status).toBe(426);
    expect((await api("/api/live", { cookie, origin: "https://evil.example", headers: { Upgrade: "websocket" } })).status).toBe(403);
  });
});
