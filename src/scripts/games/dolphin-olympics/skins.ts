import type { SkinId } from '../../../../workers/dolphin-multiplayer/src/protocol';

/* Dolphin colourways. The first is the original's blue-grey; the rest are
   what other players can pick so you can tell each other apart. */

export interface DolphinSkin {
  id: SkinId;
  name: string;
  body: string;
  back: string;
  belly: string;
  fin: string;
  line: string;
}

export const SKINS: readonly DolphinSkin[] = [
  { id: 'classic', name: 'Classic', body: '#8fa3c2', back: '#6f86a8', belly: '#e9f1f8', fin: '#7c93b3', line: '#2f3e55' },
  { id: 'pink', name: 'River pink', body: '#f0a3b8', back: '#d97f9a', belly: '#fde7ee', fin: '#e08fa8', line: '#7a2e48' },
  { id: 'orca', name: 'Orca', body: '#242833', back: '#12151c', belly: '#f4f6f8', fin: '#2f3441', line: '#05070a' },
  { id: 'gold', name: 'Gold', body: '#e6b544', back: '#c2902a', belly: '#fff2c4', fin: '#d3a338', line: '#6b4d0f' },
  { id: 'mint', name: 'Mint', body: '#7fd8c2', back: '#55b89f', belly: '#e6fbf5', fin: '#68c9b0', line: '#1f5c4c' },
  { id: 'lava', name: 'Lava', body: '#e0573a', back: '#b23a22', belly: '#ffd9c2', fin: '#cf4a30', line: '#5a1a0c' },
  { id: 'midnight', name: 'Midnight', body: '#3b4a8f', back: '#26306b', belly: '#c9d2ff', fin: '#334084', line: '#131a3f' },
  { id: 'lilac', name: 'Lilac', body: '#b79be0', back: '#9377c4', belly: '#f1e9ff', fin: '#a68bd3', line: '#4b3475' },
];

export const CLASSIC_SKIN = SKINS[0];

export function skinById(id: string): DolphinSkin {
  return SKINS.find((skin) => skin.id === id) ?? CLASSIC_SKIN;
}
