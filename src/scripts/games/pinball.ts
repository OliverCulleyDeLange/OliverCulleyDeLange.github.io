/* Pinball — a small single-table machine on a canvas. Like the other game
   modules, this file owns all of its state, physics, rendering, and input;
   the page around it just supplies a canvas and a few HUD callbacks, and a
   high score is persisted under its own storage key.

   The table's obstructions ("bumpers") and holes are the player's to
   arrange: there is at most one bumper of each colour, placed by picking a
   colour in the page's palette and clicking the table, moved by dragging
   its middle, resized by dragging its rim, removed with a double-click.
   Holes are placed the same way (as many as you like) and are where a ball
   swallowed by the red bumper comes back out. The layout is remembered
   between visits. What each colour does is described in BUMPER_KINDS. */

const LOGICAL_W = 360;
const LOGICAL_H = 620;

const GRAVITY = 780; // px/s^2
const BALL_RADIUS = 7;
const WALL_THICKNESS = 3;
const MAX_SPEED = 1050;
const LIVES_START = 3;
const LAUNCH_VELOCITY = 940;
const MAX_BALLS = 4;
const HIGH_SCORE_KEY = 'odl-pinball-highscore';
const LAYOUT_KEY = 'odl-pinball-layout';

const MIN_BUMPER_RADIUS = 10;
const MAX_BUMPER_RADIUS = 38;
const DEFAULT_BUMPER_RADIUS = 18;
const HOLE_RADIUS = 11;
const MAX_HOLES = 6;
const RESPAWN_DELAY = 420; // ms between being swallowed and popping out of a hole
const EMERGE_SPEED = 330;
// Pressing within this fraction of a bumper's radius drags it; further out
// (on the rim) drags its size instead.
const MOVE_ZONE = 0.6;

type Point = { x: number; y: number };
type Segment = { a: Point; b: Point };

const FLIPPER_LENGTH = 62;
const FLIPPER_RADIUS = 6;
const FLIPPER_ANGULAR_SPEED = 15; // rad/s, snapping toward centre
const FLIPPER_RETURN_SPEED = 9; // rad/s, falling back to rest
const TIP_IMPULSE = 0.55; // fraction of tip velocity imparted to the ball
const deg = (n: number) => (n * Math.PI) / 180;

interface Flipper {
  pivot: Point;
  restAngle: number;
  activeAngle: number;
  angle: number;
  active: boolean;
  side: 'left' | 'right';
}

export type BumperType = 'grey' | 'green' | 'red' | 'yellow' | 'purple' | 'pink';
/* Anything the palette can put on the table. */
export type PlaceableKind = BumperType | 'hole';

interface Bumper {
  x: number;
  y: number;
  radius: number;
  type: BumperType;
  flashUntil: number;
  cooldownUntil: number;
}

// While a ball is still overlapping a bumper it would otherwise re-trigger
// every single frame — dozens of points and splits in an instant. Each
// bumper only fires once per this window, however many balls are touching it.
const BUMPER_COOLDOWN = 300; // ms

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/* Short-lived visual flourishes: expanding rings on hits, a shrinking ring
   where a ball was swallowed, a burst where one pops out of a hole. */
interface Effect {
  x: number;
  y: number;
  colour: string;
  start: number;
  duration: number;
  kind: 'ring' | 'swallow' | 'emerge';
  size: number;
}

export interface PinballHud {
  setScore(score: number): void;
  setLives(lives: number): void;
  setMessage(text: string | null): void;
  setHighScore(score: number): void;
  /* Which palette item is armed for placing, if any. */
  setSelectedKind(kind: PlaceableKind | null): void;
  /* Which colours currently have a bumper on the table ('hole' if any holes). */
  setPlacedKinds(kinds: PlaceableKind[]): void;
}

/* What each obstruction colour does, and how many points it's worth. Hinge
   effects (swallowing, splitting, spawning) are applied by the caller since
   they need access to the ball list; this only describes the bounce. */
export const BUMPER_KINDS: Record<BumperType, { score: number; colour: string; label: string }> = {
  grey: { score: 50, colour: '#b0b8c4', label: 'Slows' },
  green: { score: 100, colour: '#34d399', label: 'Speeds up' },
  red: { score: 200, colour: '#f87171', label: 'Swallows, respawns from a hole' },
  yellow: { score: 75, colour: '#facc15', label: 'Zaps random' },
  purple: { score: 150, colour: '#c084fc', label: 'Splits ball' },
  pink: { score: 125, colour: '#f472b6', label: 'Spawns a hole' },
};
export const BUMPER_TYPES = Object.keys(BUMPER_KINDS) as BumperType[];

interface Layout {
  bumpers: { type: BumperType; x: number; y: number; radius: number }[];
  holes: Point[];
}

const DEFAULT_LAYOUT: Layout = {
  bumpers: [
    { type: 'grey', x: 120, y: 190, radius: 20 },
    { type: 'green', x: 235, y: 165, radius: 18 },
    { type: 'red', x: 175, y: 275, radius: 16 },
    { type: 'yellow', x: 95, y: 340, radius: 17 },
    { type: 'purple', x: 250, y: 345, radius: 18 },
  ],
  holes: [
    { x: 72, y: 140 },
    { x: 262, y: 112 },
  ],
};

function readHighScore(): number {
  try {
    return Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
  } catch (error) {
    return 0;
  }
}

function writeHighScore(value: number): void {
  try { localStorage.setItem(HIGH_SCORE_KEY, String(value)); } catch (error) {}
}

function isBumperType(value: unknown): value is BumperType {
  return typeof value === 'string' && (BUMPER_TYPES as string[]).includes(value);
}

/* A curved wall is just a polyline of short segments — cheap to collide
   against with the same circle-vs-segment code as every other wall, and
   smooth enough to read as an actual curve at this table's scale. */
function arcSegments(center: Point, radius: number, startDeg: number, endDeg: number, steps = 6): Segment[] {
  const segments: Segment[] = [];
  let prev: Point = {
    x: center.x + radius * Math.cos((startDeg * Math.PI) / 180),
    y: center.y + radius * Math.sin((startDeg * Math.PI) / 180),
  };
  for (let i = 1; i <= steps; i++) {
    const angle = startDeg + ((endDeg - startDeg) * i) / steps;
    const point: Point = {
      x: center.x + radius * Math.cos((angle * Math.PI) / 180),
      y: center.y + radius * Math.sin((angle * Math.PI) / 180),
    };
    segments.push({ a: prev, b: point });
    prev = point;
  }
  return segments;
}

/* Closest point on a segment to `p`, as a fraction `t` along a→b plus the
   point itself — shared by wall and flipper collision (a flipper is just a
   segment that moves). */
function closestOnSegment(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.min(Math.max(t, 0), 1);
  return { point: { x: a.x + dx * t, y: a.y + dy * t }, t };
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function createPinball(canvas: HTMLCanvasElement, hud: PinballHud) {
  const context = canvas.getContext('2d');
  if (!context) return { destroy() {}, selectKind(_kind: PlaceableKind | null) {} };
  const ctx: CanvasRenderingContext2D = context;

  const walls: Segment[] = [
    { a: { x: 14, y: 600 }, b: { x: 14, y: 60 } },
    ...arcSegments({ x: 60, y: 60 }, 46, 180, 270),
    { a: { x: 60, y: 14 }, b: { x: 300, y: 14 } },
    ...arcSegments({ x: 300, y: 60 }, 46, 270, 360),
    { a: { x: 346, y: 60 }, b: { x: 346, y: 600 } },
    // Guide funnelling the main field down toward the left flipper's hinge.
    { a: { x: 14, y: 480 }, b: { x: 92, y: 558 } },
    // The right-side launch lane: walls the plunger channel off from the
    // main field, so a freshly launched ball can only travel up and over
    // the curved top rather than straight into the bumpers.
    { a: { x: 312, y: 560 }, b: { x: 312, y: 72 } },
    // Mirror of the left guide: slopes from the lane wall down to the right
    // flipper's hinge so nothing can settle in the pocket beside it.
    { a: { x: 312, y: 480 }, b: { x: 268, y: 558 } },
  ];

  // Flippers hinge on the OUTER side and point in toward the centre gap at
  // rest, snapping up (still centre-ward) when fired — mirror images of
  // each other around the table's centreline (x = 180).
  const flippers: Flipper[] = [
    { pivot: { x: 92, y: 555 }, restAngle: deg(20), activeAngle: deg(-75), angle: 0, active: false, side: 'left' },
    { pivot: { x: 268, y: 555 }, restAngle: deg(160), activeAngle: deg(255), angle: 0, active: false, side: 'right' },
  ];
  flippers.forEach(flipper => { flipper.angle = flipper.restAngle; });

  // Where the ball drains if it slips between the resting flipper tips.
  const drain = { left: 148, right: 212, y: 600 };
  // Holes the player has placed. A red bumper swallows the ball, and if it
  // was the last one in play it pops back out of one of these at random.
  let holes: Point[] = [];
  // The ball waits in the right-hand lane and launches straight up it.
  const launchPad: Point = { x: 329, y: 545 };

  // Bumpers may sit anywhere in the open field, clear of the walls, the
  // launch lane and the flipper area.
  const field = { left: 14 + WALL_THICKNESS, right: 312 - WALL_THICKNESS, top: 14 + WALL_THICKNESS, bottom: 468 };

  let bumpers: Bumper[] = [];
  let balls: Ball[] = [];
  let effects: Effect[] = [];
  let launchReady = false;
  let pendingRespawn = 0;

  let score = 0;
  let lives = LIVES_START;
  let highScore = readHighScore();
  let gameOver = true;
  let lastTime = 0;
  let animationFrame: number | null = null;

  let selectedKind: PlaceableKind | null = null;
  type Drag =
    | { kind: 'resize'; bumper: Bumper }
    | { kind: 'move'; bumper: Bumper; dx: number; dy: number }
    | { kind: 'hole'; hole: Point; dx: number; dy: number };
  let dragging: Drag | null = null;
  let hovered: { bumper: Bumper; rim: boolean } | { hole: Point } | null = null;

  hud.setHighScore(highScore);

  function resize() {
    // The canvas can be displayed at any size the window allows (see
    // pinball.astro) — size the backing bitmap to match how big it's
    // actually rendered, not a fixed constant, or it gets blurry once
    // stretched past its old fixed max-width.
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const scale = (rect.width > 0 ? rect.width / LOGICAL_W : 1) * ratio;
    canvas.width = Math.max(1, Math.round(LOGICAL_W * scale));
    canvas.height = Math.max(1, Math.round(LOGICAL_H * scale));
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  /* --- layout: one bumper per colour ------------------------------ */

  function notifyPlaced() {
    const kinds: PlaceableKind[] = bumpers.map(b => b.type);
    if (holes.length) kinds.push('hole');
    hud.setPlacedKinds(kinds);
  }

  function saveLayout() {
    try {
      const layout: Layout = {
        bumpers: bumpers.map(({ type, x, y, radius }) => ({ type, x, y, radius })),
        holes: holes.map(({ x, y }) => ({ x, y })),
      };
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch (error) {}
    notifyPlaced();
  }

  function loadLayout() {
    let saved: unknown = null;
    try {
      saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    } catch (error) {
      saved = null;
    }
    // An older save was a bare array of bumpers.
    const source: Layout = Array.isArray(saved)
      ? { bumpers: saved, holes: DEFAULT_LAYOUT.holes }
      : saved && typeof saved === 'object' && Array.isArray((saved as Layout).bumpers)
        ? { bumpers: (saved as Layout).bumpers, holes: Array.isArray((saved as Layout).holes) ? (saved as Layout).holes : [] }
        : DEFAULT_LAYOUT;
    holes = [];
    for (const item of source.holes as { x?: unknown; y?: unknown }[]) {
      if (typeof item.x !== 'number' || typeof item.y !== 'number' || holes.length >= MAX_HOLES) continue;
      holes.push(constrainHole({ x: item.x, y: item.y }));
    }
    bumpers = [];
    for (const item of source.bumpers as { type?: unknown; x?: unknown; y?: unknown; radius?: unknown }[]) {
      if (!isBumperType(item.type) || typeof item.x !== 'number' || typeof item.y !== 'number') continue;
      if (bumpers.some(b => b.type === item.type)) continue;
      const bumper: Bumper = {
        type: item.type,
        x: item.x,
        y: item.y,
        radius: typeof item.radius === 'number' ? item.radius : DEFAULT_BUMPER_RADIUS,
        flashUntil: 0,
        cooldownUntil: 0,
      };
      constrainBumper(bumper);
      bumpers.push(bumper);
    }
    notifyPlaced();
  }

  function constrainBumper(bumper: Bumper) {
    bumper.radius = Math.min(Math.max(bumper.radius, MIN_BUMPER_RADIUS), MAX_BUMPER_RADIUS);
    bumper.x = Math.min(Math.max(bumper.x, field.left + bumper.radius + 2), field.right - bumper.radius - 2);
    bumper.y = Math.min(Math.max(bumper.y, field.top + bumper.radius + 2), field.bottom - bumper.radius);
  }

  function constrainHole(hole: Point): Point {
    hole.x = Math.min(Math.max(hole.x, field.left + HOLE_RADIUS + 4), field.right - HOLE_RADIUS - 4);
    hole.y = Math.min(Math.max(hole.y, field.top + HOLE_RADIUS + 4), field.bottom - HOLE_RADIUS);
    return hole;
  }

  /* What is under a point: a bumper (and whether the press is on its rim,
     which resizes, rather than its middle, which moves), or a hole. */
  function itemAt(p: Point): { bumper: Bumper; rim: boolean } | { hole: Point } | null {
    for (let i = bumpers.length - 1; i >= 0; i--) {
      const b = bumpers[i];
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d <= b.radius + 5) return { bumper: b, rim: d > b.radius * MOVE_ZONE };
    }
    for (let i = holes.length - 1; i >= 0; i--) {
      const h = holes[i];
      if (Math.hypot(p.x - h.x, p.y - h.y) <= HOLE_RADIUS + 5) return { hole: h };
    }
    return null;
  }

  function placeHole(p: Point): Point | null {
    if (holes.length >= MAX_HOLES) return null;
    const hole = constrainHole({ x: p.x, y: p.y });
    holes.push(hole);
    return hole;
  }

  /* Put the given colour's bumper at a point — moving it if it is already
     on the table, creating it otherwise. */
  function placeBumper(type: BumperType, p: Point): Bumper {
    let bumper = bumpers.find(b => b.type === type);
    if (!bumper) {
      bumper = { type, x: p.x, y: p.y, radius: DEFAULT_BUMPER_RADIUS, flashUntil: 0, cooldownUntil: 0 };
      bumpers.push(bumper);
    } else {
      bumper.x = p.x;
      bumper.y = p.y;
    }
    constrainBumper(bumper);
    return bumper;
  }

  function removeBumper(bumper: Bumper) {
    bumpers = bumpers.filter(b => b !== bumper);
    effects.push({ x: bumper.x, y: bumper.y, colour: BUMPER_KINDS[bumper.type].colour, start: performance.now(), duration: 260, kind: 'swallow', size: bumper.radius });
    saveLayout();
  }

  function removeHole(hole: Point) {
    holes = holes.filter(h => h !== hole);
    effects.push({ x: hole.x, y: hole.y, colour: '#dfe7f5', start: performance.now(), duration: 260, kind: 'swallow', size: HOLE_RADIUS + 3 });
    saveLayout();
  }

  /* Rejection-samples a spot for a hole the pink bumper opens up: inside
     the open field and clear of the bumpers and the other holes. */
  function findHoleSpot(): Point | null {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = 45 + Math.random() * 235;
      const y = 70 + Math.random() * 370;
      if (bumpers.some(b => Math.hypot(x - b.x, y - b.y) < b.radius + 30)) continue;
      if (holes.some(h => Math.hypot(x - h.x, y - h.y) < 40)) continue;
      return { x, y };
    }
    return null;
  }

  function spawnHole(): void {
    const spot = findHoleSpot();
    if (!spot) return;
    const hole = placeHole(spot);
    if (!hole) return;
    effects.push({ x: hole.x, y: hole.y, colour: BUMPER_KINDS.pink.colour, start: performance.now(), duration: 400, kind: 'emerge', size: HOLE_RADIUS });
    saveLayout();
  }

  function selectKind(kind: PlaceableKind | null) {
    selectedKind = kind;
    hud.setSelectedKind(kind);
    updateCursor();
  }

  /* --- game flow --------------------------------------------------- */

  function restBallOnLaunchPad() {
    balls = [];
    pendingRespawn = 0;
    launchReady = true;
  }

  function startGame() {
    score = 0;
    lives = LIVES_START;
    gameOver = false;
    hud.setScore(score);
    hud.setLives(lives);
    hud.setMessage('Press Space to launch');
    restBallOnLaunchPad();
  }

  function loseBall() {
    lives -= 1;
    hud.setLives(lives);
    if (lives <= 0) {
      gameOver = true;
      if (score > highScore) {
        highScore = score;
        writeHighScore(highScore);
        hud.setHighScore(highScore);
        hud.setMessage(`New high score: ${score}! Press Space to play again`);
      } else {
        hud.setMessage(`Game over — press Space to play again`);
      }
      return;
    }
    hud.setMessage('Press Space to launch');
    restBallOnLaunchPad();
  }

  function launch() {
    if (!launchReady) return;
    launchReady = false;
    balls = [{ x: launchPad.x, y: launchPad.y, vx: (Math.random() - 0.5) * 20, vy: -LAUNCH_VELOCITY }];
    hud.setMessage(null);
  }

  /* A swallowed lone ball comes back out of one of the placed holes, fired
     in a random direction. With no holes on the table it goes back to the
     launch pad instead. */
  function emergeFromHole() {
    pendingRespawn = 0;
    if (!holes.length) {
      restBallOnLaunchPad();
      hud.setMessage('Press Space to launch');
      return;
    }
    const hole = holes[Math.floor(Math.random() * holes.length)];
    const angle = Math.random() * Math.PI * 2;
    balls.push({ x: hole.x, y: hole.y, vx: Math.cos(angle) * EMERGE_SPEED, vy: Math.sin(angle) * EMERGE_SPEED });
    effects.push({ x: hole.x, y: hole.y, colour: '#f87171', start: performance.now(), duration: 420, kind: 'emerge', size: HOLE_RADIUS });
  }

  /* --- input ------------------------------------------------------- */

  function isTyping(target: EventTarget | null): target is HTMLElement {
    if (!(target instanceof HTMLElement)) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable === true;
  }

  function setFlipper(side: 'left' | 'right', active: boolean) {
    const flipper = flippers.find(f => f.side === side);
    if (flipper) flipper.active = active;
  }

  function onKeydown(event: KeyboardEvent) {
    if (isTyping(event.target)) return;
    if (event.key === 'ArrowLeft' || event.key === 'z' || event.key === 'Z') {
      setFlipper('left', true);
      event.preventDefault();
    }
    if (event.key === 'ArrowRight' || event.key === '/' || event.key === 'x' || event.key === 'X') {
      setFlipper('right', true);
      event.preventDefault();
    }
    if (event.key === ' ' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (gameOver) startGame();
      else launch();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (selectedKind) selectKind(null);
      else startGame();
    }
  }

  function onKeyup(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'z' || event.key === 'Z') setFlipper('left', false);
    if (event.key === 'ArrowRight' || event.key === '/' || event.key === 'x' || event.key === 'X') setFlipper('right', false);
  }

  function toLogical(event: PointerEvent | MouseEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * LOGICAL_W,
      y: ((event.clientY - rect.top) / rect.height) * LOGICAL_H,
    };
  }

  /* Touch/mouse: tap the left or right half of the table to work the nearer
     flipper, so the game is playable without a keyboard. */
  function sideFromPoint(p: Point): 'left' | 'right' {
    return p.x < LOGICAL_W / 2 ? 'left' : 'right';
  }

  const pointerSides = new Map<number, 'left' | 'right'>();

  function updateCursor() {
    let cursor = 'pointer';
    if (selectedKind) cursor = 'crosshair';
    else if (dragging) cursor = dragging.kind === 'resize' ? 'nwse-resize' : 'grabbing';
    else if (hovered) cursor = 'bumper' in hovered && hovered.rim ? 'nwse-resize' : 'grab';
    canvas.style.cursor = cursor;
  }

  function onPointerDown(event: PointerEvent) {
    canvas.focus({ preventScroll: true });
    const p = toLogical(event);
    // Placing: the armed item goes wherever the table is clicked, then the
    // same press can be dragged straight on to move it.
    if (selectedKind) {
      if (selectedKind === 'hole') {
        const hole = placeHole(p);
        if (hole) dragging = { kind: 'hole', hole, dx: 0, dy: 0 };
      } else {
        dragging = { kind: 'move', bumper: placeBumper(selectedKind, p), dx: 0, dy: 0 };
      }
      selectKind(null);
      if (dragging) canvas.setPointerCapture(event.pointerId);
      else saveLayout();
      updateCursor();
      return;
    }
    const hit = itemAt(p);
    if (hit) {
      if ('hole' in hit) dragging = { kind: 'hole', hole: hit.hole, dx: hit.hole.x - p.x, dy: hit.hole.y - p.y };
      else if (hit.rim) dragging = { kind: 'resize', bumper: hit.bumper };
      else dragging = { kind: 'move', bumper: hit.bumper, dx: hit.bumper.x - p.x, dy: hit.bumper.y - p.y };
      canvas.setPointerCapture(event.pointerId);
      updateCursor();
      return;
    }
    if (gameOver) { startGame(); return; }
    if (launchReady) { launch(); return; }
    const side = sideFromPoint(p);
    pointerSides.set(event.pointerId, side);
    setFlipper(side, true);
  }

  function onPointerMove(event: PointerEvent) {
    const p = toLogical(event);
    if (dragging) {
      if (dragging.kind === 'resize') {
        // The rim follows the pointer.
        dragging.bumper.radius = Math.hypot(p.x - dragging.bumper.x, p.y - dragging.bumper.y);
        constrainBumper(dragging.bumper);
      } else if (dragging.kind === 'move') {
        dragging.bumper.x = p.x + dragging.dx;
        dragging.bumper.y = p.y + dragging.dy;
        constrainBumper(dragging.bumper);
      } else {
        dragging.hole.x = p.x + dragging.dx;
        dragging.hole.y = p.y + dragging.dy;
        constrainHole(dragging.hole);
      }
      return;
    }
    const over = itemAt(p);
    const changed = !over || !hovered
      ? over !== hovered
      : 'hole' in over || 'hole' in hovered
        ? ('hole' in over ? over.hole : null) !== ('hole' in hovered ? hovered.hole : null)
        : over.bumper !== hovered.bumper || over.rim !== hovered.rim;
    if (changed) {
      hovered = over;
      updateCursor();
    }
  }

  function onPointerUp(event: PointerEvent) {
    if (dragging) {
      dragging = null;
      saveLayout();
      updateCursor();
      return;
    }
    const side = pointerSides.get(event.pointerId);
    if (side) setFlipper(side, false);
    pointerSides.delete(event.pointerId);
  }

  function onDoubleClick(event: MouseEvent) {
    const hit = itemAt(toLogical(event));
    if (!hit) return;
    if ('hole' in hit) removeHole(hit.hole);
    else removeBumper(hit.bumper);
    hovered = null;
    updateCursor();
  }

  /* --- physics ----------------------------------------------------- */

  function updateFlippers(dt: number) {
    for (const flipper of flippers) {
      const target = flipper.active ? flipper.activeAngle : flipper.restAngle;
      const speed = (flipper.active ? FLIPPER_ANGULAR_SPEED : FLIPPER_RETURN_SPEED) * dt;
      const diff = target - flipper.angle;
      flipper.angle += Math.sign(diff) * Math.min(Math.abs(diff), speed);
    }
  }

  function flipperTip(flipper: Flipper): Point {
    return {
      x: flipper.pivot.x + Math.cos(flipper.angle) * FLIPPER_LENGTH,
      y: flipper.pivot.y + Math.sin(flipper.angle) * FLIPPER_LENGTH,
    };
  }

  function flipperAngularVelocity(flipper: Flipper): number {
    const target = flipper.active ? flipper.activeAngle : flipper.restAngle;
    const speed = flipper.active ? FLIPPER_ANGULAR_SPEED : FLIPPER_RETURN_SPEED;
    return Math.sign(target - flipper.angle) * speed;
  }

  function resolveCircleSegment(ball: Ball, a: Point, b: Point, radius: number, restitution: number, tipVelocity?: Point) {
    const { point, t } = closestOnSegment(ball, a, b);
    const dx = ball.x - point.x;
    const dy = ball.y - point.y;
    const distance = Math.hypot(dx, dy) || 0.0001;
    const overlap = BALL_RADIUS + radius - distance;
    if (overlap <= 0) return;

    const nx = dx / distance;
    const ny = dy / distance;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const velocityAlongNormal = ball.vx * nx + ball.vy * ny;
    if (velocityAlongNormal < 0) {
      ball.vx -= (1 + restitution) * velocityAlongNormal * nx;
      ball.vy -= (1 + restitution) * velocityAlongNormal * ny;
    }
    if (tipVelocity) {
      // Contact nearer the tip (t close to 1) gets more of the flipper's snap.
      ball.vx += tipVelocity.x * TIP_IMPULSE * t;
      ball.vy += tipVelocity.y * TIP_IMPULSE * t;
    }
  }

  /* Standard elastic bounce off a bumper, then a colour-specific tweak to
     the resulting speed/direction. Returns false if the ball wasn't
     actually touching it. Life-cycle effects (swallow/split/spawn) are left
     to the caller, since they need to reach into the ball list. */
  function bounceOffBumper(ball: Ball, bumper: Bumper): boolean {
    const dx = ball.x - bumper.x;
    const dy = ball.y - bumper.y;
    const distance = Math.hypot(dx, dy) || 0.0001;
    const overlap = BALL_RADIUS + bumper.radius - distance;
    if (overlap <= 0) return false;

    const nx = dx / distance;
    const ny = dy / distance;
    ball.x += nx * overlap;
    ball.y += ny * overlap;

    const speed = Math.hypot(ball.vx, ball.vy);
    switch (bumper.type) {
      case 'grey': {
        // Saps momentum so the ball loses the fight against gravity.
        const damped = Math.min(speed * 0.5, 170);
        ball.vx = nx * damped; ball.vy = ny * damped;
        break;
      }
      case 'yellow': {
        // A jolt in a fresh, unrelated direction.
        const angle = Math.random() * Math.PI * 2;
        const zapped = Math.max(speed, 420);
        ball.vx = Math.cos(angle) * zapped; ball.vy = Math.sin(angle) * zapped;
        break;
      }
      case 'green': {
        const boosted = Math.max(speed * 1.25, 300);
        ball.vx = nx * boosted; ball.vy = ny * boosted;
        break;
      }
      default: {
        // red / purple / pink still bounce normally; their extra effect is
        // layered on by the caller.
        const boosted = Math.max(speed * 1.1, 240);
        ball.vx = nx * boosted; ball.vy = ny * boosted;
      }
    }

    score += BUMPER_KINDS[bumper.type].score;
    hud.setScore(score);
    const now = performance.now();
    bumper.flashUntil = now + 160;
    effects.push({ x: bumper.x, y: bumper.y, colour: BUMPER_KINDS[bumper.type].colour, start: now, duration: 380, kind: 'ring', size: bumper.radius });
    return true;
  }

  function clampSpeed(ball: Ball) {
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > MAX_SPEED) {
      const scale = MAX_SPEED / speed;
      ball.vx *= scale;
      ball.vy *= scale;
    }
  }

  function isDrained(ball: Ball): boolean {
    if (ball.y > LOGICAL_H + 40) return true; // shouldn't normally happen, but don't strand it offscreen
    return ball.y > drain.y + BALL_RADIUS * 2 && ball.x > drain.left && ball.x < drain.right;
  }

  function step(dt: number) {
    updateFlippers(dt);
    const now = performance.now();
    effects = effects.filter(e => now - e.start < e.duration);
    if (gameOver || launchReady) return;

    if (pendingRespawn && now >= pendingRespawn) emergeFromHole();

    const removeAt = new Set<number>();
    const spawned: Ball[] = [];

    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      ball.vy += GRAVITY * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      for (const wall of walls) resolveCircleSegment(ball, wall.a, wall.b, WALL_THICKNESS, 0.8);
      for (const flipper of flippers) {
        const tip = flipperTip(flipper);
        const angularVelocity = flipperAngularVelocity(flipper);
        const tipVelocity = { x: -Math.sin(flipper.angle) * angularVelocity * FLIPPER_LENGTH, y: Math.cos(flipper.angle) * angularVelocity * FLIPPER_LENGTH };
        resolveCircleSegment(ball, flipper.pivot, tip, FLIPPER_RADIUS, 0.4, tipVelocity);
      }

      for (const bumper of bumpers) {
        if (now < bumper.cooldownUntil) continue;
        if (!bounceOffBumper(ball, bumper)) continue;
        bumper.cooldownUntil = now + BUMPER_COOLDOWN;
        const ballsAfter = balls.length - removeAt.size + spawned.length;
        if (bumper.type === 'red') {
          // Swallowed. A lone ball is spat back out of a random hole shortly.
          removeAt.add(i);
          effects.push({ x: bumper.x, y: bumper.y, colour: BUMPER_KINDS.red.colour, start: now, duration: 320, kind: 'swallow', size: bumper.radius + 6 });
          if (ballsAfter <= 1) pendingRespawn = now + RESPAWN_DELAY;
        } else if (bumper.type === 'purple' && ballsAfter < MAX_BALLS) {
          const angle = Math.atan2(ball.vy, ball.vx) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 4 + Math.random() * 0.3);
          const speed = Math.max(Math.hypot(ball.vx, ball.vy), 260);
          spawned.push({ x: ball.x, y: ball.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
        } else if (bumper.type === 'pink') {
          spawnHole();
        }
      }

      clampSpeed(ball);
      if (isDrained(ball)) removeAt.add(i);
    }

    if (removeAt.size) balls = balls.filter((_, i) => !removeAt.has(i));
    if (spawned.length) balls = balls.concat(spawned);

    if (balls.length === 0 && !pendingRespawn) loseBall();
  }

  /* --- drawing ----------------------------------------------------- */

  function drawTable(now: number) {
    // Felt: a deep blue radial wash with a vignette toward the rails.
    const felt = ctx.createRadialGradient(180, 240, 30, 180, 300, 420);
    felt.addColorStop(0, '#16224a');
    felt.addColorStop(0.6, '#0d1533');
    felt.addColorStop(1, '#05091b');
    ctx.fillStyle = felt;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    // Soft coloured pools of light on the playfield.
    for (const [x, y, r, colour] of [[110, 170, 150, 'rgba(96,165,250,0.10)'], [250, 330, 160, 'rgba(244,114,182,0.08)'], [180, 470, 140, 'rgba(52,211,153,0.07)']] as const) {
      const pool = ctx.createRadialGradient(x, y, 0, x, y, r);
      pool.addColorStop(0, colour);
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pool;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Faint lane markings.
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let y = 60; y < 470; y += 40) {
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(300, y);
      ctx.stroke();
    }

    // The launch lane, lit slightly differently.
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(314, 72, 30, 490);

    // Drain: a dark slot between the flippers.
    const drainGlow = ctx.createLinearGradient(0, 560, 0, 620);
    drainGlow.addColorStop(0, 'rgba(0,0,0,0)');
    drainGlow.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = drainGlow;
    ctx.fillRect(drain.left, 560, drain.right - drain.left, 60);

    // A row of lamps along the top curve that chase around.
    for (let i = 0; i < 7; i++) {
      const angle = Math.PI + (Math.PI * (i + 0.5)) / 7;
      const x = 180 + Math.cos(angle) * 128;
      const y = 78 + Math.sin(angle) * 44;
      const lit = (Math.floor(now / 140) + i) % 7 === 0;
      ctx.fillStyle = lit ? '#fde68a' : 'rgba(253,230,138,0.25)';
      if (lit) {
        ctx.shadowColor = '#fde68a';
        ctx.shadowBlur = 12;
      }
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawWalls() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [width, colour] of [[WALL_THICKNESS * 2 + 3, 'rgba(0,0,0,0.55)'], [WALL_THICKNESS * 2, '#8d9bb5'], [WALL_THICKNESS, '#dfe7f5']] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const wall of walls) {
        ctx.moveTo(wall.a.x, wall.a.y);
        ctx.lineTo(wall.b.x, wall.b.y);
      }
      ctx.stroke();
    }
  }

  function drawHoles() {
    for (const hole of holes) {
      const pit = ctx.createRadialGradient(hole.x, hole.y - 2, 1, hole.x, hole.y, HOLE_RADIUS + 3);
      pit.addColorStop(0, '#000000');
      pit.addColorStop(0.7, '#05070f');
      pit.addColorStop(1, 'rgba(60,70,110,0.9)');
      ctx.fillStyle = pit;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, HOLE_RADIUS + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, HOLE_RADIUS + 2.5, Math.PI * 0.9, Math.PI * 1.9);
      ctx.stroke();
      const active = (dragging && dragging.kind === 'hole' && dragging.hole === hole)
        || (hovered !== null && 'hole' in hovered && hovered.hole === hole);
      if (active) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(hole.x, hole.y, HOLE_RADIUS + 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawBumper(bumper: Bumper, now: number) {
    const kind = BUMPER_KINDS[bumper.type];
    const flashing = bumper.flashUntil > now;
    const active = (dragging && dragging.kind !== 'hole' && dragging.bumper === bumper)
      || (hovered !== null && 'bumper' in hovered && hovered.bumper === bumper);

    ctx.shadowColor = kind.colour;
    ctx.shadowBlur = flashing ? 30 : 14;
    ctx.fillStyle = flashing ? kind.colour : hexToRgba(kind.colour, 0.16);
    ctx.beginPath();
    ctx.arc(bumper.x, bumper.y, bumper.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (!flashing) {
      const dome = ctx.createRadialGradient(bumper.x - bumper.radius * 0.35, bumper.y - bumper.radius * 0.4, 1, bumper.x, bumper.y, bumper.radius);
      dome.addColorStop(0, 'rgba(255,255,255,0.28)');
      dome.addColorStop(0.5, 'rgba(255,255,255,0.03)');
      dome.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = dome;
      ctx.fill();
    }

    ctx.strokeStyle = kind.colour;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(bumper.x, bumper.y, Math.max(2, bumper.radius - 4), 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = flashing ? '#ffffff' : kind.colour;
    ctx.beginPath();
    ctx.arc(bumper.x, bumper.y, Math.max(2, bumper.radius * 0.22), 0, Math.PI * 2);
    ctx.fill();

    if (active) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bumper.x, bumper.y, bumper.radius + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawFlipper(flipper: Flipper) {
    const tip = flipperTip(flipper);
    ctx.lineCap = 'round';
    ctx.lineWidth = FLIPPER_RADIUS * 2 + 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(flipper.pivot.x, flipper.pivot.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    const shade = ctx.createLinearGradient(flipper.pivot.x, flipper.pivot.y - FLIPPER_RADIUS, flipper.pivot.x, flipper.pivot.y + FLIPPER_RADIUS);
    shade.addColorStop(0, '#f8fbff');
    shade.addColorStop(1, '#8b98b3');
    ctx.strokeStyle = shade;
    ctx.lineWidth = FLIPPER_RADIUS * 2;
    ctx.stroke();
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#3b4560';
    ctx.beginPath();
    ctx.arc(flipper.pivot.x, flipper.pivot.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBall(ball: Point) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(ball.x + 2, ball.y + 3, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    const chrome = ctx.createRadialGradient(ball.x - 2.5, ball.y - 2.5, 1, ball.x, ball.y, BALL_RADIUS);
    chrome.addColorStop(0, '#ffffff');
    chrome.addColorStop(0.35, '#dbe3f0');
    chrome.addColorStop(1, '#3d4760');
    ctx.fillStyle = chrome;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlunger() {
    ctx.strokeStyle = '#8d9bb5';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 566; y < 596; y += 5) {
      ctx.moveTo(launchPad.x - 6, y);
      ctx.lineTo(launchPad.x + 6, y + 2.5);
    }
    ctx.stroke();
    ctx.fillStyle = '#f87171';
    ctx.fillRect(launchPad.x - 8, 558, 16, 6);
  }

  function drawEffects(now: number) {
    for (const effect of effects) {
      const t = Math.min(1, (now - effect.start) / effect.duration);
      ctx.lineWidth = 2;
      if (effect.kind === 'ring') {
        ctx.strokeStyle = hexToRgba(effect.colour, 1 - t);
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.size + t * 26, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.kind === 'swallow') {
        ctx.strokeStyle = hexToRgba(effect.colour, 1 - t);
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, Math.max(1, effect.size * (1 - t)), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = hexToRgba(effect.colour, 1 - t);
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, effect.size + t * 34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = hexToRgba(effect.colour, 0.5 * (1 - t));
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const d = effect.size + t * 40;
          ctx.beginPath();
          ctx.arc(effect.x + Math.cos(a) * d, effect.y + Math.sin(a) * d, 2.5 * (1 - t) + 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function draw() {
    const now = performance.now();
    drawTable(now);
    drawHoles();
    for (const bumper of bumpers) drawBumper(bumper, now);
    drawEffects(now);
    drawWalls();
    drawPlunger();
    for (const flipper of flippers) drawFlipper(flipper);

    if (!gameOver) {
      const ballsToDraw = launchReady ? [launchPad] : balls;
      for (const ball of ballsToDraw) drawBall(ball);
    }

    if (selectedKind) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(selectedKind === 'hole' ? 'Click the table to dig a hole' : 'Click the table to place it', 180, 500);
    }
  }

  function tick(time: number) {
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 1 / 30) : 0;
    lastTime = time;
    step(dt);
    draw();
    animationFrame = requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resize);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('keyup', onKeyup);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('dblclick', onDoubleClick);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  // The desktop shell resizes this page by resizing the iframe it sits in,
  // which doesn't reliably fire a window 'resize' event — watch the canvas
  // box itself so the table keeps filling whatever room it's given.
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  resizeObserver?.observe(canvas);

  resize();
  // The desktop shell opens this page inside an unfocused iframe — without
  // grabbing focus ourselves, arrow/space/escape here are captured by the
  // parent desktop (e.g. the ambient Snake) instead of ever reaching us.
  canvas.tabIndex = 0;
  try { window.focus(); canvas.focus({ preventScroll: true }); } catch (error) {}
  loadLayout();
  hud.setSelectedKind(null);
  hud.setMessage('Press Space to start');
  hud.setScore(0);
  hud.setLives(LIVES_START);
  updateCursor();
  draw();
  animationFrame = requestAnimationFrame(tick);

  return {
    selectKind,
    destroy() {
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('keyup', onKeyup);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('dblclick', onDoubleClick);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      resizeObserver?.disconnect();
      if (animationFrame != null) cancelAnimationFrame(animationFrame);
    },
  };
}
