/* Folders that ship with the desktop. Visitors can rename them, drag icons
   in and out, and add their own from the desktop's right-click menu; every
   change is kept in localStorage by desktop.ts, so this is only the
   starting state a first-time visitor sees. */
export interface DesktopFolder {
  id: string;
  name: string;
  /** MacIcon glyph worn on the folder's face. Omit for a plain folder. */
  icon?: string;
  /** Desktop icon ids (project ids, or shortcuts such as 'cv') that start inside. */
  items: string[];
  /** Slot among the folders, which lead the top-left icon flow ahead of
      the apps. Blog is rendered first and takes no slot. */
  order: number;
}

export const desktopFolders: DesktopFolder[] = [
  {
    id: 'games',
    name: 'Games',
    icon: 'games',
    items: [
      'pinball', 'dolphin-olympics', 'six-second-scribbles',
      'language-guesser', 'memory',
    ],
    order: 1,
  },
  {
    id: 'house-stuff',
    name: 'House Stuff',
    icon: 'home',
    items: ['mortgage-calculator', 'home-survey-levels'],
    order: 2,
  },
];

/* What MacIcon should draw for a folder: the plain folder glyph, or that
   glyph with the folder's own icon riding on its face. */
export const folderIcon = (folder: DesktopFolder): string =>
  folder.icon ? `folder:${folder.icon}` : 'folder';
