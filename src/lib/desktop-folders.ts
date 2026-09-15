/* Folders that ship with the desktop. Visitors can rename them, drag icons
   in and out, and add their own from the desktop's right-click menu; every
   change is kept in localStorage by desktop.ts, so this is only the
   starting state a first-time visitor sees. */
export interface DesktopFolder {
  id: string;
  name: string;
  /** MacIcon glyph shown on the desktop and in the dock. */
  icon: string;
  /** Desktop icon ids (project ids, or shortcuts such as 'cv') that start inside. */
  items: string[];
  /** Slot in the top-left icon flow, on the same scale as a project's `order`. */
  order: number;
}

export const desktopFolders: DesktopFolder[] = [
  {
    id: 'house-stuff',
    name: 'House Stuff',
    icon: 'home',
    items: ['mortgage-calculator', 'home-survey-levels'],
    order: 3,
  },
];
