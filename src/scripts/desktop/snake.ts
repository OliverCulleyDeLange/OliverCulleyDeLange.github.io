/* Ambient desktop Snake.
   This module deliberately owns its own state, rendering, keyboard takeover,
   and preference. The window manager only creates it and exposes its setting. */

const SPEED_STORAGE_KEY = 'odl-ambient-snake-speed';
const ENABLED_STORAGE_KEY = 'odl-ambient-snake';
const SPEEDS = { disabled: 0, slow: 190, normal: 115, fast: 65 } as const;
const SPEED_MULTIPLIERS = { disabled: 0, slow: 1, normal: 2, fast: 3 } as const;
type Speed = keyof typeof SPEEDS;
type Cell = { x: number; y: number };
const CELL_SIZE = 13;
const DIRECTIONS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
} as const;
type Direction = Cell;
type DirectionKey = keyof typeof DIRECTIONS;

const isDirectionKey = (key: string): key is DirectionKey => Object.hasOwn(DIRECTIONS, key);

function readSpeed(): Speed {
  try {
    const saved = localStorage.getItem(SPEED_STORAGE_KEY);
    if (saved && Object.hasOwn(SPEEDS, saved)) return saved as Speed;
    // Respect the separate on/off setting used by the first version.
    return JSON.parse(localStorage.getItem(ENABLED_STORAGE_KEY) ?? 'true') === false ? 'disabled' : 'normal';
  } catch (error) {
    return 'normal';
  }
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

function isTyping(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable === true;
}

export function createAmbientSnake(canvas: HTMLCanvasElement | null) {
  if (!canvas) return { isEnabled: () => false, setEnabled: () => {}, destroy: () => {} };

  const snakeCanvas = canvas;
  const context = snakeCanvas.getContext('2d');
  if (!context) return { isEnabled: () => false, setEnabled: () => {}, destroy: () => {} };
  const ctx: CanvasRenderingContext2D = context;
  let grid = { columns: 1, rows: 1 };
  let snake: Cell[] = [];
  let direction: Direction = DIRECTIONS.ArrowRight;
  let food: Cell = { x: 0, y: 0 };
  let playerControlled = false;
  let speed = readSpeed();
  let foodEaten = 0;
  const heldArrowKeys = new Set();
  let stepTimer: number | null = null;
  /* Swipes on the empty desktop area let mobile users control the snake.
     The canvas itself has pointer-events: none, so touches on visual snake
     space still reach the desktop container behind it. */
  const SWIPE_THRESHOLD = 24;
  let touchStart: { x: number; y: number } | null = null;
  const desktopEl = snakeCanvas.parentElement;
  /* Colours come from CSS custom properties, so getComputedStyle is expensive.
     Cache them and refresh only when the theme actually changes. */
  let cachedInk = '';
  let cachedPaper = '';
  let coloursDirty = true;

  const isEnabled = () => speed !== 'disabled';

  function refreshColours() {
    const styles = getComputedStyle(document.documentElement);
    cachedInk = styles.getPropertyValue('--ink').trim();
    cachedPaper = styles.getPropertyValue('--paper').trim();
    coloursDirty = false;
  }

  function resize() {
    const rect = snakeCanvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    snakeCanvas.width = Math.max(1, Math.floor(rect.width * ratio));
    snakeCanvas.height = Math.max(1, Math.floor(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    grid = {
      columns: Math.max(12, Math.floor(rect.width / CELL_SIZE)),
      rows: Math.max(8, Math.floor(rect.height / CELL_SIZE)),
    };
    reset();
    draw();
  }

  function randomOpenCell() {
    const open = [];
    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.columns; x++) {
        const cell = { x, y };
        if (!snake.some(segment => sameCell(segment, cell))) open.push(cell);
      }
    }
    return open[Math.floor(Math.random() * open.length)] || { x: 0, y: 0 };
  }

  function reset() {
    const center = { x: Math.floor(grid.columns / 2), y: Math.floor(grid.rows / 2) };
    snake = [center, { x: center.x - 1, y: center.y }, { x: center.x - 2, y: center.y }];
    direction = DIRECTIONS.ArrowRight;
    food = randomOpenCell();
    foodEaten = 0;
  }

  function nextCell(from: Cell, movement: Direction): Cell {
    return { x: (from.x + movement.x + grid.columns) % grid.columns, y: (from.y + movement.y + grid.rows) % grid.rows };
  }

  function wouldCollide(next: Cell): boolean {
    const eating = sameCell(next, food);
    const body = eating ? snake : snake.slice(0, -1);
    return body.some(segment => sameCell(segment, next));
  }

  function chooseAutoplayDirection() {
    const candidates = Object.values(DIRECTIONS).filter(candidate => {
      const reversing = candidate.x === -direction.x && candidate.y === -direction.y;
      return !reversing && !wouldCollide(nextCell(snake[0], candidate));
    });
    if (!candidates.length) return direction;

    /* Head for food, but prefer a route with room to turn rather than blindly
       taking the shortest path into the snake's own body. */
    return candidates.sort((a, b) => {
      const nextA = nextCell(snake[0], a);
      const nextB = nextCell(snake[0], b);
      const distanceA = Math.abs(nextA.x - food.x) + Math.abs(nextA.y - food.y);
      const distanceB = Math.abs(nextB.x - food.x) + Math.abs(nextB.y - food.y);
      return distanceA - distanceB;
    })[0];
  }

  function step() {
    if (!playerControlled) direction = chooseAutoplayDirection();
    const head = nextCell(snake[0], direction);
    if (wouldCollide(head)) {
      reset();
      return;
    }
    snake.unshift(head);
    if (sameCell(head, food)) {
      foodEaten += 1;
      food = randomOpenCell();
    } else snake.pop();
  }

  function draw() {
    if (coloursDirty) refreshColours();
    const width = snakeCanvas.clientWidth;
    const height = snakeCanvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    if (!isEnabled()) return;

    ctx.fillStyle = cachedPaper;
    ctx.strokeStyle = cachedInk;
    ctx.lineWidth = 1;
    snake.forEach((segment, index) => {
      const x = segment.x * CELL_SIZE;
      const y = segment.y * CELL_SIZE;
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeRect(x + 1.5, y + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
      if (index === 0) {
        ctx.fillStyle = cachedInk;
        ctx.fillRect(x + 4, y + 4, 2, 2);
        ctx.fillRect(x + 8, y + 4, 2, 2);
        ctx.fillStyle = cachedPaper;
      }
    });
    ctx.fillStyle = cachedInk;
    ctx.fillRect(food.x * CELL_SIZE + 3, food.y * CELL_SIZE + 3, CELL_SIZE - 6, CELL_SIZE - 6);
  }

  function stepInterval(): number {
    const foodSpeed = Math.pow(1 + SPEED_MULTIPLIERS[speed] / 100, foodEaten);
    const heldKeySpeed = heldArrowKeys.size ? 2 : 1;
    return SPEEDS[speed] / foodSpeed / heldKeySpeed;
  }

  function scheduleNextStep() {
    if (stepTimer !== null || !isEnabled() || document.hidden) return;
    stepTimer = window.setTimeout(() => {
      stepTimer = null;
      step();
      draw();
      scheduleNextStep();
    }, stepInterval());
  }

  function stopStepping() {
    if (stepTimer !== null) {
      clearTimeout(stepTimer);
      stepTimer = null;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    const movement = isDirectionKey(event.key) ? DIRECTIONS[event.key] : undefined;
    if (!isEnabled() || !movement || isTyping(event.target) || document.documentElement.classList.contains('is-locked')) return;
    const reversing = movement.x === -direction.x && movement.y === -direction.y;
    if (!reversing) direction = movement;
    playerControlled = true;
    heldArrowKeys.add(event.key);
    event.preventDefault();
  }

  function onKeyup(event: KeyboardEvent): void {
    if (isDirectionKey(event.key)) heldArrowKeys.delete(event.key);
  }

  function onWindowBlur() {
    heldArrowKeys.clear();
  }

  function onTouchStart(event: TouchEvent): void {
    if (!isEnabled() || document.documentElement.classList.contains('is-locked')) { touchStart = null; return; }
    if (event.touches.length !== 1) { touchStart = null; return; }
    /* The desk-icons <ul> fills the whole desktop, so plain background touches
       land on it rather than on .desktop itself. Accept anything within the
       desktop that isn't a desk-icon — windows live outside .desktop. */
    if (!(event.target instanceof Element) || event.target.closest('.desk-icon')) { touchStart = null; return; }
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent): void {
    if (!touchStart) return;
    const start = touchStart;
    touchStart = null;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (Math.max(absX, absY) < SWIPE_THRESHOLD) return;
    const movement = absX > absY
      ? (dx > 0 ? DIRECTIONS.ArrowRight : DIRECTIONS.ArrowLeft)
      : (dy > 0 ? DIRECTIONS.ArrowDown : DIRECTIONS.ArrowUp);
    const reversing = movement.x === -direction.x && movement.y === -direction.y;
    if (!reversing) direction = movement;
    playerControlled = true;
  }

  function onTouchCancel() {
    touchStart = null;
  }

  function onVisibilityChange() {
    if (document.hidden) stopStepping();
    else scheduleNextStep();
  }

  function setSpeed(nextSpeed: Speed): void {
    if (!Object.hasOwn(SPEEDS, nextSpeed)) return;
    speed = nextSpeed;
    try { localStorage.setItem(SPEED_STORAGE_KEY, speed); } catch (error) {}
    snakeCanvas.hidden = !isEnabled();
    stopStepping();
    if (isEnabled()) {
      playerControlled = false;
      reset();
      draw();
      scheduleNextStep();
    } else {
      draw();
    }
  }

  /* Watch data-theme changes so cached CSS colours stay accurate without
     re-reading getComputedStyle on every frame. */
  const themeObserver = new MutationObserver(() => {
    coloursDirty = true;
    draw();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

  const systemThemeMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onSystemThemeChange = () => { coloursDirty = true; draw(); };
  systemThemeMedia?.addEventListener?.('change', onSystemThemeChange);

  window.addEventListener('resize', resize);
  window.addEventListener('blur', onWindowBlur);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('keyup', onKeyup);
  document.addEventListener('visibilitychange', onVisibilityChange);
  desktopEl?.addEventListener('touchstart', onTouchStart, { passive: true });
  desktopEl?.addEventListener('touchend', onTouchEnd, { passive: true });
  desktopEl?.addEventListener('touchcancel', onTouchCancel, { passive: true });
  snakeCanvas.hidden = !isEnabled();
  resize();
  scheduleNextStep();

  return {
    currentSpeed: () => speed,
    setSpeed,
    refresh: resize,
    destroy() {
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('keyup', onKeyup);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      desktopEl?.removeEventListener('touchstart', onTouchStart);
      desktopEl?.removeEventListener('touchend', onTouchEnd);
      desktopEl?.removeEventListener('touchcancel', onTouchCancel);
      systemThemeMedia?.removeEventListener?.('change', onSystemThemeChange);
      themeObserver.disconnect();
      stopStepping();
    },
  };
}
