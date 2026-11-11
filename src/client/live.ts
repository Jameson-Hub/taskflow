import { LIVE } from "../shared/domain";

const PING_MS = 50_000; // under the ~100s idle timeout for WebSockets at Cloudflare's edge
const MAX_RETRY_MS = 30_000;
const BURST_MS = 200; // several changes in a row cause one reload

/**
 * Calls `onChange` whenever someone in the workspace changes the board, reconnecting with backoff
 * if the connection drops. Returns a function that closes it.
 */
export function onBoardChange(onChange: () => void) {
  let socket: WebSocket | null = null;
  let retries = 0;
  let stopped = false;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let burst: ReturnType<typeof setTimeout> | undefined;
  // A hidden tab doesn't reload until it's looked at again.
  let missed = false;
  const deliver = () => {
    if (document.hidden) missed = true;
    else onChange();
  };
  const onVisible = () => {
    if (!document.hidden && missed) {
      missed = false;
      onChange();
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  const connect = () => {
    socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`);
    socket.onopen = () => (retries = 0);
    socket.onmessage = (e) => {
      if (e.data !== LIVE.changed) return;
      clearTimeout(burst);
      burst = setTimeout(deliver, BURST_MS);
    };
    socket.onclose = () => {
      if (!stopped) reconnect = setTimeout(connect, Math.min(MAX_RETRY_MS, 1000 * 2 ** retries++));
    };
  };

  connect();
  const ping = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send(LIVE.ping), PING_MS);
  return () => {
    stopped = true;
    clearTimeout(reconnect);
    clearTimeout(burst);
    clearInterval(ping);
    document.removeEventListener("visibilitychange", onVisible);
    socket?.close();
  };
}
