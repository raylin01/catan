import {SOUND_CLIPS} from './soundClips.js';

export function createGameAudio(getContext, fetchAudio = (url, options) => fetch(url, options)) {
  let context, master;
  let enabled = false, closed = false, generation = 0;
  const last = new Map(), variants = new Map(), buffers = new Map(), loading = new Map(), sources = new Map(), requests = new Set();
  const stop = source => {
    sources.delete(source);
    try { source.stop(); } catch { /* Already ended. */ }
  };
  const mute = () => {
    enabled = false; generation++;
    for (const source of sources.keys()) stop(source);
    sources.clear();
    context?.suspend?.().catch(() => {});
  };
  const load = url => {
    if (buffers.has(url)) return Promise.resolve(buffers.get(url));
    if (!loading.has(url)) {
      const pending = Promise.resolve().then(async () => {
        if (closed) throw new Error('Audio closed');
        const controller = new AbortController();
        requests.add(controller);
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetchAudio(url, {signal: controller.signal});
          if (!response.ok) throw new Error('Sound sample unavailable');
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (!closed) buffers.set(url, buffer);
          return buffer;
        } finally { clearTimeout(timeout); requests.delete(controller); }
      }).finally(() => loading.delete(url));
      loading.set(url, pending);
    }
    return loading.get(url);
  };
  const enable = async () => {
    if (closed) return false;
    const ticket = ++generation;
    try {
      context ||= getContext();
      if (!master) { master = context.createGain(); master.gain.value = .75; master.connect(context.destination); }
      await context.resume();
      if (ticket !== generation || closed) return false;
      // Load only on opt-in. Playback itself stays synchronous: a delayed
      // download must never make an old action sound after it has passed.
      await Promise.allSettled([...new Set(Object.values(SOUND_CLIPS).flat())].map(load));
      if (ticket !== generation || closed) return false;
      enabled = buffers.size > 0;
      return enabled;
    } catch {
      if (ticket === generation) enabled = false;
      return false;
    }
  };
  const play = (kind, visible = true) => {
    if (!enabled || !visible || !context || context.state !== 'running' || !Object.hasOwn(SOUND_CLIPS, kind)) return;
    const now = context.currentTime;
    if (now - (last.get(kind) ?? -Infinity) < (kind === 'shuffle' ? 3 : .16)) return;
    const available = SOUND_CLIPS[kind].filter(url => buffers.has(url));
    if (!available.length) return;
    last.set(kind, now);
    try {
      // Limit overlap in fast replay and stop a previous sample of this kind.
      for (const [source, previousKind] of sources) {
        if (previousKind === kind || sources.size >= 4) stop(source);
      }
      const variant = variants.get(kind) || 0;
      variants.set(kind, variant + 1);
      const source = context.createBufferSource();
      source.buffer = buffers.get(available[variant % available.length]);
      source.connect(master); sources.set(source, kind);
      source.onended = () => { sources.delete(source); source.disconnect(); };
      source.start(now);
    } catch { /* Optional audio must never interrupt a game action. */ }
  };
  return {enable, mute, play, close: () => { closed = true; mute(); for (const controller of requests) controller.abort(); buffers.clear(); master?.disconnect(); context?.close?.().catch(() => {}); }};
}
