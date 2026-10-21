/* ============================================================
   F-100 v3 — TRIP VIEW

   The deck has no map data.  This view draws only what the game publishes:

     · the compass reads the heading field
     · the canvas plots the x/y readback as a session trace
     · the numbers come from /api/trip/, which integrates those points

   Nothing here invents a road.  If the game stops publishing a position the
   last trace stays on screen, greyed, and the mode label says NO FIX.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_SPAN_M = 600;
const KM_PER_MI = 1.609344;
const L_PER_GAL = 3.785411784;

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function cardinal(degrees) {
  if (degrees == null) return '';
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

function clock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(mins).padStart(2, '0')}:${secs}` : `${mins}:${secs}`;
}

/** A "nice" grid step (1, 2, 5 × 10ⁿ) at or above `raw` metres. */
function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const factor of [1, 2, 5, 10]) {
    if (factor * power >= raw) return factor * power;
  }
  return 10 * power;
}

export class TripView {
  constructor(host, { onReset } = {}) {
    this.host = host;
    this.canvas = $('tripCanvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.onReset = onReset;
    this.trace = [];
    this.signature = '';
    this.empty = $('tripTraceEmpty');
    this.last = null;

    this._buildCompass();
    this._buildTape();
    this._bindResize();
    this._bindReset();
  }

  /* ---------------------------------------------------------- compass */

  _buildCompass() {
    const ticks = $('tripCompassTicks');
    if (!ticks) return;
    for (let angle = 0; angle < 360; angle += 10) {
      const major = angle % 90 === 0;
      const outer = 80;
      const inner = major ? 70 : 75;
      const rad = ((angle - 90) * Math.PI) / 180;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', (100 + Math.cos(rad) * outer).toFixed(2));
      line.setAttribute('y1', (100 + Math.sin(rad) * outer).toFixed(2));
      line.setAttribute('x2', (100 + Math.cos(rad) * inner).toFixed(2));
      line.setAttribute('y2', (100 + Math.sin(rad) * inner).toFixed(2));
      if (major) line.setAttribute('class', 'major');
      ticks.appendChild(line);
    }
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([label, angle]) => {
      const rad = ((angle - 90) * Math.PI) / 180;
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', (100 + Math.cos(rad) * 60).toFixed(2));
      text.setAttribute('y', (100 + Math.sin(rad) * 60).toFixed(2));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = label;
      ticks.appendChild(text);
    });
  }

  /* ------------------------------------------------------------- tape */

  _buildTape() {
    const track = $('tripTapeTrack');
    if (!track) return;
    const letters = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let heading = -360; heading <= 720; heading += 10) {
      const item = document.createElement('div');
      item.className = 'trip-tape-item';
      if (heading % 30 === 0) {
        item.classList.add('major');
        const label = document.createElement('span');
        const normalised = ((heading % 360) + 360) % 360;
        label.textContent = letters[normalised] ?? String(normalised).padStart(3, '0');
        item.appendChild(label);
      }
      track.appendChild(item);
    }
    this.tapeTrack = track;
    // Heading 0 is item 36 in the three-cycle strip.
    this.tapeOrigin = 36 * 22;
  }

  _paintTape(heading) {
    const window = $('tripTapeWindow');
    if (!this.tapeTrack) return;
    const normalised = heading == null ? 0 : ((heading % 360) + 360) % 360;
    this.tapeTrack.style.transform =
      `translateY(${-(this.tapeOrigin + (normalised / 10) * 22).toFixed(1)}px)`;
    if (window) window.classList.toggle('is-idle', heading == null);
  }

  /* ------------------------------------------------------------ trace */

  _bindResize() {
    if (!this.canvas) return;
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => {
        this.signature = '';
        this.redraw();
      });
      this.resizeObserver.observe(this.canvas);
    } else {
      window.addEventListener('resize', () => {
        this.signature = '';
        this.redraw();
      });
    }
  }

  _bindReset() {
    const button = $('tripReset');
    if (!button || !this.onReset) return;
    button.addEventListener('click', async () => {
      button.classList.add('is-done');
      try {
        await this.onReset();
      } finally {
        setTimeout(() => button.classList.remove('is-done'), 900);
      }
    });
  }

  /* ------------------------------------------------------------ paint */

  update(trip, units, heading) {
    if (!trip) return;
    this.last = { trip, units };
    this.heading = heading == null ? null : heading;
    this.trace = Array.isArray(trip.trace) ? trip.trace : [];
    const imperial = units === 'imperial';

    const needle = $('tripCompassNeedle');
    if (needle) {
      needle.setAttribute('transform', `rotate(${heading == null ? 0 : -heading} 100 100)`);
    }
    setText('tripHeading', heading == null ? '—' : `${Math.round(heading)}°`);
    setText('tripCardinal', heading == null ? 'NO FIX' : cardinal(heading));
    setText('tripHeadingNote', heading == null ? 'not published' : 'live readback');
    this._paintTape(heading);

    const samples = Number(trip.samples) || 0;
    const hasDistance = samples > 0;
    const km = Number(trip.distance_km) || 0;
    const distance = imperial ? km / KM_PER_MI : km;
    setText('tripDistance', hasDistance ? distance.toFixed(distance >= 100 ? 0 : 1) : '—');
    setText('tripDistanceUnit', imperial ? 'GAME MI' : 'GAME KM');
    setText('tripDistanceNote', `WORLD M × ${trip.game_scale || 19}`);

    const last = this.trace.length ? this.trace[this.trace.length - 1] : null;
    setText('tripWorldX', last ? Math.round(last[0]).toLocaleString() : '—');
    setText('tripWorldY', last ? Math.round(last[1]).toLocaleString() : '—');
    setText('tripSegments', String(trip.segments || 1));

    const speed = (value) => {
      if (value == null) return '—';
      return `${Math.round(imperial ? value / KM_PER_MI : value)} ${imperial ? 'MPH' : 'KM/H'}`;
    };
    setText('tripAvg', speed(trip.avg_kmh));
    setText('tripMax', speed(trip.max_kmh));
    setText('tripDriving', trip.driving_s == null ? '—' : clock(trip.driving_s));
    setText('tripElapsed', clock(trip.elapsed_s));

    const used = trip.fuel_used_l;
    setText('tripFuel', used == null
      ? '—'
      : (imperial ? `${(used / L_PER_GAL).toFixed(1)} GAL` : `${used.toFixed(1)} L`));

    const economy = trip.economy_l_100km;
    setText('tripEconomy', economy == null
      ? '—'
      : (imperial ? `${(235.215 / economy).toFixed(1)} MPG` : `${economy.toFixed(1)} L/100`));
    const economyNode = $('tripEconomy');
    if (economyNode) economyNode.dataset.state = economy != null && economy > 55 ? 'warn' : '';

    // A parked truck keeps publishing one position, so "recording" must wait
    // for actual movement rather than for a sample count.
    const moved = Number(trip.distance_m) > 1;
    const mode = $('tripTraceMode');
    if (mode) {
      mode.textContent = !trip.active
        ? (samples ? 'NO FIX' : 'IDLE')
        : (moved ? 'RECORDING' : 'PARKED');
      mode.dataset.state = trip.active ? (moved ? 'ok' : 'warn') : '';
    }
    setText('tripTracePoints', `${this.trace.length} PTS · ${samples} SMP`);

    const emptyTitle = $('tripEmptyTitle');
    const emptyDetail = $('tripEmptyDetail');
    if (emptyTitle && emptyDetail) {
      if (!samples) {
        emptyTitle.textContent = 'Waiting for a position';
        emptyDetail.textContent = 'The deck plots the points the game publishes — no map file is read.';
      } else {
        emptyTitle.textContent = 'Parked — no trace yet';
        emptyDetail.textContent = 'The meter is sampling the readback. A few metres of movement will draw the line.';
      }
    }

    this._draw();
  }

  /* ------------------------------------------------------------ canvas */

  _draw() {
    if (!this.ctx) return;
    const signature = [
      this.trace.length,
      this.trace.length ? this.trace[this.trace.length - 1].join(',') : '',
      this.canvas.width, this.canvas.height,
      this.heading == null ? '' : Math.round(this.heading),
    ].join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.redraw();
  }

  redraw() {
    if (!this.ctx || !this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const points = this.trace;
    const empty = $('tripTraceEmpty');
    if (empty) empty.hidden = points.length > 1;
    if (points.length < 2) {
      setText('tripTraceScale', 'SCALE —');
      if (points.length === 1) this._drawHead(ctx, width / 2, height / 2, width, height);
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const span = Math.max(spanX, spanY, MIN_SPAN_M);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const pad = 18;
    const scale = Math.min(width - pad * 2, height - pad * 2) / span;
    const toX = (x) => width / 2 + (x - cx) * scale;
    const toY = (y) => height / 2 + (y - cy) * scale;

    const step = niceStep(span / 5);
    const left = cx - (width / 2 - pad) / scale;
    const right = cx + (width / 2 - pad) / scale;
    const top = cy - (height / 2 - pad) / scale;
    const bottom = cy + (height / 2 - pad) / scale;

    ctx.save();
    ctx.strokeStyle = 'rgba(78,163,224,.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      ctx.moveTo(toX(x), 0);
      ctx.lineTo(toX(x), height);
    }
    for (let y = Math.ceil(top / step) * step; y <= bottom; y += step) {
      ctx.moveTo(0, toY(y));
      ctx.lineTo(width, toY(y));
    }
    ctx.stroke();
    ctx.restore();

    // Path, north-up: world +y is south, which is +y on the canvas.
    ctx.save();
    ctx.strokeStyle = 'rgba(78,163,224,.95)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(78,163,224,.8)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(toX(points[0][0]), toY(points[0][1]));
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(toX(points[i][0]), toY(points[i][1]));
    }
    ctx.stroke();
    ctx.restore();

    // Start ring.
    const [sx, sy] = points[0];
    ctx.save();
    ctx.strokeStyle = 'rgba(141,150,159,.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(toX(sx), toY(sy), 3.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const [hx, hy] = points[points.length - 1];
    this._drawHead(ctx, toX(hx), toY(hy), width, height);

    const metric = this.last && this.last.units !== 'imperial';
    const scaleText = metric
      ? (step >= 1000 ? `${(step / 1000).toFixed(0)} KM` : `${Math.round(step)} M`)
      : (step >= 1609.344 ? `${(step / 1609.344).toFixed(0)} MI` : `${Math.round(step / 0.3048)} FT`);
    setText('tripTraceScale', `GRID ${scaleText}`);
  }

  _drawHead(ctx, x, y, width, height) {
    if (x == null) return;
    const clampedX = Math.max(10, Math.min(width - 10, x));
    const clampedY = Math.max(10, Math.min(height - 10, y));
    ctx.save();
    ctx.fillStyle = '#7dc7f5';
    ctx.shadowColor = 'rgba(78,163,224,1)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(clampedX, clampedY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#06121a';
    ctx.beginPath();
    ctx.arc(clampedX, clampedY, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
