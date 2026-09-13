/* Ambient desktop Snake.
   This module deliberately owns its own state, rendering, keyboard takeover,
   and preference. The window manager only creates it and exposes its setting. */

const SPEED_STORAGE_KEY = 'odl-ambient-snake-speed';
const ENABLED_STORAGE_KEY = 'odl-ambient-snake';
const SPEEDS = { disabled: 0, slow: 190, normal: 115, fast: 65 };
const SPEED_MULTIPLIERS = { disabled: 0, slow: 1, normal: 2, fast: 3 };
const CELL_SIZE = 13;
const DIRECTIONS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

function readSpeed() {
  try {
    const saved = localStorage.getItem(SPEED_STORAGE_KEY);
    if (Object.hasOwn(SPEEDS, saved)) return saved;
    // Respect the separate on/off setting used by the first version.
    return JSON.parse(localStorage.getItem(ENABLED_STORAGE_KEY)) === false ? 'disabled' : 'normal';
  } catch (error) {
    return 'normal';
  }
}

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function isTyping(target) {
  if (!target) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable === true;
}

export function createAmbientSnake(canvas) {
  if (!canvas) return { isEnabled: () => false, setEnabled: () => {}, destroy: () => {} };

  const ctx = canvas.getContext('2d');
  let grid = { columns: 1, rows: 1 };
  let snake = [];
  let direction = DIRECTIONS.ArrowRight;
  let food = { x: 0, y: 0 };
  let playerControlled = false;
  let speed = readSpeed();
  let foodEaten = 0;
  const heldArrowKeys = new Set();
  let lastStep = 0;
  let animationFrame = null;

  const isEnabled = () => speed !== 'disabled';

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    grid = {
      columns: Math.max(12, Math.floor(rect.width / CELL_SIZE)),
      rows: Math.max(8, Math.floor(rect.height / CELL_SIZE)),
    };
    reset();
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

  function nextCell(from, movement) {
    return { x: (from.x + movement.x + grid.columns) % grid.columns, y: (from.y + movement.y + grid.rows) % grid.rows };
  }

  function wouldCollide(next) {
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

  function colours() {
    const styles = getComputedStyle(document.documentElement);
    return { ink: styles.getPropertyValue('--ink').trim(), paper: styles.getPropertyValue('--paper').trim() };
  }

  function draw() {
    const { ink, paper } = colours();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    if (!isEnabled()) return;

    ctx.fillStyle = paper;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    snake.forEach((segment, index) => {
      const x = segment.x * CELL_SIZE;
      const y = segment.y * CELL_SIZE;
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.strokeRect(x + 1.5, y + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
      if (index === 0) {
        ctx.fillStyle = ink;
        ctx.fillRect(x + 4, y + 4, 2, 2);
        ctx.fillRect(x + 8, y + 4, 2, 2);
        ctx.fillStyle = paper;
      }
    });
    ctx.fillStyle = ink;
    ctx.fillRect(food.x * CELL_SIZE + 3, food.y * CELL_SIZE + 3, CELL_SIZE - 6, CELL_SIZE - 6);
  }

  function tick(time) {
    const foodSpeed = Math.pow(1 + SPEED_MULTIPLIERS[speed] / 100, foodEaten);
    const heldKeySpeed = heldArrowKeys.size ? 2 : 1;
    const stepInterval = SPEEDS[speed] / foodSpeed / heldKeySpeed;
    if (isEnabled() && time - lastStep >= stepInterval) {
      step();
      lastStep = time;
    }
    draw();
    animationFrame = requestAnimationFrame(tick);
  }

  function onKeydown(event) {
    const movement = DIRECTIONS[event.key];
    if (!isEnabled() || !movement || isTyping(event.target) || document.documentElement.classList.contains('is-locked')) return;
    const reversing = movement.x === -direction.x && movement.y === -direction.y;
    if (!reversing) direction = movement;
    playerControlled = true;
    heldArrowKeys.add(event.key);
    event.preventDefault();
  }

  function onKeyup(event) {
    if (DIRECTIONS[event.key]) heldArrowKeys.delete(event.key);
  }

  function onWindowBlur() {
    heldArrowKeys.clear();
  }

  function setSpeed(nextSpeed) {
    if (!Object.hasOwn(SPEEDS, nextSpeed)) return;
    speed = nextSpeed;
    try { localStorage.setItem(SPEED_STORAGE_KEY, speed); } catch (error) {}
    canvas.hidden = !isEnabled();
    if (isEnabled()) {
      playerControlled = false;
      reset();
    }
    lastStep = performance.now();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('blur', onWindowBlur);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('keyup', onKeyup);
  canvas.hidden = !isEnabled();
  resize();
  animationFrame = requestAnimationFrame(tick);

  return {
    currentSpeed: () => speed,
    setSpeed,
    refresh: resize,
    destroy() {
      window.removeEventListener('resize', resize);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('keyup', onKeyup);
      if (animationFrame) cancelAnimationFrame(animationFrame);
    },
  };
}
