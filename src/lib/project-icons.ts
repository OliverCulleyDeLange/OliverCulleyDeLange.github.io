/* Project id → MacIcon glyph. Shared by the home page and the desktop so the
   two can't drift apart. Anything unmapped falls back to the 'app' diamond. */
export const projectIcons: Record<string, string> = {
  'free-custom-ecards': 'ecards',
  'grvmkr': 'grvmkr',
  'trip-scheduler': 'trip-scheduler',
  'schengen-calculator': 'schengen',
  'mortgage-calculator': 'mortgage',
  'home-survey-levels': 'survey',
  'memory': 'memory',
  'six-second-scribbles': 'scribbles',
  'location-alarm': 'location-alarm',
  'we-climb-rocks': 'climb',
  'map-playground': 'map',
  'pinball': 'pinball',
  'dolphin-olympics': 'dolphin-olympics',
  'tiles': 'tiles',
};

export const iconFor = (id: string): string => projectIcons[id] ?? 'app';
