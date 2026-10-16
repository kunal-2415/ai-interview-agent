export const STRIKE_TYPES = new Set([
  "tab_hidden",
  "window_blur",
  "fullscreen_exit",
  "paste_attempt",
  "copy_attempt",
  "multi_face",
  "no_face",
  "multi_monitor",
  "silent_answer",
  "screen_not_monitor",
  "shortcut_blocked",
]);

const ONCE_TYPES = new Set(["multi_monitor", "screen_not_monitor"]);
const COOLDOWN_MS = 20_000;

export function applyIntegrity(session, event, { now = Date.now(), maxStrikes = 3 } = {}) {
  const type = String(event?.type || "");
  const detail = String(event?.detail || "").slice(0, 300);
  if (!session.lastStrikeAt) session.lastStrikeAt = {};
  if (!session.integrity) session.integrity = [];
  if (!session.strikes) session.strikes = 0;

  let strike = false;
  let locked = session.status === "locked";

  if (type === "screen_share_ended") {
    strike = true;
    locked = true;
  } else if (STRIKE_TYPES.has(type) && !locked) {
    if (ONCE_TYPES.has(type)) {
      strike = !session.integrity.some((item) => item.type === type && item.strike);
    } else if (now - (session.lastStrikeAt[type] || 0) >= COOLDOWN_MS) {
      strike = true;
    }
  }

  if (strike) {
    session.strikes += 1;
    session.lastStrikeAt[type] = now;
    if (session.strikes >= maxStrikes) locked = true;
  }

  session.integrity.push({ at: new Date(now).toISOString(), type, detail, strike });
  if (session.integrity.length > 400) session.integrity.splice(0, session.integrity.length - 400);

  if (locked) session.status = "locked";
  return {
    strike,
    strikes: session.strikes,
    maxStrikes,
    locked: session.status === "locked",
  };
}
