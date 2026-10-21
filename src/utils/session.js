/**
 * In-memory wizard session store for multi-step bot interactions
 * Automatically cleans up abandoned sessions after a timeout
 */

const userSessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes timeout

function setSession(userId, sessionData) {
  const existing = userSessions.get(String(userId));
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }

  const timer = setTimeout(() => {
    userSessions.delete(String(userId));
  }, SESSION_TTL_MS);

  userSessions.set(String(userId), {
    ...sessionData,
    timer,
    updatedAt: Date.now(),
  });
}

function getSession(userId) {
  const session = userSessions.get(String(userId));
  if (!session) return null;
  return session;
}

function clearSession(userId) {
  const session = userSessions.get(String(userId));
  if (session?.timer) {
    clearTimeout(session.timer);
  }
  userSessions.delete(String(userId));
}

module.exports = {
  setSession,
  getSession,
  clearSession,
};

