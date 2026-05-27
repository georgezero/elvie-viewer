function randomId(prefix = 'lvrun') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createLvRunSessionStore() {
  const sessions = new Map();

  function createSession(input = {}) {
    const now = Date.now();
    const session = {
      session_id: input.session_id || randomId('session'),
      client_id: input.client_id || randomId('client'),
      created_at: now,
      updated_at: now,
      command_history: []
    };
    sessions.set(session.session_id, session);
    return session;
  }

  function getSession(sessionId) {
    return sessions.get(sessionId) || null;
  }

  function listSessions() {
    return Array.from(sessions.values());
  }

  function appendCommandHistory(sessionId, entry = {}) {
    const session = sessions.get(sessionId);
    if (!session) return null;
    session.command_history.push({ ...entry, ts: Date.now() });
    session.updated_at = Date.now();
    if (session.command_history.length > 500) {
      session.command_history = session.command_history.slice(-500);
    }
    return session;
  }

  return {
    createSession,
    getSession,
    listSessions,
    appendCommandHistory
  };
}
