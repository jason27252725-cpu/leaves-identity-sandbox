/*
 * LEAVES success feedback — original motion and synthesized sound.
 * No Apple artwork, system audio, external libraries, or network requests.
 * Usage: <leaves-success id="success" text="儲存成功"></leaves-success>
 * In a click handler: await LeavesSuccess.unlockAudio();
 * After the real operation succeeds: success.play({ sound: true });
 */
(function (global) {
  'use strict';
  if (customElements.get('leaves-success')) return;

  let sharedAudio = null;
  const duration = 2.4;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const progress = (time, start, end) => clamp((time - start) / (end - start), 0, 1);
  const smooth = (value) => value * value * (3 - 2 * value);

  class LeavesSuccess extends HTMLElement {
    static get observedAttributes() { return ['text', 'color', 'size']; }

    /** Call directly from a real click/tap. Returns false if sound is unavailable. */
    static async unlockAudio() {
      try {
        const AudioContext = global.AudioContext || global.webkitAudioContext;
        if (!AudioContext) return false;
        if (!sharedAudio || sharedAudio.state === 'closed') sharedAudio = new AudioContext();
        if (sharedAudio.state === 'running') return true;
        let timer;
        try {
          await Promise.race([
            sharedAudio.resume(),
            new Promise((resolve) => { timer = setTimeout(resolve, 400); })
          ]);
        } finally { clearTimeout(timer); }
        return sharedAudio.state === 'running';
      } catch (_) { return false; }
    }

    constructor() {
      super();
      this._run = 0;
      this._raf = 0;
      this._nodes = [];
      this._finish = null;
      this._root = this.attachShadow({ mode: 'open' });
      this._root.innerHTML = `
        <style>
          :host { display: inline-flex; flex-direction: column; align-items: center;
            width: var(--leaves-success-attribute-size, var(--leaves-success-size, 240px)); max-width: 100%;
            color: var(--leaves-success-attribute-color, var(--leaves-success-color, currentColor)); vertical-align: middle; }
          svg { display: block; width: 100%; height: auto; overflow: visible; }
          circle, path { fill: none; stroke: currentColor; stroke-linecap: round;
            stroke-linejoin: round; }
          .label { margin-top: 2px; text-align: center; color: inherit;
            font: inherit; line-height: 1.5; overflow-wrap: anywhere; }
          .label:empty { display: none; }
          .sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
            overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        </style>
        <svg viewBox="0 0 240 240" aria-hidden="true" focusable="false">
          <g class="mark">
            <circle cx="120" cy="120" r="76" stroke-width="4" pathLength="1"
              stroke-dasharray="1 1" stroke-dashoffset="0" transform="rotate(-90 120 120)" />
            <path d="M84 120 L109 145 L158 94" stroke-width="7" pathLength="1"
              stroke-dasharray="1 1" stroke-dashoffset="0" />
          </g>
        </svg>
        <span class="label" aria-hidden="true"></span>
        <span class="sr" role="status" aria-live="polite" aria-atomic="true"></span>`;
      this._circle = this._root.querySelector('circle');
      this._check = this._root.querySelector('path');
      this._mark = this._root.querySelector('.mark');
      this._label = this._root.querySelector('.label');
      this._status = this._root.querySelector('.sr');
    }

    connectedCallback() { this._syncAttributes(); }
    disconnectedCallback() { this.stop(); }
    attributeChangedCallback() { if (this._label) this._syncAttributes(); }

    _syncAttributes() {
      const text = this.getAttribute('text') || '';
      this._label.textContent = text;
      if (!this._finish) this._status.textContent = text;
      const color = this.getAttribute('color');
      if (color && CSS.supports('color', color)) this.style.setProperty('--leaves-success-attribute-color', color);
      else this.style.removeProperty('--leaves-success-attribute-color');
      const size = this.getAttribute('size');
      if (size && /^\d+(?:\.\d+)?$/.test(size)) this.style.setProperty('--leaves-success-attribute-size', size + 'px');
      else if (size && CSS.supports('width', size)) this.style.setProperty('--leaves-success-attribute-size', size);
      else this.style.removeProperty('--leaves-success-attribute-size');
    }

    _frame(time, reduced) {
      const ring = reduced ? 1 : smooth(progress(time, 0.10, 0.56));
      const check = reduced ? 1 : progress(time, 0.56, 0.88);
      this._circle.style.strokeDashoffset = String(1 - ring);
      this._check.style.strokeDashoffset = String(1 - check);
      this._circle.style.opacity = ring > 0 ? '1' : '0';
      this._check.style.opacity = check > 0 ? '1' : '0';
      const bounce = !reduced && time >= 0.88 && time <= 1.16
        ? 1 + 0.035 * Math.sin(Math.PI * progress(time, 0.88, 1.16)) : 1;
      this._mark.setAttribute('transform', `translate(120 120) scale(${bounce}) translate(-120 -120)`);
      this._label.style.opacity = reduced ? '1' : String(smooth(progress(time, 0.88, 1.08)));
    }

    _scheduleAudio(start, volume) {
      const ctx = sharedAudio;
      if (!ctx || ctx.state !== 'running') return false;
      const voices = [
        { at: 0.57, frequency: 987.7666, strength: 1 },
        { at: 0.70, frequency: 1318.5102, strength: 1.12 }
      ];
      const ratios = [1, 2.01, 3.92];
      const amplitudes = [0.20, 0.07, 0.025];
      const decays = [0.22, 0.12, 0.065];
      voices.forEach((voice) => {
        ratios.forEach((ratio, i) => {
          const oscillator = ctx.createOscillator();
          const envelope = ctx.createGain();
          const onset = start + voice.at;
          const peak = amplitudes[i] * voice.strength * volume;
          oscillator.type = 'sine';
          oscillator.frequency.value = voice.frequency * ratio;
          envelope.gain.setValueAtTime(0, onset);
          envelope.gain.linearRampToValueAtTime(peak, onset + 0.005);
          // Exponential decay to silence; no sampled or downloaded sound.
          envelope.gain.setTargetAtTime(0, onset + 0.005, decays[i]);
          envelope.gain.setValueAtTime(peak * Math.exp(-0.855 / decays[i]), onset + 0.86);
          envelope.gain.linearRampToValueAtTime(0, onset + 0.88);
          oscillator.connect(envelope);
          envelope.connect(ctx.destination);
          const node = { oscillator, envelope };
          this._nodes.push(node);
          oscillator.onended = () => {
            oscillator.disconnect();
            envelope.disconnect();
            const index = this._nodes.indexOf(node);
            if (index >= 0) this._nodes.splice(index, 1);
          };
          oscillator.start(onset);
          oscillator.stop(onset + 0.885);
        });
      });
      return true;
    }

    /** Plays once and keeps the completed mark visible. Never loops. */
    async play(options = {}) {
      this.stop();
      const run = this._run;
      const soundRequested = options.sound === true;
      const numericVolume = Number(options.volume === undefined ? 0.5 : options.volume);
      const volume = Number.isFinite(numericVolume) ? clamp(numericVolume, 0, 1) : 0.5;
      if (options.text !== undefined) this.setAttribute('text', String(options.text));
      this._status.textContent = '';

      let audioReady = false;
      if (soundRequested && volume > 0) audioReady = await LeavesSuccess.unlockAudio();
      if (run !== this._run) return { cancelled: true, audioPlayed: false };

      const reduced = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const lead = 0.02;
      const start = performance.now() + lead * 1000;
      let audioPlayed = false;
      if (audioReady) {
        try { audioPlayed = this._scheduleAudio(sharedAudio.currentTime + lead, volume); }
        catch (_) {
          this._stopAudio();
          audioPlayed = false;
        }
      }
      if (soundRequested && volume > 0 && !audioPlayed) {
        this.dispatchEvent(new CustomEvent('leaves-success-audio-blocked', { bubbles: true, composed: true }));
      }
      this._frame(0, reduced);
      return new Promise((resolve) => {
        this._finish = resolve;
        let announced = false;
        const tick = (now) => {
          if (run !== this._run) return;
          const elapsed = Math.max(0, (now - start) / 1000);
          this._frame(elapsed, reduced);
          if (!announced && (reduced || elapsed >= 0.88)) {
            announced = true;
            this._status.textContent = this.getAttribute('text') || '操作完成';
          }
          if (elapsed < duration) this._raf = requestAnimationFrame(tick);
          else {
            this._raf = 0;
            this._finish = null;
            this.dispatchEvent(new CustomEvent('leaves-success-complete', {
              detail: { audioPlayed }, bubbles: true, composed: true
            }));
            resolve({ cancelled: false, audioPlayed });
          }
        };
        this._raf = requestAnimationFrame(tick);
      });
    }

    _stopAudio() {
      const nodes = this._nodes.splice(0);
      nodes.forEach(({ oscillator, envelope }) => {
        oscillator.onended = null;
        try { oscillator.stop(); } catch (_) { /* May already have ended. */ }
        oscillator.disconnect();
        envelope.disconnect();
      });
    }

    /** Cancels playback, silences this instance, and leaves the final mark visible. */
    stop() {
      this._run += 1;
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._stopAudio();
      if (this._finish) {
        const finish = this._finish;
        this._finish = null;
        finish({ cancelled: true, audioPlayed: false });
      }
      if (this._circle) this._frame(duration, true);
    }
  }

  global.LeavesSuccess = LeavesSuccess;
  customElements.define('leaves-success', LeavesSuccess);
})(window);
