/* ============================================================
   F-100 v3 — DECK CONTROLLER

   One page, three bays.  This file owns the wiring between them:

     · builds the HD·Controls rack and binds each switch to the SCS action
     · paints the cluster and Vehicle screen from /api/telemetry/
     · mirrors the OS media session on the Media screen
     · swaps MFD views in place and keeps their URLs honest
     · feeds the Trip view from /api/trip/ (dead reckoning, no map data)

   The design engine (hd-engine.js) and its stylesheet are the reference
   implementation; nothing here re-implements a control.
   ============================================================ */

import HDEngine from './hd-engine.js';
import { TripView } from './trip.js';

const boot = JSON.parse(document.getElementById('deck-boot').textContent || '{}');
const api = boot.api || {};

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'f100.v3.prefs';

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch { return {}; }
}

const stored = readPrefs();
const prefs = {
  // Units follow the app's own default until the user picks one; after that
  // the choice is the deck's, across both simulators.
  units: stored.units || boot.units || 'metric',
  unitsSet: typeof stored.units === 'string',
};

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ units: prefs.units }));
  } catch { /* storage unavailable */ }
}

const state = {
  telemetry: null,
  controls: null,
  media: null,
  health: null,
  trip: null,
  activeView: boot.screen || 'media',
};

/* ------------------------------------------------------------
   small helpers
   ------------------------------------------------------------ */

function toast(message, kind = '') {
  const host = $('deckToast');
  if (!host) return;
  host.textContent = message;
  host.dataset.state = kind;
  host.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => host.classList.remove('is-on'), 2800);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setData(id, name, value) {
  const el = $(id);
  if (el) el.dataset[name] = value;
}

const dash = (value, digits = 0) => (value == null || Number.isNaN(value)
  ? '—'
  : Number(value).toFixed(digits));

const unitLabel = () => (prefs.units === 'imperial' ? 'MPH' : 'KM/H');
const speedOf = (truck) => (prefs.units === 'imperial' ? truck.speedMph : truck.speedKmh);
// The dial is labelled 0–10 ×10 in both finishes: 100 mph or 100 km/h.
const gaugeMax = () => 100;

function timecode(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

async function getJSON(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function postJSON(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

/** Run `fn` every `ms`, never stacking calls, and pause when the tab is hidden. */
function every(fn, ms) {
  let busy = false;
  const run = async () => {
    if (busy || document.hidden) return;
    busy = true;
    try { await fn(); } catch { /* each poller reports its own failures */ }
    finally { busy = false; }
  };
  run();
  return setInterval(run, ms);
}

/* ------------------------------------------------------------
   clock
   ------------------------------------------------------------ */

function tickClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const text = `${hh}:${mm}`;
  setText('railClock', text);
  setText('infoClock', text);
}
tickClock();
setInterval(tickClock, 1000);

/* ------------------------------------------------------------
   cluster gauge
   ------------------------------------------------------------ */

const gauge = {
  needle: $('gaugeNeedle'),
  angle: -120,
  selfTest: null,
};

(function buildGauge() {
  const ticks = $('gaugeTicks');
  const minor = $('gaugeMinor');
  if (!ticks || !minor) return;
  const CX = 100, CY = 100;
  const R_OUT = 82, R_IN_MAJOR = 68, R_IN_MINOR = 74;
  const NS = 'http://www.w3.org/2000/svg';

  const line = (x1, y1, x2, y2, stroke, width) => {
    const node = document.createElementNS(NS, 'line');
    node.setAttribute('x1', x1.toFixed(2));
    node.setAttribute('y1', y1.toFixed(2));
    node.setAttribute('x2', x2.toFixed(2));
    node.setAttribute('y2', y2.toFixed(2));
    node.setAttribute('stroke', stroke);
    node.setAttribute('stroke-width', width);
    node.setAttribute('stroke-linecap', 'round');
    return node;
  };

  for (let angle = -120; angle <= 120; angle += 6) {
    const rad = ((angle - 90) * Math.PI) / 180;
    minor.appendChild(line(
      CX + Math.cos(rad) * R_OUT, CY + Math.sin(rad) * R_OUT,
      CX + Math.cos(rad) * R_IN_MINOR, CY + Math.sin(rad) * R_IN_MINOR,
      '#2c3238', '1'));
  }

  for (let i = 0; i <= 10; i++) {
    const angle = -120 + (240 * i) / 10;
    const rad = ((angle - 90) * Math.PI) / 180;
    ticks.appendChild(line(
      CX + Math.cos(rad) * R_OUT, CY + Math.sin(rad) * R_OUT,
      CX + Math.cos(rad) * R_IN_MAJOR, CY + Math.sin(rad) * R_IN_MAJOR,
      '#5a636c', '1.6'));
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', (CX + Math.cos(rad) * 56).toFixed(2));
    text.setAttribute('y', (CY + Math.sin(rad) * 56).toFixed(2));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-size', '8');
    text.setAttribute('font-family', 'ui-monospace, monospace');
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', '#4d555d');
    text.textContent = String(i);
    ticks.appendChild(text);
  }
})();

function setNeedle(pct) {
  const clamped = Math.max(0, Math.min(1, pct));
  gauge.angle = -120 + 240 * clamped;
  if (gauge.needle) {
    gauge.needle.setAttribute('transform', `rotate(${gauge.angle.toFixed(2)} 100 100)`);
  }
}

function runSelfTest() {
  const started = performance.now();
  const duration = 1500;
  gauge.selfTest = true;
  const step = (now) => {
    const t = (now - started) / duration;
    if (t >= 1) {
      gauge.selfTest = false;
      paintSpeed();
      return;
    }
    const p = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5;
    setNeedle(p);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function paintSpeed() {
  if (gauge.selfTest) return;
  const truck = state.telemetry && state.telemetry.truck;
  const speed = truck ? speedOf(truck) : null;
  setNeedle(speed == null ? 0 : speed / gaugeMax());
  const label = document.querySelector('.bay--cluster .gauge-label');
  if (label) label.textContent = `SPEED × 10 ${unitLabel()}`;
}

/* ------------------------------------------------------------
   control rack
   ------------------------------------------------------------ */

const rack = $('rack');
const ctl = {};
let retarderPrev = 0;
let lastAction = '';

function make(name, config) {
  ctl[name] = HDEngine.create(rack, Object.assign({ size: 100 }, config));
  return ctl[name];
}

function flashRack(message, kind = 'ok') {
  lastAction = message;
  flashRack.at = Date.now();
  const el = $('rackText');
  if (el) el.textContent = message;
  if (kind === 'fault') toast(message, 'fault');
  clearTimeout(flashRack.timer);
  flashRack.timer = setTimeout(() => paintControlState(state.controls), 2400);
}

async function sendControl(action, pressed = true) {
  try {
    const body = await postJSON(`${api.controls}${action}`, { pressed });
    if (body && body.ok === false) {
      flashRack(`${action.replace(/_/g, ' ').toUpperCase()} · ${body.error || 'refused'}`, 'fault');
      return;
    }
    flashRack(`${pressed ? '' : 'RELEASE · '}${action.replace(/_/g, ' ').toUpperCase()}`);
  } catch (error) {
    flashRack(`${action.replace(/_/g, ' ').toUpperCase()} · ${error.message}`, 'fault');
  }
}

function buildRack() {
  if (!rack) return;

  make('estop', {
    type: 'push', variant: 'mushroom', accent: '#e0453a',
    label: 'E-STOP', sub: 'HAZARD', latch: true,
    // The hazard readback is not published, so both the press and the reset
    // toggle the hazard: the latch's physical state and the truck stay in step.
    onChange: () => sendControl('blinker_hazard'),
  });
  make('lightKey', {
    type: 'key', accent: '#e2a03c', label: 'LIGHT KEY', sub: 'CYCLE',
    onChange: () => sendControl('light_mode'),
  });
  make('engineBrake', {
    type: 'rocker', accent: '#e2a03c', label: 'ENGINE BRAKE', sub: 'ON / OFF',
    onChange: () => sendControl('engine_brake_toggle'),
  });
  make('retarder', {
    type: 'rotary', variant: 'led', accent: '#4ea3e0', label: 'RETARDER',
    sub: 'LV 0', detents: 3, ticks: 3,
    onChange: (value) => {
      const action = value > retarderPrev ? 'retarder_up' : 'retarder_down';
      retarderPrev = value;
      sendControl(action);
    },
  });
  make('lift', {
    type: 'toggle', accent: '#3fbf6a', label: 'LIFT AXLE', sub: 'TRACTOR',
    onChange: () => sendControl('truck_lift_axle'),
  });
  make('high', {
    type: 'toggle', accent: '#e2a03c', label: 'HIGH BEAM', sub: 'ON / OFF',
    onChange: () => sendControl('high_beam'),
  });
  make('parking', {
    type: 'toggle', accent: '#4ea3e0', label: 'PARKING', sub: 'LIGHTS',
    onChange: () => sendControl('parking_lights'),
  });
  make('lane', {
    type: 'push', variant: 'square', accent: '#3fbf6a', label: 'LANE ASSIST', sub: 'PULSE',
  });
  make('laneMode', {
    type: 'push', variant: 'square', accent: '#3fbf6a', label: 'LANE MODE', sub: 'PULSE',
  });
  make('cruise', {
    type: 'toggle', accent: '#4ea3e0', label: 'CRUISE', sub: 'ON / OFF',
    onChange: () => sendControl('cruise_control'),
  });
  make('cruiseUp', {
    type: 'push', variant: 'square', accent: '#4ea3e0', label: 'CRUISE +', sub: 'SET',
  });
  make('cruiseDown', {
    type: 'push', variant: 'square', accent: '#4ea3e0', label: 'CRUISE −', sub: 'SET',
  });
  make('suspUp', {
    type: 'push', variant: 'square', accent: '#8d969f', label: 'SUSP ↑', sub: 'HOLD',
  });
  make('suspDown', {
    type: 'push', variant: 'square', accent: '#8d969f', label: 'SUSP ↓', sub: 'HOLD',
  });
  make('beacon', {
    type: 'lamp', accent: '#e2a03c', label: 'BEACON', sub: 'READBACK',
  });

  const pulse = (name, action) => ctl[name].el.addEventListener('press', () => sendControl(action));
  pulse('lane', 'lane_assist');
  pulse('laneMode', 'lane_assist_mode');
  pulse('cruiseUp', 'cruise_increase');
  pulse('cruiseDown', 'cruise_decrease');

  const hold = (name, action) => {
    const host = ctl[name].el;
    host.addEventListener('press', () => sendControl(action, true));
    host.addEventListener('release', () => sendControl(action, false));
  };
  hold('suspUp', 'front_suspension_up');
  hold('suspDown', 'front_suspension_down');
}
buildRack();

/* ------------------------------------------------------------
   writing the panels
   ------------------------------------------------------------ */

function paintControlState(controls) {
  const ready = controls && controls.available;
  const gameActive = controls && controls.game_active;
  const el = $('rackText');
  const led = $('rackLed');
  if (el) {
    if (lastAction && Date.now() - (flashRack.at || 0) < 2400) {
      // keep the flash
    } else if (ready) {
      el.textContent = 'SCS INPUT · READY';
    } else if (gameActive) {
      el.textContent = 'SCS INPUT · ACTIVATE CONTROLS DEVICE';
    } else {
      el.textContent = 'SCS INPUT · NO GAME';
    }
  }
  if (led) {
    if (ready) led.setAttribute('data-on', '');
    else led.removeAttribute('data-on');
  }
  setText('rackPending', controls && controls.pending ? `${controls.pending} QUEUED` : '');
  setText('dockControls', ready ? 'CONTROLS READY' : (gameActive ? 'CONTROLS NOT BOUND' : 'CONTROLS —'));
}

function paintReadouts(data) {
  const game = data.game || {};
  const truck = data.truck || {};
  const controls = state.controls || {};

  const mode = !game.connected
    ? (game.status === 'no plugin' ? 'NO PLUGIN' : 'OFFLINE')
    : (game.active ? 'LIVE' : 'PAUSED');
  const modeEl = $('roMode');
  if (modeEl) {
    modeEl.textContent = mode;
    modeEl.dataset.state = game.connected ? (game.partial ? 'warn' : 'ok') : 'fault';
  }

  const speed = speedOf(truck);
  setText('roSpeed', speed == null ? '—' : `${Math.round(speed)} ${unitLabel()}`);
  setText('roRpm', truck.rpm == null ? '—' : Math.round(truck.rpm));
  setText('roTemp', truck.coolant == null ? '—' : `${Math.round(truck.coolant)}°C`);

  const arm = $('slArm');
  const run = $('slRun');
  const fault = $('slFault');
  if (arm) {
    if (controls.available) arm.setAttribute('data-on', 'arm');
    else arm.removeAttribute('data-on');
  }
  if (run) {
    if (game.connected && game.active) run.setAttribute('data-on', 'run');
    else run.removeAttribute('data-on');
  }
  if (fault) {
    if (game.error || game.partial) fault.setAttribute('data-on', 'fault');
    else fault.removeAttribute('data-on');
  }

  setText('clusterMeta', `${game.name || boot.short} / ${String(game.status || 'waiting').toUpperCase()}`);
  setText('clusterUnits', prefs.units.toUpperCase());
  setText('stUnits', prefs.units.toUpperCase());

  const led = $('statusLed');
  if (led) {
    if (controls.available) led.setAttribute('data-on', '');
    else led.removeAttribute('data-on');
  }
  setText('statusText', controls.available
    ? 'SYSTEM ARMED'
    : (game.connected ? (game.active ? 'LINKED · GAME PAUSED' : 'LINKED · GAME IDLE') : 'SYSTEM READY'));

  setText('deckFootStatus', controls.available
    ? 'CONTROLS READY'
    : (game.connected ? 'CONTROLS NOT BOUND' : 'WAITING FOR GAME'));

  paintSpeed();
  paintVehicle(truck);
  paintClusterDisplays(truck, game);
}

function paintClusterDisplays(truck, game) {
  if (!clusterDisplays.speed) return;
  const speed = speedOf(truck);
  clusterDisplays.speed.setDisplay(speed == null ? '---' : String(Math.round(speed)).padStart(3, '0'));
  clusterDisplays.fuel.setDisplay(truck.fuelPercent == null ? 0 : truck.fuelPercent / 100);
  clusterDisplays.gear.setDisplay(truck.gearLabel || (game.connected ? 'N' : '—'));
  clusterDisplays.speed.subEl.textContent = unitLabel();
  clusterDisplays.fuel.subEl.textContent = truck.fuelPercent == null ? '%' : `${Math.round(truck.fuelPercent)}%`;
}

function yesNo(value) {
  if (value == null) return '—';
  return value ? 'ON' : 'OFF';
}

/* digital readouts in the cluster, using the engine's own display types */
const clusterDisplays = {};

function buildClusterDisplays() {
  const host = $('clusterDisplays');
  if (!host) return;
  clusterDisplays.speed = HDEngine.create(host, {
    type: 'display', variant: 'sevenseg', size: 66, digits: 3,
    accent: '#e2a03c', label: 'SPEED', sub: unitLabel(),
  });
  clusterDisplays.fuel = HDEngine.create(host, {
    type: 'display', variant: 'bargraph', size: 66, segments: 12,
    accent: '#3fbf6a', label: 'FUEL', sub: '%',
  });
  clusterDisplays.gear = HDEngine.create(host, {
    type: 'display', variant: 'lcd', size: 66,
    accent: '#3fbf6a', label: 'GEAR', sub: 'RANGE',
  });
}
buildClusterDisplays();

function paintVehicle(truck) {
  const speed = speedOf(truck);
  setText('viSpeed', speed == null ? '—' : String(Math.round(speed)));
  setText('viSpeedUnit', unitLabel());
  setText('viRpm', truck.rpm == null ? '—' : String(Math.round(truck.rpm)));
  setText('viTemp', truck.coolant == null ? '—' : dash(truck.coolant));
  setText('viOil', truck.oil == null ? '—' : dash(truck.oil, 1));
  setText('viBattery', truck.battery == null ? '—' : dash(truck.battery, 1));
  setText('viFuel', truck.fuelPercent == null ? '—' : String(Math.round(truck.fuelPercent)));
  setText('viFuelUnit', '%');
  const fuelValue = $('viFuel');
  if (fuelValue) {
    fuelValue.title = (truck.fuel == null || truck.fuelCapacity == null)
      ? 'fuel not published'
      : `${Math.round(truck.fuel)} L of ${Math.round(truck.fuelCapacity)} L`;
  }

  const fuelBar = $('viFuelBar');
  if (fuelBar) {
    const pct = truck.fuelPercent == null ? 0 : truck.fuelPercent;
    fuelBar.style.width = `${pct}%`;
    fuelBar.className = `vi-bar-fill ${pct < 15 ? 'amber' : 'green'}`;
  }

  const temp = $('viTemp');
  if (temp) {
    temp.className = 'vi-value' + (truck.coolant > 100 ? ' fault' : (truck.coolant > 92 ? ' warn' : ''));
  }

  setText('viGear', truck.gearLabel || '—');
  setText('viBrake', yesNo(truck.motorBrake));
  setText('viRetarder', truck.retarder == null ? '—' : String(truck.retarder));
  setText('viLift', yesNo(truck.liftAxle));
  setText('viTrailerLift', yesNo(truck.trailerLiftAxle));

  const lights = truck.lights || {};
  const on = [];
  if (lights.low) on.push('LOW');
  if (lights.high) on.push('HIGH');
  if (lights.parking) on.push('PARK');
  if (lights.beacon) on.push('BEACON');
  if (lights.left) on.push('L');
  if (lights.right) on.push('R');
  const lightsEl = $('viLights');
  if (lightsEl) {
    const anyRead = Object.values(lights).some((v) => v != null);
    lightsEl.textContent = !anyRead ? '—' : (on.length ? on.join(' · ') : 'OFF');
  }

  setText('vehicleSource', state.telemetry && state.telemetry.game.connected
    ? `SCS shared-memory plugin · ${state.telemetry.game.name || boot.short}`
    : 'SCS shared-memory plugin · not connected');
}

function paintMedia(media) {
  if (!media) return;
  const live = !!media.available;
  const layout = $('mediaLayout');
  const empty = $('mediaEmpty');
  if (layout) layout.hidden = !live;
  if (empty) empty.hidden = live;

  setText('dockMedia', live ? 'MEDIA · LIVE' : 'MEDIA —');
  setText('dockTrack', live
    ? `${media.title || '—'} — ${media.artist || '—'}`
    : (media.error || 'NO MEDIA SESSION'));

  if (!live) {
    setText('mediaEmptyDetail', media.error || '');
    return;
  }

  const art = $('mediaArt');
  const img = $('mediaArtImg');
  if (art && img) {
    if (media.artwork && media.artwork_key) {
      const src = `${media.artwork}?v=${encodeURIComponent(media.artwork_key)}`;
      if (img.getAttribute('src') !== src) img.src = src;
      img.hidden = false;
    } else {
      img.hidden = true;
      img.removeAttribute('src');
    }
    art.classList.toggle('is-playing', !!media.is_playing);
  }

  setText('mediaEyebrow', `NOW PLAYING · ${(media.album && media.album !== '—') ? media.album : 'MEDIA'}`);
  setText('mediaTitle', media.title || '—');
  setText('mediaArtist', media.artist || '—');

  const duration = Number(media.duration) || 0;
  const position = Number(media.position) || 0;
  const pct = duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0;
  const fill = $('mediaBarFill');
  const knob = $('mediaBarKnob');
  if (fill) fill.style.width = `${pct}%`;
  if (knob) knob.style.left = `${pct}%`;
  setText('mediaCurrent', timecode(position));
  setText('mediaDuration', timecode(duration));

  const play = $('mediaPlay');
  if (play) play.classList.toggle('is-playing', !!media.is_playing);

  const source = String(media.source || '');
  setText('mediaSource', source.includes('Spotify') ? 'SPOTIFY DESKTOP' : (source ? 'OS MEDIA SESSION' : 'SOURCE —'));
}

function paintHealth(health) {
  if (!health) return;
  state.health = health;
  const bridge = health.bridge || {};

  const rail = $('railBridge');
  if (rail) {
    rail.dataset.state = bridge.connected ? 'live' : 'warn';
    const text = rail.querySelector('span');
    if (text) text.textContent = bridge.connected ? 'BRIDGE OK' : 'BRIDGE OFF';
  }

  const stBridge = $('stBridge');
  if (stBridge) stBridge.className = `st-dot${bridge.connected ? ' st-ok' : ''}`;
  setText('stBridgeText', bridge.connected ? 'BRIDGE' : 'NO BRIDGE');
  setText('stGame', (bridge.connected && bridge.game_name) ? bridge.game_name.toUpperCase() : 'NO GAME');

  setText('dockBridge', bridge.connected
    ? `BRIDGE · ${String(bridge.game_name || boot.short).toUpperCase()}`
    : 'BRIDGE —');

  const setupBridge = $('setupBridge');
  if (setupBridge) {
    setupBridge.textContent = bridge.connected
      ? `LINKED · ${bridge.game_name || boot.short}`
      : (bridge.plugin_loaded ? 'PLUGIN IDLE' : 'NO PLUGIN');
    setupBridge.dataset.state = bridge.connected ? 'ok' : (bridge.plugin_loaded ? 'warn' : 'fault');
    setupBridge.title = bridge.status || '';
  }

  const setupMedia = $('setupMedia');
  if (setupMedia) {
    setupMedia.textContent = health.media && health.media.source ? 'LINKED' : 'NO SESSION';
    setupMedia.dataset.state = health.media && health.media.source ? 'ok' : 'warn';
  }

  setText('setupHost', boot.host || '—');
}

/* ------------------------------------------------------------
   trip
   ------------------------------------------------------------ */

let tripView = null;

function ensureTrip() {
  if (tripView) return tripView;
  const host = $('tripLayout');
  if (!host) return null;
  tripView = new TripView(host, {
    onReset: async () => {
      try {
        state.trip = await postJSON(api.tripReset, {});
        paintTrip();
        toast('TRIP · RESET');
      } catch (error) {
        toast(`TRIP · ${error.message}`, 'fault');
      }
    },
  });
  if (state.trip) paintTrip();
  return tripView;
}

function paintTrip() {
  if (!state.trip) return;
  if (!tripView) ensureTrip();
  if (!tripView) return;
  const truck = (state.telemetry && state.telemetry.truck) || {};
  tripView.update(state.trip, prefs.units, truck.heading);

  const stGps = $('stGps');
  if (stGps) stGps.className = `st-dot${state.trip.active ? ' st-ok' : ''}`;
  setText('stGpsText', state.trip.active ? 'POSITION' : 'NO FIX');

  const distance = prefs.units === 'imperial'
    ? `${(state.trip.distance_km * 0.621371).toFixed(1)} MI`
    : `${state.trip.distance_km.toFixed(1)} KM`;
  setText('setupTrip', state.trip.samples
    ? `${distance} · ${state.trip.samples} SMP`
    : 'EMPTY · NO FIX');
  const setupTrip = $('setupTrip');
  if (setupTrip) setupTrip.dataset.state = state.trip.samples ? 'ok' : 'warn';

  const position = $('setupPosition');
  if (position) {
    position.textContent = state.trip.active ? 'LIVE' : 'NO FIX';
    position.dataset.state = state.trip.active ? 'ok' : 'warn';
  }
}

/* ------------------------------------------------------------
   media transport
   ------------------------------------------------------------ */

function bindMedia() {
  const buttons = { mediaPrev: 'prev', mediaPlay: 'play_pause', mediaNext: 'next' };
  for (const [id, action] of Object.entries(buttons)) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('click', async () => {
      try {
        await postJSON(`${api.media}transport/${action}`, {});
        setTimeout(pollMedia, 220);
      } catch (error) {
        toast(`MEDIA · ${error.message}`, 'fault');
      }
    });
  }
}
bindMedia();

/* ------------------------------------------------------------
   MFD view switching
   ------------------------------------------------------------ */

const screenLabels = Object.fromEntries((boot.screens || []).map((s) => [s.id, s.label]));

function activateView(id, push = true) {
  if (!screenLabels[id]) return;
  state.activeView = id;

  document.querySelectorAll('.info-view').forEach((view) => {
    view.classList.toggle('is-active', view.dataset.view === id);
  });
  document.querySelectorAll('.info-tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.view === id);
  });

  document.body.dataset.screen = id;
  document.title = `${boot.short || 'F-100'} · ${screenLabels[id]}`;
  const path = `/${boot.app}/${id}/`;
  if (push && location.pathname !== path) {
    history.pushState({ screen: id }, '', path);
  }

  if (id === 'trip') {
    ensureTrip();
    pollTrip();
    requestAnimationFrame(() => { if (tripView) tripView.redraw(); });
  }
  if (id === 'media' && !state.media) pollMedia();
}

document.querySelectorAll('.info-tab').forEach((tab) => {
  tab.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    activateView(tab.dataset.view);
  });
});

window.addEventListener('popstate', (event) => {
  const path = location.pathname.split('/').filter(Boolean);
  const id = (event.state && event.state.screen) || path[1] || 'media';
  activateView(id, false);
});

document.addEventListener('keydown', (event) => {
  if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const ids = Object.keys(screenLabels);
  const index = Number(event.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < ids.length) {
    event.preventDefault();
    activateView(ids[index]);
  }
});

/* ------------------------------------------------------------
   preferences UI
   ------------------------------------------------------------ */

function syncPrefsUI() {
  document.body.dataset.units = prefs.units;

  document.querySelectorAll('#setupUnits button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.units === prefs.units);
  });

  setText('clusterUnits', prefs.units.toUpperCase());
  setText('stUnits', prefs.units.toUpperCase());
  if (state.telemetry) {
    paintReadouts(state.telemetry);
    paintVehicle(state.telemetry.truck);
  }
  paintSpeed();
  paintTrip();
}

function bindPrefs() {
  document.querySelectorAll('#setupUnits button').forEach((button) => {
    button.addEventListener('click', () => {
      prefs.units = button.dataset.units;
      prefs.unitsSet = true;
      savePrefs();
      syncPrefsUI();
    });
  });
}
bindPrefs();
syncPrefsUI();

/* ------------------------------------------------------------
   pollers
   ------------------------------------------------------------ */

async function pollTelemetry() {
  try {
    const data = await getJSON(api.telemetry);
    state.telemetry = data;
    paintReadouts(data);
    if (tripView) paintTrip();
  } catch (error) {
    setText('clusterMeta', 'TELEMETRY UNREACHABLE');
    setText('statusText', 'DECK OFFLINE');
  }
}

async function pollControls() {
  try {
    const data = await getJSON(api.controls);
    state.controls = data;
    syncRack(data);
    paintControlState(data);
    if (state.telemetry) paintReadouts(state.telemetry);
  } catch (error) {
    paintControlState({ available: false, game_active: false });
  }
}

function syncRack(controls) {
  const truck = (state.telemetry && state.telemetry.truck) || {};
  const lights = truck.lights || {};

  ctl.engineBrake.set(!!controls.motor_brake, true);
  ctl.lift.set(!!controls.lift_axle, true);
  ctl.high.set(!!lights.high, true);
  ctl.parking.set(!!lights.parking, true);
  ctl.cruise.set(truck.cruise != null && truck.cruise > 0, true);
  ctl.beacon.set(!!lights.beacon, true);

  if (controls.retarder_level != null && ctl.retarder.subEl) {
    ctl.retarder.subEl.textContent = `LV ${controls.retarder_level}`;
  }

  let keyPosition = 0;
  if (lights.high || lights.low) keyPosition = 2;
  else if (lights.parking) keyPosition = 1;
  ctl.lightKey.setIndex(keyPosition, true);
}

async function pollMedia() {
  try {
    const data = await getJSON(api.media);
    state.media = data;
    paintMedia(data);
  } catch (error) {
    state.media = { available: false, error: error.message };
    paintMedia(state.media);
  }
}

async function pollHealth() {
  try {
    const data = await getJSON(api.health);
    paintHealth(data);
  } catch (error) {
    const rail = $('railBridge');
    if (rail) rail.dataset.state = 'warn';
  }
}

async function pollTrip() {
  try {
    state.trip = await getJSON(api.trip);
    paintTrip();
  } catch (error) {
    const mode = $('tripTraceMode');
    if (mode) {
      mode.textContent = 'TRIP UNREACHABLE';
      mode.dataset.state = 'warn';
    }
  }
}

every(pollTelemetry, 1000);
every(pollControls, 1500);
every(pollMedia, 2000);
every(pollHealth, 6000);
every(pollTrip, 1000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  pollTelemetry();
  pollControls();
  pollMedia();
  pollHealth();
  pollTrip();
});

/* ------------------------------------------------------------
   boot
   ------------------------------------------------------------ */

if (state.activeView === 'trip') {
  ensureTrip();
  pollTrip();
}
setTimeout(runSelfTest, 420);
