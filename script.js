/* ========== Setup ========== */
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false });

function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
addEventListener('resize', resize);
resize();

/* UI elements (grab these first before using their values) */
const gRange = document.getElementById('gRange');
const gValue = document.getElementById('gValue');
const timeRange = document.getElementById('timeRange');
const timeValue = document.getElementById('timeValue');
const countEl = document.getElementById('count');
const fpsEl = document.getElementById('fps');
const pauseBtn = document.getElementById('pauseBtn');
const clearBtn = document.getElementById('clearBtn');
const viewBtn = document.getElementById('viewBtn');
const toggleVel = document.getElementById('toggleVel');
const toggleProperties = document.getElementById('toggleProperties');
const toggleCoords = document.getElementById('toggleCoords');

/* Globals & parameters */
let G = parseFloat(gRange?.value ?? 2);       // gravitational constant (tunable)
let timeScale = parseFloat(timeRange?.value ?? 1);
const softening = 1.25; // softening distance to avoid singularities
const MAX_BODIES = 800; // safety cap
const MERGE_ON_COLLIDE = true;

let showVelocity = false;
let showProperties = false;
let showCoords = false; // <--- was missing
let paused = false;

/* World state */
let bodies = []; // each: {x,y,vx,vy,mass,r,color}
let camera = { x: 0, y: 0, zoom: 1 };
let keys = {};

/* Sync UI initial labels (so the displayed values match the sliders on load) */
if (gValue) gValue.textContent = G.toFixed(2);
if (timeValue) timeValue.textContent = timeScale.toFixed(2);

/* UI event wiring */
gRange.addEventListener('input', e => { G = parseFloat(e.target.value); gValue.textContent = G.toFixed(2); });
timeRange.addEventListener('input', e => { timeScale = parseFloat(e.target.value); timeValue.textContent = timeScale.toFixed(2); });
pauseBtn.addEventListener('click', _ => { paused = !paused; pauseBtn.textContent = paused ? 'Resume Sim (ESC)' : 'Pause Sim (ESC)'; });
clearBtn.addEventListener('click', _ => { bodies = []; });
viewBtn.addEventListener('click', _ => { camera.x = 0; camera.y = 0; camera.zoom = 1; });
toggleVel.addEventListener('click', _ => { showVelocity = !showVelocity; toggleVel.style.opacity = showVelocity ? '1' : '0.7'; });
toggleProperties.addEventListener('click', () => { showProperties = !showProperties; toggleProperties.style.opacity = showProperties ? '1' : '0.7'; });
toggleCoords.addEventListener('click', () => { showCoords = !showCoords; toggleCoords.style.opacity = showCoords ? '1' : '0.7'; });

/* Input: WASD camera movement */
addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    keys[k] = true;

    switch (k) {
        case 'escape':
            paused = !paused;
            pauseBtn.textContent = paused ? 'Resume Sim (ESC)' : 'Pause Sim (ESC)';
            break;
        case 'c':
            bodies = [];
            break;
        case 'r':
        case 'h':
            camera.x = 0;
            camera.y = 0;
            camera.zoom = 1;
            break;
        case 'i': // toggle velocity indicator
            showVelocity = !showVelocity;
            toggleVel.style.opacity = showVelocity ? '1' : '0.7';
            break;
        case 'p':
            showProperties = !showProperties;
            toggleProperties.style.opacity = showProperties ? '1' : '0.7';
            break;
        case 'o':
            showCoords = !showCoords;
            toggleCoords.style.opacity = showCoords ? '1' : '0.7';
            break;
    }
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

/* Mouse / Touch for charging body */
let isDown = false;
let downScreen = null;
let downWorld = null;
let nowScreen = null;
let chargeStart = 0;
let charging = null;
let activePointerId = null;

function screenToWorld(sx, sy) {
    return {
        x: camera.x + (sx - canvas.width / 2) / camera.zoom,
        y: camera.y + (sy - canvas.height / 2) / camera.zoom
    };
}

// Event handlers
canvas.addEventListener('pointerdown', (e) => {
    // only respond to primary button
    if (e.button !== 0) return;
    isDown = true;
    activePointerId = e.pointerId;
    downScreen = { x: e.clientX, y: e.clientY };
    nowScreen = { ...downScreen };
    downWorld = screenToWorld(e.clientX, e.clientY);
    chargeStart = performance.now();
    charging = 2;
    canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
    // update pointer only if it's the active pointer
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    nowScreen = { x: e.clientX, y: e.clientY };
    if (isDown) {
        const t = (performance.now() - chargeStart) / 1000;
        // growth curve for radius — tweak constants to taste
        charging = Math.min(160, 2 + Math.pow(t, 1.4) * 80);
    }
});

function cancelCharging() {
    if (!isDown) return;
    isDown = false;
    activePointerId = null;
    charging = null;
}

/* handle pointer cancel / out (touch interruptions etc) */
canvas.addEventListener('pointercancel', cancelCharging);
canvas.addEventListener('pointerout', (e) => {
    // pointerout may fire when pointer leaves canvas; keep charging but if pointer leaves with capture, it's OK.
});

/* Pointerup handler */
canvas.addEventListener('pointerup', (e) => {
    // ignore non-primary or other pointers
    if (e.button !== 0 || activePointerId !== e.pointerId) return;
    if (!isDown) return;
    isDown = false;
    activePointerId = null;
    canvas.releasePointerCapture(e.pointerId);

    const upScreen = { x: e.clientX, y: e.clientY };
    const upWorld = screenToWorld(upScreen.x, upScreen.y);

    // velocity from drag (release - press) in world units
    const dx = (upScreen.x - downScreen.x) / camera.zoom;
    const dy = (upScreen.y - downScreen.y) / camera.zoom;
    const dragFactor = 0.5; // tune how much velocity drag gives
    const vx = dx * dragFactor;
    const vy = dy * dragFactor;

    // radius determined by charging (or default small)
    const r = Math.max(1, charging || 2);
    const density = 0.01; // tune
    const mass = (4 / 3) * Math.PI * Math.pow(r, 3) * density;

    // spawn at the press location (downWorld) so charging is from the press center
    spawnBody(downWorld.x, downWorld.y, vx, vy, mass, r);
    charging = null;
});

/* zoom with wheel */
addEventListener('wheel', (e) => {
    const delta = Math.sign(e.deltaY);
    const oldZoom = camera.zoom;
    const zoomFactor = 1.08;
    let newZoom = camera.zoom * (delta > 0 ? 1 / zoomFactor : zoomFactor);
    newZoom = Math.max(0.12, Math.min(6, newZoom));
    const mx = e.clientX, my = e.clientY;
    const worldBefore = screenToWorld(mx, my);
    camera.zoom = newZoom;
    const worldAfter = screenToWorld(mx, my);
    camera.x += worldBefore.x - worldAfter.x;
    camera.y += worldBefore.y - worldAfter.y;
    e.preventDefault();
}, { passive: false });

/* spawn helper */
function spawnBody(x, y, vx, vy, mass, r) {
    if (bodies.length >= MAX_BODIES) return;
    const massLog = Math.log10(mass + 1);
    const hue = 200 - Math.min(160, massLog * 14);
    const color = `hsl(${hue}deg 85% ${Math.max(35, 60 - massLog * 4)}%)`;
    bodies.push({ x, y, vx, vy, mass, r, color });
}

/* ========== Physics ========== */
function stepPhysics(dt) {
    dt *= timeScale;
    const n = bodies.length;
    if (n === 0) return;

    const ax = new Float64Array(n), ay = new Float64Array(n);

    for (let i = 0; i < n; i++) {
        const bi = bodies[i];
        for (let j = i + 1; j < n; j++) {
            const bj = bodies[j];
            let dx = bj.x - bi.x;
            let dy = bj.y - bi.y;
            let r2 = dx * dx + dy * dy + softening * softening;
            let dist = Math.sqrt(r2);
            // gravitational force magnitude
            const force = G * bi.mass * bj.mass / r2;
            // acceleration components (F/m)
            const ax_i = force * dx / (dist * bi.mass);
            const ay_i = force * dy / (dist * bi.mass);
            const ax_j = -force * dx / (dist * bj.mass);
            const ay_j = -force * dy / (dist * bj.mass);

            ax[i] += ax_i; ay[i] += ay_i;
            ax[j] += ax_j; ay[j] += ay_j;
        }
    }

    for (let i = 0; i < n; i++) {
        const b = bodies[i];
        b.vx += ax[i] * dt;
        b.vy += ay[i] * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
    }

    if (MERGE_ON_COLLIDE && bodies.length > 1) {
        for (let i = 0; i < bodies.length; i++) {
            const A = bodies[i];
            if (!A) continue;
            for (let j = i + 1; j < bodies.length; j++) {
                const B = bodies[j];
                if (!B) continue;
                const dx = B.x - A.x;
                const dy = B.y - A.y;
                const d2 = dx * dx + dy * dy;
                const rsum = A.r + B.r;
                if (d2 <= rsum * rsum) {
                    const newMass = A.mass + B.mass;
                    const nx = (A.x * A.mass + B.x * B.mass) / newMass;
                    const ny = (A.y * A.mass + B.y * B.mass) / newMass;
                    const nvx = (A.vx * A.mass + B.vx * B.mass) / newMass;
                    const nvy = (A.vy * A.mass + B.vy * B.mass) / newMass;
                    const newR = Math.sqrt((A.r * A.r + B.r * B.r));
                    const newColor = A.mass > B.mass ? A.color : B.color;
                    bodies[i] = { x: nx, y: ny, vx: nvx, vy: nvy, mass: newMass, r: newR, color: newColor };
                    bodies.splice(j, 1);
                    j--;
                }
            }
        }
    }
}

/* ========== Rendering ========== */
function clearCanvas() {
    ctx.fillStyle = '#071421';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const g = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 100, canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height));
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function worldToScreen(x, y) {
    return { x: canvas.width / 2 + (x - camera.x) * camera.zoom, y: canvas.height / 2 + (y - camera.y) * camera.zoom };
}

function drawBody(b) {
    const s = worldToScreen(b.x, b.y);
    const sr = Math.max(1, b.r * camera.zoom);

    const grad = ctx.createRadialGradient(s.x, s.y, sr * 0.2, s.x, s.y, sr * 3);
    grad.addColorStop(0, hslToRGBA(b.color, 0.95));
    grad.addColorStop(0.2, hslToRGBA(b.color, 0.6));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, sr * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // core
    ctx.beginPath();
    ctx.fillStyle = b.color;
    ctx.arc(s.x, s.y, sr, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = Math.max(1, Math.min(3, sr * 0.08));
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.stroke();

    if (showVelocity) {
        const vx = b.vx * camera.zoom;
        const vy = b.vy * camera.zoom;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + vx * 0.6, s.y + vy * 0.6);
        ctx.strokeStyle = 'rgba(190,255,255,0.6)';
        ctx.lineWidth = 5;
        ctx.stroke();
    }
    if (showProperties) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.max(10, Math.min(14, b.r * camera.zoom))}px Inter, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const velMag = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        const displayMass = (b.mass / 1000).toFixed(1);
        const displayVel = velMag.toFixed(1);
        const displayRad = (b.r / 10).toFixed(1);
        const propText = `m:${displayMass} MT  v:${displayVel} km/s  r:${displayRad} km`;

        const padding = 4;
        const textY = s.y + sr + padding;
        ctx.fillText(propText, s.x, textY);

        // Add extra vertical spacing so coordinate text doesn't overlap
        textOffsetY = 5 * (ctx.measureText(propText).actualBoundingBoxAscent + padding);
    }

    if (showCoords) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.max(10, Math.min(14, b.r * camera.zoom))}px Inter, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const coordText = `x:${b.x.toFixed(0)} y:${-(b.y.toFixed(0))}`;
        const padding = 4;
        let textY;

        if (showProperties) {
            textY = s.y + sr + padding + textOffsetY; // below property text
        } else {
            textY = s.y + sr + padding; // just below the circle
        }

        ctx.fillText(coordText, s.x, textY);
    }
}

/* simple HSL extraction to rgba */
function hslToRGBA(hslString, alpha) {
    const match = /hsl\(([-\d.]+)deg\s+(\d+)%\s+(\d+)%\)/.exec(hslString);
    if (!match) return 'rgba(255,255,255,' + alpha + ')';
    const h = ((parseFloat(match[1]) % 360) + 360) % 360 / 360;
    const s = parseFloat(match[2]) / 100;
    const l = parseFloat(match[3]) / 100;
    const rgb = hslToRgb(h, s, l);
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}
function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) r = g = b = Math.round(l * 255);
    else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = Math.round(255 * hue2rgb(p, q, h + 1 / 3));
        g = Math.round(255 * hue2rgb(p, q, h));
        b = Math.round(255 * hue2rgb(p, q, h - 1 / 3));
    }
    return [r, g, b];
}
function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}

/* ========== Animation loop ========== */
let last = performance.now();
let fpsCounter = { lastTick: performance.now(), frames: 0, fps: 0 };

function update() {
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;

    // FPS
    fpsCounter.frames++;
    if (now - fpsCounter.lastTick >= 500) {
        fpsCounter.fps = Math.round(fpsCounter.frames * 1000 / (now - fpsCounter.lastTick));
        fpsCounter.lastTick = now;
        fpsCounter.frames = 0;
        fpsEl.textContent = fpsCounter.fps;
    }

    // camera movement
    const camSpeed = 480 / Math.sqrt(camera.zoom);
    let mvx = 0, mvy = 0;
    if (keys['w'] || keys['arrowup']) mvy -= 1;
    if (keys['s'] || keys['arrowdown']) mvy += 1;
    if (keys['a'] || keys['arrowleft']) mvx -= 1;
    if (keys['d'] || keys['arrowright']) mvx += 1;
    if (mvx !== 0 || mvy !== 0) {
        const len = Math.hypot(mvx, mvy) || 1;
        camera.x += (mvx / len) * camSpeed * dt;
        camera.y += (mvy / len) * camSpeed * dt;
    }

    if (!paused) {
        const steps = Math.max(2, Math.min(8, Math.ceil(timeScale * 2)));
        const subDt = dt / steps;
        for (let s = 0; s < steps; s++) stepPhysics(subDt);
    }

    clearCanvas();
    drawGrid();

    bodies.sort((a, b) => a.r - b.r);
    for (let b of bodies) drawBody(b);

    // charging preview
    if (charging && downWorld) {
        const pos = worldToScreen(downWorld.x, downWorld.y);
        const sr = Math.max(1, charging * camera.zoom);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, sr, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(126,225,255,0.9)';
        ctx.stroke();
        ctx.fillStyle = 'rgba(126,225,255,0.06)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(190,255,255,0.8)';
        ctx.font = '12px Inter, system-ui, -apple-system';
        ctx.fillText(`r ${(charging | 0)}`, pos.x + sr + 8, pos.y + 6);
    }

    countEl.textContent = bodies.length;
    requestAnimationFrame(update);
}

/* grid drawing */
function drawGrid() {
    const step = 50;
    const left = camera.x - (canvas.width / 2) / camera.zoom;
    const right = camera.x + (canvas.width / 2) / camera.zoom;
    const top = camera.y - (canvas.height / 2) / camera.zoom;
    const bottom = camera.y + (canvas.height / 2) / camera.zoom;

    const startX = Math.floor(left / step) * step;
    const startY = Math.floor(top / step) * step;

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.beginPath();
    for (let x = startX; x <= right; x += step) {
        const s = worldToScreen(x, camera.y);
        ctx.moveTo(s.x, 0);
        ctx.lineTo(s.x, canvas.height);
    }
    for (let y = startY; y <= bottom; y += step) {
        const s = worldToScreen(camera.x, y);
        ctx.moveTo(0, s.y);
        ctx.lineTo(canvas.width, s.y);
    }
    ctx.stroke();

    const c = worldToScreen(0, 0);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(126,225,255,0.06)';
    ctx.lineWidth = 1.4;
    ctx.moveTo(c.x, 0); ctx.lineTo(c.x, canvas.height);
    ctx.moveTo(0, c.y); ctx.lineTo(canvas.width, c.y);
    ctx.stroke();
}

/* initial scene */
function initScene() {
    bodies = [];
    spawnBody(-150, 0, 10, -2.5, 1000, 24);
    spawnBody(150, 0, -10, 2.5, 1000, 24);
    spawnBody(0, -150, 2.5, 10, 1000, 24);
    spawnBody(0, 150, -2.5, -10, 1000, 24);
}
initScene();
requestAnimationFrame(update);
