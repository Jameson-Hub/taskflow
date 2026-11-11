import { DurableObject } from "cloudflare:workers";
import { createMiddleware } from "hono/factory";
import { Hono } from "hono";
import { LIVE } from "../shared/domain";
import { fail, requireSameOrigin, type AppEnv } from "./http";

/**
 * One per workspace: holds the open boards' WebSockets and tells them when something changes.
 * Uses the hibernation API, so idle connections cost nothing on the free plan.
 */
export class BoardRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVE.ping, LIVE.pong));
  }

  override async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server!);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message: string) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // Already closing; the runtime drops it.
      }
    }
  }

  override webSocketClose(socket: WebSocket, code: number) {
    // Echo the close; 1005/1006 mean "no code" and may not be sent back. Newer runtimes may already have replied.
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, "Closing");
    } catch {
      // Already closed.
    }
  }
}

const roomFor = (env: Env, workspaceId: number) => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(String(workspaceId)));

/** After a successful change, tells the caller's workspace. Runs after the response, so it never slows a request down. */
export const notifyOnChange = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (c.req.method !== "GET" && c.res.ok) {
    c.executionCtx.waitUntil(roomFor(c.env, c.var.user.workspace_id).broadcast(LIVE.changed));
  }
});

/** `GET /api/live`: the board's WebSocket, joined to the caller's workspace room. */
export const live = new Hono<AppEnv>();

live.get("/", (c) => {
  if (c.req.header("Upgrade") !== "websocket") fail(426, "Expected a WebSocket");
  // The global Origin check skips GETs; a WebSocket from another site would carry our cookie, so check here.
  requireSameOrigin(c);
  return roomFor(c.env, c.var.user.workspace_id).fetch(c.req.raw);
});
