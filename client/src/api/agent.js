import { request } from './http.js';

// The voice agent's server-side footprint: Kiosk-role facts and dialogue-log
// stats (agent.view-gated on the server, like every other read here).
export function fetchAgentStatus() {
  return request('/api/agent/status');
}

// The retained dialogue log. All filters optional; the server caps the answer
// at 100 turns (newest first) and says so via `truncated`.
export function listTranscripts({ sessionId = '', role = '', from = '', to = '' } = {}) {
  const params = new URLSearchParams();
  if (sessionId) params.set('sessionId', sessionId);
  if (role) params.set('role', role);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return request(`/api/agent/transcripts${qs ? `?${qs}` : ''}`);
}
