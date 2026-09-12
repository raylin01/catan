export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8];

export function replayHeaders(token, extra = {}) {
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

export async function requestReplayJson(path, { token, signal, headers, method = 'GET' } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: replayHeaders(token, headers)
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    const connectionError = new Error('The replay service could not be reached.');
    connectionError.status = 0;
    throw connectionError;
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data?.success === false) {
    const error = new Error(data?.error || (response.status === 404 ? 'Replay not found.' : `Request failed (${response.status}).`));
    error.status = response.status;
    throw error;
  }
  return data;
}

export function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatReplayDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function statusLabel(recording) {
  if ((recording?.status === 'finished' || recording?.status === 'won') && recording?.winnerId) return 'Finished';
  if (recording?.status === 'finished' || recording?.status === 'ended') return 'Ended by host';
  if (recording?.status === 'paused') return 'Paused, can resume';
  if (recording?.status === 'playing' || recording?.status === 'ongoing') return 'In progress';
  if (recording?.status === 'interrupted') return 'Interrupted, can resume';
  if (recording?.status === 'setup') return 'Setup in progress';
  if (recording?.status === 'waiting' || recording?.status === 'lobby') return 'Waiting to start';
  return recording?.status ? String(recording.status).replaceAll('-', ' ') : 'Incomplete';
}

export function isTerminalRecording(recording) {
  return ['finished', 'won', 'ended'].includes(recording?.status);
}

export function resourceTotal(resources) {
  if (typeof resources === 'number') return resources;
  if (!resources || typeof resources !== 'object') return 0;
  return Object.values(resources).reduce((sum, count) => sum + (Number(count) || 0), 0);
}

export function devCardCount(cards, newCards) {
  const count = value => typeof value === 'number' ? value : Array.isArray(value) ? value.length : 0;
  return count(cards) + count(newCards);
}

export function clampSeq(value, lastSeq) {
  return Math.max(0, Math.min(Math.max(0, Number(lastSeq) || 0), Math.round(Number(value) || 0)));
}

export function playerColor(player, index = 0) {
  return player?.color || ['#d96855', '#4f94b5', '#dc9b51', '#63a892'][index % 4];
}

export function safeFilename(value) {
  return String(value || 'catan-replay')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'catan-replay';
}
