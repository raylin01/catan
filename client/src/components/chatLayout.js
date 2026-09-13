export const CHAT_LAYOUT_KEY = 'catanChatLayout';

// Only window geometry is persisted. Chat content never enters browser storage.
export function fitChatLayout(saved, viewport) {
  const margin = 10;
  const maxWidth = Math.max(1, viewport.width - margin * 2);
  const maxHeight = Math.max(1, viewport.height - margin * 2);
  const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const width = Math.min(maxWidth, Math.max(Math.min(280, maxWidth), number(saved?.width, 350)));
  const height = Math.min(maxHeight, Math.max(Math.min(220, maxHeight), number(saved?.height, 350)));
  const x = Math.min(viewport.width - width - margin, Math.max(margin, number(saved?.x, viewport.width - width - 20)));
  const y = Math.min(viewport.height - height - margin, Math.max(margin, number(saved?.y, viewport.width <= 600 ? 80 : viewport.height - height - 140)));
  return {x, y, width, height};
}

export function resizeChatLayout(layout, width, height, viewport) {
  return fitChatLayout({...layout,
    width: Math.min(width, viewport.width - layout.x - 10),
    height: Math.min(height, viewport.height - layout.y - 10)
  }, viewport);
}
