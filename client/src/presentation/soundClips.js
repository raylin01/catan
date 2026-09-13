// Kenney Casino Audio (CC0). Softened local recordings; see assets/audio/provenance.json.
const piece = [
  new URL('../assets/audio/piece-1.mp3', import.meta.url).href,
  new URL('../assets/audio/piece-2.mp3', import.meta.url).href,
];
export const SOUND_CLIPS = {
  dice: [
    new URL('../assets/audio/dice-1.mp3', import.meta.url).href,
    new URL('../assets/audio/dice-2.mp3', import.meta.url).href,
    new URL('../assets/audio/dice-3.mp3', import.meta.url).href,
  ],
  card: [
    new URL('../assets/audio/card-1.mp3', import.meta.url).href,
    new URL('../assets/audio/card-2.mp3', import.meta.url).href,
    new URL('../assets/audio/card-3.mp3', import.meta.url).href,
  ],
  cardGroup: [
    new URL('../assets/audio/card-group-1.mp3', import.meta.url).href,
    new URL('../assets/audio/card-group-2.mp3', import.meta.url).href,
  ],
  piece,
  robber: piece,
  shuffle: [new URL('../assets/audio/shuffle.mp3', import.meta.url).href],
};
