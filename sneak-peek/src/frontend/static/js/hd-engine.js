/* ============================================================
   HD·CONTROLS ENGINE v1.4 — control primitives + MFD views.
   Lifted from the design deck so the shipped console and the
   design share one implementation.
   ============================================================ */

export const HDEngine = (function () {

  const U = {
    hex2rgb(h){
      h = String(h).replace('#','');
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      const n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    mix(a, b, t){ return a.map((v, i) => Math.round(v + (b[i] - v) * t)); },
    rgb(a){ return `rgb(${a[0]},${a[1]},${a[2]})`; },
    el(tag, cls, style){
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (style) n.setAttribute('style', style);
      return n;
    },
    svg(tag, attrs){
      const NS = 'http://www.w3.org/2000/svg';
      const n = document.createElementNS(NS, tag);
      if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    },
    clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
  };

  const SEG_POLYGONS = {
    a: '12,0 48,0 52,4 48,8 12,8 8,4',
    b: '52,12 56,8 60,12 60,42 56,46 52,42',
    c: '52,58 56,54 60,58 60,88 56,92 52,88',
    d: '12,92 48,92 52,96 48,100 12,100 8,96',
    e: '0,58 4,54 8,58 8,88 4,92 0,88',
    f: '0,12 4,8 8,12 8,42 4,46 0,42',
    g: '12,46 48,46 52,50 48,54 12,54 8,50'
  };
  const SEG_MAP = {
    '0':'abcdef', '1':'bc', '2':'abged', '3':'abgcd', '4':'fgbc',
    '5':'afgcd', '6':'afgedc', '7':'abc', '8':'abcdefg', '9':'abcdfg',
    ' ':'', '-':'g',
    'A':'abcefg', 'b':'cdefg', 'C':'adef', 'd':'bcdeg',
    'E':'adefg', 'F':'aefg', 'H':'bcefg', 'L':'def',
    'P':'abefg', 'r':'eg', 'U':'bcdef'
  };

  class HDControl {
    constructor(cfg){
      this.cfg = Object.assign({
        type: 'push', variant: 'flush', orientation: 'vertical',
        size: 118, accent: '#e0453a',
        label: 'CONTROL', sub: '', value: false,
        detents: 8, ticks: 11, digits: 4, segments: 14,
        latch: false, span: 1,
        format: null, onChange: null
      }, cfg);

      this.el = U.el('div', `hd hd--${this.cfg.type} hd--${this.cfg.variant}`);
      this.el.dataset.variant = this.cfg.variant;
      if (this.cfg.variant === 'led') this.el.classList.add('variant-led');
      this.el.style.setProperty('--s', this.cfg.size + 'px');
      if (this.cfg.type === 'slider'){
        this.el.classList.toggle('hd--h', this.cfg.orientation === 'horizontal');
      }
      if (this.cfg.span > 1) this.el.style.gridColumn = `span ${this.cfg.span}`;

      const a = U.hex2rgb(this.cfg.accent);
      this.el.style.setProperty('--a',   U.rgb(a));
      this.el.style.setProperty('--a-l', U.rgb(U.mix(a, [255,255,255], .46)));
      this.el.style.setProperty('--a-d', U.rgb(U.mix(a, [0,0,0], .64)));
      this.el.style.setProperty('--glow', a.join(','));

      this.unit = U.el('div', 'hd-unit');
      this.el.appendChild(this.unit);

      const builder = this[`_build_${this.cfg.type}`];
      if (!builder) throw new Error(`HDEngine: unknown type "${this.cfg.type}"`);
      builder.call(this);

      const lab = U.el('div', 'hd-label');
      lab.textContent = this.cfg.label;
      this.el.appendChild(lab);

      const s = U.el('div', 'hd-sub');
      if ((this.cfg.type === 'slider' || this.cfg.type === 'slide' ||
           this.cfg.type === 'display') && this.cfg.format){
        s.textContent = this.cfg.format(this.value);
      } else {
        s.textContent = this.cfg.sub;
      }
      this.el.appendChild(s);
      this.subEl = s;

      if (this.cfg.type === 'rotary'){
        this.detents = this.cfg.detents;
        this.index = U.clamp(this.cfg.value | 0, 0, this.detents);
        this.value = this.index;
        this._syncRotary();
      } else if (this.cfg.type === 'key'){
        this.detents = 2;
        this.index = U.clamp(this.cfg.value | 0, 0, 2);
        this.value = this.index;
        this._syncKey();
      } else if (this.cfg.type === 'slider'){
        this.value = U.clamp(typeof this.cfg.value === 'number' ? this.cfg.value : 0, 0, 1);
        this._syncSlider();
      } else if (this.cfg.type === 'slide'){
        this.detents = (this.cfg.detents | 0) || 1;
        this.index = U.clamp(this.cfg.value | 0, 0, this.detents);
        this.value = this.index;
        this._syncSlide();
      } else if (this.cfg.type === 'display'){
        this.value = null;
        if (this.cfg.variant === 'sevenseg'){
          this.setDisplay(this.cfg.value != null ? String(this.cfg.value) : '    ');
        } else if (this.cfg.variant === 'lcd'){
          this.setDisplay(this.cfg.value != null ? String(this.cfg.value) : '—');
        } else if (this.cfg.variant === 'bargraph' || this.cfg.variant === 'vu'){
          this.setDisplay(typeof this.cfg.value === 'number' ? this.cfg.value : 0);
        }
      } else {
        this.value = !!this.cfg.value;
        this._sync();
      }
    }

    _screws(host, count, radius){
      const screwSize = 0.085;
      const off = (radius / screwSize) * 100;
      for (let i = 0; i < count; i++){
        const ang = 45 + i * (360 / count);
        host.appendChild(U.el('span', 'hd-screw',
          `--ang:${ang}deg;--off:${off.toFixed(1)}%;--slot:${(Math.random()*150-75).toFixed(0)}deg`));
      }
    }
    _cornerScrews(host, inset){
      const corners = [
        { x: inset, y: inset }, { x: 100 - inset, y: inset },
        { x: inset, y: 100 - inset }, { x: 100 - inset, y: 100 - inset }
      ];
      corners.forEach(c => {
        const s = U.el('span', 'hd-corner-screw');
        s.style.left = c.x + '%';
        s.style.top  = c.y + '%';
        s.style.setProperty('--slot', (Math.random()*150-75).toFixed(0) + 'deg');
        host.appendChild(s);
      });
    }

    _build_push(){
      if (this.cfg.variant === 'square') return this._build_square();
      const u = this.unit;
      const bezel = U.el('div', 'hd-bezel');
      this._screws(bezel, 4, 0.40);
      u.appendChild(bezel);
      u.appendChild(U.el('div', 'hd-well'));
      this.led = U.el('div', 'hd-led');
      u.appendChild(this.led);
      const cap = U.el('button', 'hd-cap');
      cap.type = 'button';
      cap.setAttribute('aria-label', this.cfg.label);
      cap.appendChild(U.el('span', 'hd-cap-ring'));
      cap.appendChild(U.el('span', 'hd-cap-gloss'));
      u.appendChild(cap);
      this.cap = cap;
      this._bindPush(cap);
    }
    _build_square(){
      const u = this.unit;
      const plate = U.el('div', 'hd-sq-plate');
      this._cornerScrews(plate, 9);
      u.appendChild(plate);
      u.appendChild(U.el('div', 'hd-sq-well'));
      u.appendChild(U.el('div', 'hd-sq-led'));
      const cap = U.el('button', 'hd-sq-cap');
      cap.type = 'button';
      cap.setAttribute('aria-label', this.cfg.label);
      const legend = U.el('span', 'hd-sq-legend');
      legend.textContent = this.cfg.sub || this.cfg.label;
      cap.appendChild(legend);
      cap.appendChild(U.el('span', 'hd-sq-gloss'));
      u.appendChild(cap);
      this.cap = cap;
      this._bindPush(cap);
    }
    _bindPush(cap){
      const press = down => {
        if (this.cfg.latch) return;
        cap.classList.toggle('is-down', down);
        this.el.classList.toggle('is-active', down);
        this._emit(down ? 'press' : 'release');
      };
      if (this.cfg.latch){
        cap.addEventListener('click', () => this.set(!this.value));
      } else {
        cap.addEventListener('pointerdown', e => {
          cap.setPointerCapture(e.pointerId); press(true);
        });
        const up = () => press(false);
        cap.addEventListener('pointerup', up);
        cap.addEventListener('pointercancel', up);
        cap.addEventListener('keydown', e => {
          if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); press(true); }
        });
        cap.addEventListener('keyup', e => {
          if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); press(false); }
        });
      }
    }

    _build_toggle(){
      const u = this.unit;
      u.appendChild(U.el('div', 'hd-base'));
      const screwHost = U.el('div', 'hd-screws');
      this._screws(screwHost, 4, 0.37);
      u.appendChild(screwHost);
      u.appendChild(U.el('div', 'hd-collar'));
      u.appendChild(U.el('span', 'hd-dot'));
      const lever = U.el('div', 'hd-lever');
      lever.appendChild(U.el('span', 'hd-lever-shaft'));
      lever.appendChild(U.el('span', 'hd-lever-tip'));
      u.appendChild(lever);
      u.style.cursor = 'pointer';
      u.setAttribute('role', 'switch');
      u.setAttribute('tabindex', '0');
      u.setAttribute('aria-checked', 'false');
      u.addEventListener('click', () => this.set(!this.value));
      u.addEventListener('keydown', e => {
        if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); this.set(!this.value); }
      });
    }

    _build_rocker(){
      const u = this.unit;
      const plate = U.el('div', 'hd-rk-plate');
      this._cornerScrews(plate, 9);
      u.appendChild(plate);
      const well = U.el('div', 'hd-rk-well');
      const paddle = U.el('div', 'hd-rk-paddle');
      paddle.appendChild(U.el('span', 'hd-rk-glow'));
      paddle.appendChild(U.el('span', 'hd-rk-line'));
      well.appendChild(paddle);
      u.appendChild(well);
      u.style.cursor = 'pointer';
      u.setAttribute('role', 'switch');
      u.setAttribute('tabindex', '0');
      u.setAttribute('aria-checked', 'false');
      u.addEventListener('click', () => this.set(!this.value));
      u.addEventListener('keydown', e => {
        if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); this.set(!this.value); }
      });
    }

    _build_key(){
      const u = this.unit;
      const bezel = U.el('div', 'hd-bezel');
      this._screws(bezel, 4, 0.40);
      u.appendChild(bezel);
      u.appendChild(U.el('div', 'hd-key-cylinder'));
      const key = U.el('div', 'hd-key');
      key.appendChild(U.el('span', 'hd-key-blade'));
      key.appendChild(U.el('span', 'hd-key-bow'));
      u.appendChild(key);
      this.knob = key;
      u.style.cursor = 'pointer';
      u.setAttribute('role', 'slider');
      u.setAttribute('tabindex', '0');
      u.addEventListener('click', () => this.setIndex((this.index + 1) % 3));
      u.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp'){ e.preventDefault(); this.setIndex((this.index + 1) % 3); }
        if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown'){ e.preventDefault(); this.setIndex((this.index + 2) % 3); }
      });
      u.addEventListener('wheel', e => {
        e.preventDefault();
        this.setIndex((this.index + (Math.sign(e.deltaY) + 3)) % 3);
      }, { passive: false });
    }

    _build_pushpull(){
      const u = this.unit;
      const bezel = U.el('div', 'hd-bezel');
      this._screws(bezel, 4, 0.40);
      u.appendChild(bezel);
      u.appendChild(U.el('div', 'hd-pp-ring'));
      const assembly = U.el('div', 'hd-pp-assembly');
      assembly.appendChild(U.el('span', 'hd-pp-shaft'));
      assembly.appendChild(U.el('span', 'hd-pp-cap'));
      u.appendChild(assembly);
      this.cap = assembly;
      this.led = U.el('div', 'hd-led');
      u.appendChild(this.led);
      u.style.cursor = 'pointer';
      u.setAttribute('role', 'switch');
      u.setAttribute('tabindex', '0');
      u.setAttribute('aria-checked', 'false');
      u.addEventListener('click', () => this.set(!this.value));
      u.addEventListener('keydown', e => {
        if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); this.set(!this.value); }
      });
    }

    _build_lamp(){
      const u = this.unit;
      u.appendChild(U.el('div', 'hd-lamp-bezel'));
      u.appendChild(U.el('div', 'hd-lamp-dome'));
      u.appendChild(U.el('div', 'hd-lamp-grille'));
      u.setAttribute('role', 'status');
    }

    _build_slide(){
      const u = this.unit;
      const body = U.el('div', 'hd-slide-body');
      const track = U.el('div', 'hd-slide-track');
      const knob = U.el('div', 'hd-slide-knob');
      track.appendChild(knob);
      body.appendChild(track);
      u.appendChild(body);
      this.knob = knob;
      u.style.cursor = 'pointer';
      u.setAttribute('role', 'slider');
      u.setAttribute('tabindex', '0');
      u.addEventListener('click', () => this.setIndex((this.index + 1) % (this.detents + 1)));
      u.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp'){ e.preventDefault(); this.setIndex(this.index + 1); }
        if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown'){ e.preventDefault(); this.setIndex(this.index - 1); }
      });
    }

    _build_rotary(){
      const u = this.unit;
      const bezel = U.el('div', 'hd-bezel');
      this._screws(bezel, 4, 0.40);
      u.appendChild(bezel);
      u.appendChild(U.el('div', 'hd-well'));
      const ticks = U.el('div', 'hd-ticks');
      const N = this.cfg.detents;
      for (let i = 0; i <= N; i++){
        ticks.appendChild(U.el('span', 'hd-tick',
          `--a:${(-135 + 270 * i / N).toFixed(2)}deg;`));
      }
      u.appendChild(ticks);
      const arc = U.el('div', 'hd-rotary-arc');
      u.appendChild(arc);
      this.arc = arc;
      this.led = U.el('div', 'hd-led');
      u.appendChild(this.led);
      const knob = U.el('div', 'hd-knob');
      knob.appendChild(U.el('span', 'hd-knurl'));
      knob.appendChild(U.el('span', 'hd-knob-face'));
      knob.appendChild(U.el('span', 'hd-pointer'));
      u.appendChild(knob);
      this.knob = knob;
      u.setAttribute('role', 'slider');
      u.setAttribute('tabindex', '0');

      let dragging = false, startY = 0, startIdx = 0;
      const PX_PER_DETENT = 17;
      u.addEventListener('pointerdown', e => {
        dragging = true; startY = e.clientY; startIdx = this.index;
        u.setPointerCapture(e.pointerId);
      });
      u.addEventListener('pointermove', e => {
        if (!dragging) return;
        const steps = Math.round((startY - e.clientY) / PX_PER_DETENT);
        this.setIndex(startIdx + steps);
      });
      const stop = () => { dragging = false; };
      u.addEventListener('pointerup', stop);
      u.addEventListener('pointercancel', stop);
      u.addEventListener('wheel', e => {
        e.preventDefault();
        this.setIndex(this.index + Math.sign(e.deltaY));
      }, { passive: false });
      u.addEventListener('keydown', e => {
        if (e.key === 'ArrowUp'   || e.key === 'ArrowRight'){ e.preventDefault(); this.setIndex(this.index + 1); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft'){  e.preventDefault(); this.setIndex(this.index - 1); }
      });
    }

    _build_slider(){
      const u = this.unit;
      const horizontal = this.cfg.orientation === 'horizontal';
      const plate = U.el('div', 'hd-slider-plate');
      this._cornerScrews(plate, horizontal ? 6 : 9);
      u.appendChild(plate);
      const track = U.el('div', 'hd-slider-track');
      u.appendChild(track);
      const slot = U.el('div', 'hd-slider-slot');
      const fill = U.el('div', 'hd-slider-fill');
      slot.appendChild(fill);
      track.appendChild(slot);
      const tickHost = U.el('div', 'hd-slider-ticks');
      const N = this.cfg.ticks;
      const majorEvery = Math.max(1, Math.round((N - 1) / 4));
      for (let i = 0; i < N; i++){
        const t = i / (N - 1);
        const major = (i % majorEvery === 0) || i === N - 1;
        const tk = U.el('span', 'hd-slider-tick' + (major ? ' is-major' : ''));
        tk.style.setProperty('--t', (t * 100).toFixed(3) + '%');
        tickHost.appendChild(tk);
      }
      track.appendChild(tickHost);
      const handle = U.el('div', 'hd-slider-handle');
      track.appendChild(handle);
      u.setAttribute('role', 'slider');
      u.setAttribute('tabindex', '0');

      let dragging = false;
      const setFromEvent = e => {
        const rect = track.getBoundingClientRect();
        let v;
        if (horizontal) v = (e.clientX - rect.left) / rect.width;
        else            v = 1 - (e.clientY - rect.top) / rect.height;
        this.setValue(U.clamp(v, 0, 1));
      };
      u.addEventListener('pointerdown', e => {
        dragging = true; u.setPointerCapture(e.pointerId); setFromEvent(e);
      });
      u.addEventListener('pointermove', e => { if (dragging) setFromEvent(e); });
      const stop = () => { dragging = false; };
      u.addEventListener('pointerup', stop);
      u.addEventListener('pointercancel', stop);
      u.addEventListener('keydown', e => {
        const step = e.shiftKey ? 0.1 : 0.02;
        const up = horizontal ? 'ArrowRight' : 'ArrowUp';
        const dn = horizontal ? 'ArrowLeft'  : 'ArrowDown';
        if (e.key === up){ e.preventDefault(); this.setValue(this.value + step); }
        if (e.key === dn){ e.preventDefault(); this.setValue(this.value - step); }
        if (e.key === 'Home'){ e.preventDefault(); this.setValue(0); }
        if (e.key === 'End'){ e.preventDefault(); this.setValue(1); }
      });
    }

    _build_display(){
      const u = this.unit;
      const variant = this.cfg.variant || 'sevenseg';
      u.appendChild(U.el('div', 'hd-display-plate'));
      const glass = U.el('div', 'hd-display-glass');
      u.appendChild(glass);

      if (variant === 'sevenseg'){
        const wrap = U.el('div', 'hd-7seg');
        glass.appendChild(wrap);
        this.digitEls = [];
        const count = this.cfg.digits || 4;
        for (let i = 0; i < count; i++){
          const svg = U.svg('svg', { viewBox: '0 0 60 100', class: 'hd-7seg-digit', preserveAspectRatio: 'xMidYMid meet' });
          const segs = {};
          for (const k in SEG_POLYGONS){
            const poly = U.svg('polygon', { points: SEG_POLYGONS[k], class: 'hd-seg ' + k });
            svg.appendChild(poly);
            segs[k] = poly;
          }
          wrap.appendChild(svg);
          this.digitEls.push({ el: svg, segs });
        }
      } else if (variant === 'lcd'){
        const txt = U.el('div', 'hd-lcd-text');
        glass.appendChild(txt);
        this.lcdText = txt;
      } else if (variant === 'bargraph'){
        const wrap = U.el('div', 'hd-bar');
        glass.appendChild(wrap);
        this.barSegs = [];
        const count = this.cfg.segments || 14;
        for (let i = 0; i < count; i++){
          const seg = U.el('div', 'hd-bar-seg');
          wrap.appendChild(seg);
          this.barSegs.push(seg);
        }
      } else if (variant === 'vu'){
        this._buildVU(glass);
      }
    }

    _buildVU(glass){
      const svg = U.svg('svg', { viewBox: '0 0 320 90', class: 'hd-vu', preserveAspectRatio: 'xMidYMid meet' });
      const px = 160, py = 130;
      const rOuter = 100, rInner = 88, rMinor = 93, rLabel = 78;
      const steps = 22;
      for (let i = 0; i <= steps; i++){
        const a = -55 + (110 * i / steps);
        const isMajor = i % 5 === 0;
        const rad = (a - 90) * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const r = isMajor ? rInner : rMinor;
        svg.appendChild(U.svg('line', {
          x1: (px + cos * r).toFixed(2), y1: (py + sin * r).toFixed(2),
          x2: (px + cos * rOuter).toFixed(2), y2: (py + sin * rOuter).toFixed(2),
          stroke: isMajor ? '#7b838b' : '#3d444a',
          'stroke-width': isMajor ? '1.6' : '0.8',
          'stroke-linecap': 'round'
        }));
        if (isMajor){
          const t = U.svg('text', {
            x: (px + cos * rLabel).toFixed(2), y: (py + sin * rLabel).toFixed(2),
            'text-anchor': 'middle', 'dominant-baseline': 'middle',
            'font-size': '8', 'font-family': 'ui-monospace, monospace',
            'font-weight': '700', fill: '#5a636c'
          });
          t.textContent = String((i / 5) * 20);
          svg.appendChild(t);
        }
      }
      const needle = U.svg('g', { class: 'hd-vu-needle', transform: `rotate(-55 ${px} ${py})` });
      needle.appendChild(U.svg('line', {
        x1: px, y1: py, x2: px, y2: py - 95,
        stroke: '#e0453a', 'stroke-width': '2', 'stroke-linecap': 'round'
      }));
      svg.appendChild(needle);
      svg.appendChild(U.svg('rect', {
        x: 60, y: 82, width: 200, height: 6, rx: 3,
        fill: '#0a0c0e', stroke: 'rgba(255,255,255,.05)'
      }));
      glass.appendChild(svg);
      this.vuNeedle = needle;
      this.vuPivot = { x: px, y: py };
    }

    _setSevenSeg(digit, ch){
      const on = SEG_MAP[ch] || '';
      for (const k in digit.segs){
        digit.segs[k].classList.toggle('on', on.indexOf(k) !== -1);
      }
    }

    setDisplay(value){
      const variant = this.cfg.variant || 'sevenseg';
      if (variant === 'sevenseg'){
        const str = String(value == null ? '' : value)
          .padStart(this.digitEls.length, ' ').slice(-this.digitEls.length);
        for (let i = 0; i < this.digitEls.length; i++){
          this._setSevenSeg(this.digitEls[i], str[i] || ' ');
        }
        this.value = value;
      } else if (variant === 'lcd'){
        this.lcdText.textContent = String(value == null ? '' : value);
        this.value = value;
      } else if (variant === 'bargraph'){
        const v = U.clamp(Number(value) || 0, 0, 1);
        const N = this.barSegs.length;
        const lit = v * N;
        for (let i = 0; i < N; i++){
          const seg = this.barSegs[i];
          const isOn = (i + 0.5) < lit;
          seg.classList.toggle('on', isOn);
          const pos = i / (N - 1);
          seg.classList.toggle('warn',  isOn && pos >= 0.7 && pos < 0.9);
          seg.classList.toggle('fault', isOn && pos >= 0.9);
        }
        this.value = v;
      } else if (variant === 'vu'){
        const v = U.clamp(Number(value) || 0, 0, 1);
        const angle = -55 + 110 * v;
        this.vuNeedle.setAttribute('transform',
          `rotate(${angle.toFixed(2)} ${this.vuPivot.x} ${this.vuPivot.y})`);
        this.value = v;
      }
      if (this.subEl && this.cfg.format){
        this.subEl.textContent = this.cfg.format(this.value);
      }
      return this;
    }

    _sync(){
      const on = !!this.value;
      this.el.classList.toggle('is-on', on);
      this.el.classList.toggle('is-active', on);
      if (this.cfg.type === 'push' && this.cfg.latch && this.cap){
        this.cap.classList.toggle('is-down', on);
        this.cap.setAttribute('aria-pressed', String(on));
      }
      if (this.cfg.type === 'toggle' || this.cfg.type === 'rocker' || this.cfg.type === 'pushpull'){
        this.unit.setAttribute('aria-checked', String(on));
      }
    }
    _syncRotary(){
      const { detents } = this;
      const angle = -135 + (270 * this.index / detents);
      this.knob.style.setProperty('--rot', angle.toFixed(2) + 'deg');
      this.el.classList.toggle('is-active', this.index > 0);
      this.unit.setAttribute('aria-valuenow', String(this.index));
      if (this.arc){
        const sweep = 270 * this.index / detents;
        this.arc.style.setProperty('--sweep', sweep.toFixed(2) + 'deg');
      }
    }
    _syncKey(){
      const angles = [-45, 0, 45];
      this.knob.style.setProperty('--rot', angles[this.index] + 'deg');
      this.el.classList.toggle('is-active', this.index > 0);
      this.unit.setAttribute('aria-valuenow', String(this.index));
    }
    _syncSlider(){
      const pct = (this.value * 100).toFixed(3) + '%';
      this.unit.style.setProperty('--pos', pct);
      this.el.classList.toggle('is-active', this.value > 0.01);
      this.unit.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
      if (this.subEl && this.cfg.format) this.subEl.textContent = this.cfg.format(this.value);
    }
    _syncSlide(){
      const pct = (this.index / this.detents * 100).toFixed(2) + '%';
      this.knob.style.setProperty('--pos', pct);
      this.el.classList.toggle('is-active', this.index > 0);
      this.unit.setAttribute('aria-valuenow', String(this.index));
      if (this.subEl && this.cfg.format) this.subEl.textContent = this.cfg.format(this.index);
    }
    _emit(name){
      this.el.dispatchEvent(new CustomEvent(name, { detail: { value: this.value } }));
    }

    set(v, silent){
      v = !!v;
      if (v === this.value) return this;
      this.value = v;
      this._sync();
      if (!silent && this.cfg.onChange) this.cfg.onChange(v, this);
      this._emit('change');
      return this;
    }
    setIndex(i, silent){
      const max = this.cfg.type === 'key' ? 2 : this.detents;
      const next = U.clamp(i | 0, 0, max);
      if (next === this.index) return this;
      this.index = next;
      this.value = next;
      if (this.cfg.type === 'key') this._syncKey();
      else if (this.cfg.type === 'slide') this._syncSlide();
      else this._syncRotary();
      if (!silent && this.cfg.onChange) this.cfg.onChange(next, this);
      this._emit('change');
      return this;
    }
    setValue(v, silent){
      v = U.clamp(v, 0, 1);
      if (v === this.value) return this;
      this.value = v;
      this._syncSlider();
      if (!silent && this.cfg.onChange) this.cfg.onChange(v, this);
      this._emit('change');
      return this;
    }
  }

  return {
    version: '1.4.0',
    create(target, cfg){
      const control = new HDControl(cfg);
      const host = typeof target === 'string' ? document.querySelector(target) : target;
      if (host) host.appendChild(control.el);
      return control;
    }
  };
})();

export default HDEngine;
