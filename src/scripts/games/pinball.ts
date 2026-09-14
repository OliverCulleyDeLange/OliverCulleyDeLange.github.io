/* Pinball — a small single-table machine on a canvas. Like the other game
   modules, this file owns all of its state, physics, rendering, and input;
   the page around it just supplies a canvas and a few HUD callbacks, and a
   high score is persisted under its own storage key.

   Obstructions ("bumpers") are randomised each new game and colour-coded by
   effect — see BUMPER_KINDS below for what each colour does. */

const LOGICAL_W = 360;
const LOGICAL_H = 620;

const GRAVITY = 780; // px/s^2
const BALL_RADIUS = 7;
const WALL_THICKNESS = 3;
const MAX_SPEED = 1050;
const LIVES_START = 3;
const LAUNCH_VELOCITY = 940;
const MAX_BALLS = 4;
const MAX_BUMPERS = 9;
const HIGH_SCORE_KEY = 'odl-pinball-highscore';

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

type BumperType = 'grey' | 'green' | 'red' | 'yellow' | 'purple' | 'pink';

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

export interface PinballHud {
  setScore(score: number): void;
  setLives(lives: number): void;
  setMessage(text: string | null): void;
  setHighScore(score: number): void;
}

/* What each obstruction colour does, and how many points it's worth. Hinge
   effects (removal, splitting, spawning) are applied by the caller since
   they need access to the ball list; this only describes the bounce. */
const BUMPER_KINDS: Record<BumperType, { score: number; colour: string }> = {
  grey: { score: 50, colour: '#9aa1a9' },
  green: { score: 100, colour: '#22c55e' },
  red: { score: 200, colour: '#ef4444' },
  yellow: { score: 75, colour: '#eab308' },
  purple: { score: 150, colour: '#a855f7' },
  pink: { score: 125, colour: '#ec4899' },
};
const BUMPER_TYPES = Object.keys(BUMPER_KINDS) as BumperType[];

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

export function createPinball(canvas: HTMLCanvasElement, hud: PinballHud) {
  const context = canvas.getContext('2d');
  if (!context) return { destroy() {} };
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
    // Curls the lane's foot in toward the right flipper's hinge, for any
    // ball that ends up back down in that pocket during normal play.
    { a: { x: 312, y: 560 }, b: { x: 268, y: 558 } },
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
  // A red bumper teleports a lone ball back into play here instead of
  // costing a life — drawn as a dashed "warp" ring so it reads as a feature.
  const respawn = { x: 180, y: 110, radius: 16 };
  // The ball waits in the right-hand lane and launches straight up it.
  const launchPad = { x: 329, y: 545 };

  let bumpers: Bumper[] = [];
  let balls: Ball[] = [];
  let launchReady = false;

  let score = 0;
  let lives = LIVES_START;
  let highScore = readHighScore();
  let gameOver = true;
  let lastTime = 0;
  let animationFrame: number | null = null;

  hud.setHighScore(highScore);

  function resize() {
    // The canvas can now be displayed at any size the window allows (see
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

  function randomBumperType(): BumperType {
    return BUMPER_TYPES[Math.floor(Math.random() * BUMPER_TYPES.length)];
  }

  /* Rejection-samples a spot for a new obstruction: inside the open field,
     clear of the launch lane, the respawn ring, and other obstructions. */
  function findBumperSpot(existing: Bumper[]): Point | null {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = 45 + Math.random() * 235; // stays clear of the launch lane at x >= 312
      const y = 70 + Math.random() * 370;
      if (Math.hypot(x - launchPad.x, y - launchPad.y) < 60) continue;
      if (Math.hypot(x - respawn.x, y - respawn.y) < 50) continue;
      if (existing.some(b => Math.hypot(x - b.x, y - b.y) < b.radius + 42)) continue;
      return { x, y };
    }
    return null;
  }

  function spawnRandomBumper(): void {
    if (bumpers.length >= MAX_BUMPERS) return;
    const spot = findBumperSpot(bumpers);
    if (!spot) return;
    bumpers.push({ x: spot.x, y: spot.y, radius: 16 + Math.random() * 6, type: randomBumperType(), flashUntil: 0, cooldownUntil: 0 });
  }

  function generateBumpers(): void {
    bumpers = [];
    for (let i = 0; i < 5; i++) spawnRandomBumper();
  }

  function restBallOnLaunchPad() {
    balls = [];
    launchReady = true;
  }

  function startGame() {
    score = 0;
    lives = LIVES_START;
    gameOver = false;
    // Bumpers are already on the table from setup (or however the player
    // last shuffled them with the flippers) — starting just locks them in.
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
      if (gameOver) generateBumpers(); // reshuffle the table before committing with Space
      event.preventDefault();
    }
    if (event.key === 'ArrowRight' || event.key === '/' || event.key === 'x' || event.key === 'X') {
      setFlipper('right', true);
      if (gameOver) generateBumpers();
      event.preventDefault();
    }
    if (event.key === ' ' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (gameOver) startGame();
      else launch();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      generateBumpers();
      startGame();
    }
  }

  function onKeyup(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'z' || event.key === 'Z') setFlipper('left', false);
    if (event.key === 'ArrowRight' || event.key === '/' || event.key === 'x' || event.key === 'X') setFlipper('right', false);
  }

  /* Touch/mouse: tap the left or right half of the table to work the nearer
     flipper, so the game is playable without a keyboard. */
  function sideFromEvent(event: PointerEvent): 'left' | 'right' {
    const rect = canvas.getBoundingClientRect();
    return event.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
  }

  const pointerSides = new Map<number, 'left' | 'right'>();

  function onPointerDown(event: PointerEvent) {
    if (gameOver) { startGame(); return; }
    if (launchReady) { launch(); return; }
    const side = sideFromEvent(event);
    pointerSides.set(event.pointerId, side);
    setFlipper(side, true);
  }

  function onPointerUp(event: PointerEvent) {
    const side = pointerSides.get(event.pointerId);
    if (side) setFlipper(side, false);
    pointerSides.delete(event.pointerId);
  }

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
     actually touching it. Life-cycle effects (remove/split/spawn) are left
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
    bumper.flashUntil = performance.now() + 160;
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
    if (gameOver || launchReady) return;

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
        if (performance.now() < bumper.cooldownUntil) continue;
        if (!bounceOffBumper(ball, bumper)) continue;
        bumper.cooldownUntil = performance.now() + BUMPER_COOLDOWN;
        const ballsAfter = balls.length - removeAt.size + spawned.length;
        if (bumper.type === 'red') {
          if (ballsAfter > 1) {
            removeAt.add(i);
          } else {
            ball.x = respawn.x; ball.y = respawn.y; ball.vx = 0; ball.vy = 140;
          }
        } else if (bumper.type === 'purple' && ballsAfter < MAX_BALLS) {
          const angle = Math.atan2(ball.vy, ball.vx) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 4 + Math.random() * 0.3);
          const speed = Math.max(Math.hypot(ball.vx, ball.vy), 260);
          spawned.push({ x: ball.x, y: ball.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
        } else if (bumper.type === 'pink') {
          spawnRandomBumper();
        }
      }

      clampSpeed(ball);
      if (isDrained(ball)) removeAt.add(i);
    }

    if (removeAt.size) balls = balls.filter((_, i) => !removeAt.has(i));
    if (spawned.length) balls = balls.concat(spawned);

    if (balls.length === 0) loseBall();
  }

  function drawFlipper(flipper: Flipper) {
    const tip = flipperTip(flipper);
    ctx.lineCap = 'round';
    ctx.lineWidth = FLIPPER_RADIUS * 2;
    ctx.beginPath();
    ctx.moveTo(flipper.pivot.x, flipper.pivot.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  }

  function draw() {
    const styles = getComputedStyle(document.documentElement);
    const ink = styles.getPropertyValue('--ink').trim();
    const paper = styles.getPropertyValue('--paper').trim();
    const grey = styles.getPropertyValue('--grey').trim();

    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    ctx.strokeStyle = ink;
    ctx.lineWidth = WALL_THICKNESS;
    ctx.lineCap = 'round';
    for (const wall of walls) {
      ctx.beginPath();
      ctx.moveTo(wall.a.x, wall.a.y);
      ctx.lineTo(wall.b.x, wall.b.y);
      ctx.stroke();
    }

    // The respawn ring — where a lone ball reappears after a red bumper.
    ctx.strokeStyle = grey;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(respawn.x, respawn.y, respawn.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const now = performance.now();
    for (const bumper of bumpers) {
      const flashing = bumper.flashUntil > now;
      const kind = BUMPER_KINDS[bumper.type];
      ctx.fillStyle = flashing ? kind.colour : paper;
      ctx.strokeStyle = kind.colour;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(bumper.x, bumper.y, bumper.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.strokeStyle = ink;
    for (const flipper of flippers) drawFlipper(flipper);

    if (!gameOver) {
      ctx.fillStyle = ink;
      const ballsToDraw = launchReady ? [{ x: launchPad.x, y: launchPad.y }] : balls;
      for (const ball of ballsToDraw) {
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
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
  canvas.addEventListener('pointerdown', () => canvas.focus());
  window.addEventListener('pointerup', onPointerUp);
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
  generateBumpers();
  hud.setMessage('Press Space to start');
  hud.setScore(0);
  hud.setLives(LIVES_START);
  draw();
  animationFrame = requestAnimationFrame(tick);

  return {
    destroy() {
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('keyup', onKeyup);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      resizeObserver?.disconnect();
      if (animationFrame != null) cancelAnimationFrame(animationFrame);
    },
  };
}
