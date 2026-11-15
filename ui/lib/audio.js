/* 音频阅读：解码成 PCM、画波形、播放与片段（入点/出点）试听。
   宿主禁用 <audio> 与 blob:，所以用 Web Audio 直接播。 */
(function (global) {
  'use strict';

  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function AudioView(host, options) {
    this.host = host;
    this.file = options.file;
    this.onMeta = options.onMeta || function () {};
    this.onState = options.onState || function () {};
    this.playing = false;
    this.range = null;
    this.volume = 0.9;
    this.loop = false;
    this.startAt = 0;
    this.host.innerHTML = '';
    this.host.classList.add('audio-view');
    this.wave = el('div', 'wave');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wave-canvas';
    this.wave.appendChild(this.canvas);
    this.host.appendChild(this.wave);
    this.ctx = this.canvas.getContext('2d');
    this.bind();
    this.load();
  }

  AudioView.prototype.load = async function () {
    const buffer = await this.file.arrayBuffer();
    const Ctx = global.AudioContext || global.webkitAudioContext;
    this.ac = new Ctx();
    try {
      this.audio = await this.ac.decodeAudioData(buffer.slice(0));
    } catch (e) {
      this.host.innerHTML = '';
      const fail = el('div', 'parse-error');
      fail.appendChild(el('strong', null, '这段音频无法解码'));
      fail.appendChild(el('p', null, '浏览器内置解码器支持 WAV、MP3、FLAC、OGG、AAC。'));
      this.host.appendChild(fail);
      return;
    }
    this.duration = this.audio.duration;
    this.time = 0;
    this.peaks = this.computePeaks(1400);
    const info = {
      duration: this.audio.duration,
      sampleRate: this.audio.sampleRate,
      channels: this.audio.numberOfChannels,
      peak: this.peakLevel,
    };
    this.onMeta(info);
    this.resize();
    window.addEventListener('resize', this.onResize = () => this.resize());
  };

  AudioView.prototype.computePeaks = function (buckets) {
    const data = this.audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / buckets));
    const out = [];
    let peak = 0;
    for (let b = 0; b < buckets; b++) {
      let min = 0, max = 0;
      const from = b * step;
      const to = Math.min(data.length, from + step);
      for (let i = from; i < to; i += Math.max(1, Math.floor(step / 400))) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
      out.push([min, max]);
    }
    this.peakLevel = peak;
    return out;
  };

  AudioView.prototype.resize = function () {
    const rect = this.wave.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(320, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(120, Math.floor(rect.height * dpr));
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.draw();
  };

  AudioView.prototype.draw = function () {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const line = css.getPropertyValue('--line').trim() || 'rgba(255,255,255,.12)';
    const accent = css.getPropertyValue('--action').trim() || '#dafa9c';
    const ink = css.getPropertyValue('--ink').trim() || '#fff';

    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    if (!this.peaks) return;
    const mid = H / 2;
    const scale = (H / 2) * 0.92;
    if (this.range) {
      const x1 = (this.range[0] / this.duration) * W;
      const x2 = (this.range[1] / this.duration) * W;
      ctx.fillStyle = 'rgba(218,250,156,.10)';
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), H);
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.moveTo(x1, 0); ctx.lineTo(x1, H);
      ctx.moveTo(x2, 0); ctx.lineTo(x2, H);
      ctx.stroke();
    }
    ctx.fillStyle = ink;
    const n = this.peaks.length;
    const stepX = W / n;
    for (let i = 0; i < n; i++) {
      const [min, max] = this.peaks[i];
      const x = i * stepX;
      const y1 = mid - max * scale;
      const y2 = mid - min * scale;
      ctx.fillRect(x, y1, Math.max(1, stepX * 0.8), Math.max(1, y2 - y1));
    }
    if (this.time !== undefined) {
      const x = (this.time / this.duration) * W;
      ctx.fillStyle = accent;
      ctx.fillRect(x - 1, 0, 2, H);
    }
  };

  AudioView.prototype.bind = function () {
    const timeAt = (clientX) => {
      const rect = this.canvas.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * this.duration;
    };
    let dragFrom = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.duration) return;
      dragFrom = timeAt(e.clientX);
      if (e.shiftKey || this.rangeMode) {
        this.canvas.setPointerCapture(e.pointerId);
      } else {
        this.seek(dragFrom);
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (dragFrom === null) return;
      const t = timeAt(e.clientX);
      this.range = [Math.min(dragFrom, t), Math.max(dragFrom, t)];
      this.draw();
      this.onState({ range: this.range });
    });
    const end = () => { dragFrom = null; this.rangeMode = false; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointerleave', () => { if (dragFrom !== null) end(); });
  };

  AudioView.prototype.seek = function (t) {
    this.time = Math.max(0, Math.min(this.duration, t));
    if (this.playing) { this.stop(); this.play(); }
    else this.draw();
    this.onState({ time: this.time, playing: this.playing, range: this.range });
  };

  AudioView.prototype.play = async function () {
    if (!this.audio) return;
    if (this.ac.state === 'suspended') await this.ac.resume().catch(() => {});
    if (!this.gain) {
      this.gain = this.ac.createGain();
      this.gain.connect(this.ac.destination);
    }
    this.gain.gain.value = this.volume;
    const start = this.range ? Math.max(this.range[0], this.time || 0) : (this.time || 0);
    const stop = this.range ? this.range[1] : this.duration;
    if (stop - start < 0.01) return;
    const src = this.ac.createBufferSource();
    src.buffer = this.audio;
    src.connect(this.gain);
    src.start(0, start, stop - start);
    this.source = src;
    this.playing = true;
    this.startAt = this.ac.currentTime - start;
    src.onended = () => {
      if (!this.playing) return;
      if (this.loop && this.range) { this.time = this.range[0]; this.play(); return; }
      this.playing = false;
      this.time = stop;
      this.draw();
      this.onState({ time: this.time, playing: false, range: this.range });
    };
    this.raf = requestAnimationFrame(() => this.frame());
    this.onState({ time: start, playing: true, range: this.range });
  };

  AudioView.prototype.frame = function () {
    if (!this.playing) return;
    this.time = Math.min(this.duration, this.ac.currentTime - this.startAt);
    this.draw();
    this.onState({ time: this.time, playing: true, range: this.range });
    this.raf = requestAnimationFrame(() => this.frame());
  };

  AudioView.prototype.stop = function () {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.source) { try { this.source.stop(); } catch (e) { /* noop */ } }
    this.source = null;
  };

  AudioView.prototype.setVolume = function (v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  };

  AudioView.prototype.setRange = function (range) {
    this.range = range;
    this.draw();
    this.onState({ range: range, time: this.time || 0, playing: this.playing });
  };

  AudioView.prototype.destroy = function () {
    this.stop();
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    if (this.ac) this.ac.close().catch(() => {});
    this.host.innerHTML = '';
  };

  global.DawnAudio = { AudioView: AudioView };
})(typeof globalThis !== 'undefined' ? globalThis : window);
