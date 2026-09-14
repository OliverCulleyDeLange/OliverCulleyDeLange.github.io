/* Project id → MacIcon glyph. Shared by the home page and the desktop so the
   two can't drift apart. Anything unmapped falls back to the 'app' diamond. */
export const projectIcons: Record<string, string> = {
  'grvmkr': 'grvmkr',
  'schengen-calculator': 'schengen',
  'mortgage-calculator': 'mortgage',
  'memory': 'memory',
  'six-second-scribbles': 'scribbles',
  'location-alarm': 'location-alarm',
  'we-climb-rocks': 'climb',
  'map-playground': 'map',
  'pinball': 'pinball',
  'dolphin-olympics': 'dolphin-olympics',
};

export const iconFor = (id: string): string => projectIcons[id] ?? 'app';
