/* mp4/mov 播放：WebCodecs 解码 + canvas 上屏，音频走 Web Audio 调度。
   宿主沙箱禁用了 <audio>/<video>/blob:，所以整条链路都自己走。 */
(function (global) {
  'use strict';

  const MP4 = global.DawnMp4;

  function type(view, at) {
    let s = '';
    for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(at + i));
    return s;
  }
  async function slice(file, start, end) {
    return new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());
  }

  async function topBoxes(file) {
    const list = [];
    let p = 0, guard = 0;
    while (p + 8 <= file.size && guard++ < 512) {
      const head = new DataView(await slice(file, p, Math.min(p + 16, file.size)).then(b => b.buffer));
      let size = head.getUint32(0);
      const name = type(head, 4);
      let header = 8;
      if (size === 1) { size = Number(head.getBigUint64(8)); header = 16; }
      else if (size === 0) size = file.size - p;
      if (size < header) break;
      list.push({ type: name, start: p, size: size, header: header });
      p += size;
    }
    return list;
  }

  function brandsOf(view) {
    const list = [];
    list.push(type(view, 0));
    const n = (view.byteLength - 8) / 4;
    for (let i = 0; i < n; i++) {
      const b = type(view, 8 + i * 4);
      if (b.trim()) list.push(b);
    }
    return Array.from(new Set(list));
  }

  async function inspect(file) {
    const boxes = await topBoxes(file);
    const ftyp = boxes.find(b => b.type === 'ftyp');
    const moov = boxes.find(b => b.type === 'moov');
    const brands = ftyp ? brandsOf(new DataView((await slice(file, ftyp.start, ftyp.start + ftyp.size)).buffer)) : [];
    if (!moov) {
      return { error: boxes.some(b => b.type === 'moof') ? 'fragmented' : 'no-moov', brands: brands, boxes: boxes };
    }
    const buffer = await slice(file, moov.start, moov.start + moov.size);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const info = MP4.parseMoov(view, { type: 'moov', start: moov.header, end: view.byteLength, box: 0 }, brands);
    info.boxes = boxes.map(b => ({ type: b.type, size: b.size }));
    return info;
  }

  class Player {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.playing = false;
      this.time = 0;
      this.rate = 1;
      this.volume = 1;
      this.muted = false;
      this.range = null;
      this.frames = [];
      this.audioSources = [];
      this.audioAnchor = 0;
      this.lastWall = 0;
      this.disposed = false;
      this.onstate = null;
      this.onerror = null;
    }

    async load(file) {
      this.file = file;
      const info = await inspect(file);
      this.info = info;
      if (info.error) return info;
      this.video = (info.tracks || []).find(t => t.kind === 'video') || null;
      this.audio = (info.tracks || []).find(t => t.kind === 'audio') || null;
      this.duration = info.duration || (this.video ? this.video.seconds : 0) || (this.audio ? this.audio.seconds : 0);
      this.canvas.width = this.video ? this.video.width : 960;
      this.canvas.height = this.video ? this.video.height : 540;
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.tooLarge = file.size > 512 * 1024 * 1024;
      return info;
    }

    supports() {
      const out = { video: false, audio: false, reason: '' };
      if (this.tooLarge) { out.reason = 'too-large'; return out; }
      if (!this.video && !this.audio) { out.reason = 'no-tracks'; return out; }
      if (typeof global.VideoDecoder === 'undefined' && this.video) { out.reason = 'no-webcodecs'; return out; }
      if (!this.video) out.video = true;
      else {
        try {
          this.ensureVideo();
          out.video = true;
        } catch (e) { out.reason = String(e.message || e); }
      }
      if (this.audio && typeof global.AudioDecoder !== 'undefined') out.audio = true;
      return out;
    }

    ensureVideo() {
      if (this.vd && this.vd.state !== 'closed') return this.vd;
      if (typeof global.VideoDecoder === 'undefined') throw new Error('no-webcodecs');
      const self = this;
      this.vd = new global.VideoDecoder({
        output: function (frame) { self.pushFrame(frame); },
        error: function (e) { self.fail(e); },
      });
      this.configureVideo();
      this.es = 0;
      this.frames = [];
      return this.vd;
    }

    configureVideo() {
      if (!this.vd || this.vd.state === 'closed') return;
      const cfg = {
        codec: this.video.codec,
        codedWidth: this.video.width,
        codedHeight: this.video.height,
        optimizeForLatency: true,
      };
      if (this.video.description && /avc|hvc/.test(this.video.codec)) cfg.description = this.video.description;
      this.vd.configure(cfg);
    }

    fail(error) {
      this.lastError = error;
      this.decodeError = String((error && error.message) || error);
      if (this.onerror) this.onerror(error);
    }

    pushFrame(frame) {
      this.frames.push({ ts: frame.timestamp / 1e6, frame: frame });
      while (this.frames.length > 8) {
        const old = this.frames.shift();
        try { old.frame.close(); } catch (e) { /* 已关闭 */ }
      }
      if (!this.playing) this.paint(this.time);
    }

    // 释放回放位置之前、以及过量的帧：解码器不做背压就会卡在 flush 上
    prune(before) {
      const keep = [];
      for (const f of this.frames) {
        if (f.ts < before) { try { f.frame.close(); } catch (e) { /* noop */ } }
        else keep.push(f);
      }
      while (keep.length > 8) {
        const old = keep.shift();
        try { old.frame.close(); } catch (e) { /* noop */ }
      }
      this.frames = keep;
    }

    videoTime(sample) {
      return sample.cts / this.video.timescale;
    }

    dropFrames() {
      for (const f of this.frames) { try { f.frame.close(); } catch (e) { /* noop */ } }
      this.frames = [];
    }

    feedVideo(until, force) {
      if (!this.video) return;
      const vd = this.ensureVideo();
      if (!vd || vd.state !== 'configured') return;
      const samples = this.video.samples;
      let guard = 0;
      while (this.es < samples.length && (force ? guard++ < 240 : vd.decodeQueueSize < 8)) {
        const s = samples[this.es];
        if (this.videoTime(s) > until) break;
        let chunk;
        try {
          chunk = new global.EncodedVideoChunk({
            type: s.key ? 'key' : 'delta',
            timestamp: Math.round(s.cts * 1e6 / this.video.timescale),
            duration: Math.round(Math.max(1, s.duration) * 1e6 / this.video.timescale),
            data: new Uint8Array(this.buffer, s.offset, s.size),
          });
          vd.decode(chunk);
        } catch (e) {
          this.fail(e);
          return;
        }
        this.es++;
        if (force && vd.decodeQueueSize > 32) break;
      }
    }

    async ensureBuffer() {
      if (this.buffer) return this.buffer;
      this.buffer = await this.file.arrayBuffer();
      this.bytes = new Uint8Array(this.buffer);
      return this.buffer;
    }

    paint(time) {
      if (!this.frames.length) return;
      let pick = null;
      for (const f of this.frames) {
        if (f.ts <= time + 1e-3 && (!pick || f.ts > pick.ts)) pick = f;
      }
      if (!pick) {
        for (const f of this.frames) if (!pick || f.ts < pick.ts) pick = f;
      }
      if (!pick) return;
      try {
        this.ctx.drawImage(pick.frame, 0, 0, this.canvas.width, this.canvas.height);
        this.drawTime = pick.ts;
      } catch (e) { /* 帧已关闭 */ }
    }

    ensureAudio() {
      if (this.ac) return this.ac;
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return null;
      this.ac = new Ctx();
      this.gain = this.ac.createGain();
      this.gain.connect(this.ac.destination);
      return this.ac;
    }

    startAudioDecoder() {
      if (!this.audio || typeof global.AudioDecoder === 'undefined' || this.ad) return;
      const self = this;
      this.ad = new global.AudioDecoder({
        output: function (data) { self.queueAudio(data); },
        error: function (e) { self.fail(e); },
      });
      const cfg = { codec: this.audio.codec, sampleRate: this.audio.sampleRate, numberOfChannels: this.audio.channels };
      if (this.audio.description) cfg.description = this.audio.description;
      this.ad.configure(cfg);
      this.audioFedTo = -1;
    }

    queueAudio(data) {
      const ctx = this.ac;
      if (!ctx || this.disposed) { try { data.close(); } catch (e) { /* noop */ } return; }
      const start = data.timestamp / 1e6;
      const frames = data.numberOfFrames;
      const ch = data.numberOfChannels;
      if (frames > 0) {
        const buffer = ctx.createBuffer(ch, frames, data.sampleRate);
        for (let c = 0; c < ch; c++) {
          const arr = new Float32Array(frames);
          data.copyTo(arr, { planeIndex: c, format: 'f32-planar' });
          buffer.copyToChannel(arr, c);
        }
        const when = this.audioAnchor + start;
        if (when > ctx.currentTime - 0.08) {
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(this.gain);
          src.start(Math.max(when, ctx.currentTime));
          this.audioSources.push(src);
          if (this.audioSources.length > 120) this.audioSources.shift();
        }
      }
      try { data.close(); } catch (e) { /* noop */ }
    }

    async feedAudio(until) {
      this.startAudioDecoder();
      if (!this.ad) return;
      const samples = this.audio.samples;
      while (this.audioFedTo + 1 < samples.length && this.ad.decodeQueueSize < 24) {
        const i = this.audioFedTo + 1;
        const s = samples[i];
        const t = s.cts / this.audio.timescale;
        if (t > until) break;
        const chunk = new global.EncodedAudioChunk({
          type: 'key',
          timestamp: Math.round(s.cts * 1e6 / this.audio.timescale),
          duration: Math.round(Math.max(1, s.duration) * 1e6 / this.audio.timescale),
          data: new Uint8Array(this.buffer, s.offset, s.size),
        });
        this.ad.decode(chunk);
        this.audioFedTo = i;
      }
    }

    async seek(time, options) {
      const t = Math.max(0, Math.min(this.duration || 0, time));
      const quiet = options && options.quiet;
      this.stopAudio();
      this.time = t;
      await this.ensureBuffer();
      if (this.video) {
        const vd = this.ensureVideo();
        if (vd) {
          try { vd.reset(); } catch (e) { /* noop */ }
          this.configureVideo();
          this.dropFrames();
          this.es = this.keyBefore(t);
          const started = performance.now();
          let guard = 0;
          while (guard++ < 600 && performance.now() - started < 4000) {
            this.feedVideo(t + 0.25, false);
            if (this.frames.some(f => f.ts >= t - 1e-3)) break;
            if (this.es >= this.video.samples.length) break;
            await new Promise(r => setTimeout(r, 10));
            this.prune(t - 0.4);
          }
          this.prune(t - 1.5);
          this.paint(t);
        }
      }
      if (this.audio) {
        const samples = this.audio.samples;
        let i = 0;
        for (; i < samples.length; i++) if (samples[i].cts / this.audio.timescale > t) break;
        this.audioFedTo = i - 1;
        if (this.ac) this.audioAnchor = this.ac.currentTime - t;
        await this.feedAudio(t + 1.2);
      }
      if (!quiet) this.emit();
    }

    keyBefore(t) {
      const samples = this.video.samples;
      let key = 0;
      const limit = Math.min(samples.length, 200000);
      for (let i = 0; i < limit; i++) {
        const s = samples[i];
        if (s.key && this.videoTime(s) <= t + 1e-6) key = i;
      }
      return key;
    }

    async play() {
      if (this.playing) return;
      if (this.range && this.time >= this.range[1] - 0.01) await this.seek(this.range[0], { quiet: true });
      this.playing = true;
      this.ac = this.ensureAudio();
      if (this.ac && this.ac.state === 'suspended') await this.ac.resume().catch(() => {});
      await this.ensureBuffer();
      if (this.ac) this.audioAnchor = this.ac.currentTime - this.time;
      if (this.audio) await this.feedAudio(this.time + 1.5);
      this.lastWall = performance.now();
      this.ensureVideo();
      this.feedVideo(this.time + 0.4);
      this.tick();
      this.emit();
    }

    pause() {
      if (!this.playing) return;
      this.playing = false;
      this.stopAudio();
      this.emit();
    }

    stopAudio() {
      for (const s of this.audioSources) { try { s.stop(); } catch (e) { /* noop */ } }
      this.audioSources = [];
    }

    tick() {
      if (!this.playing || this.disposed) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - this.lastWall) / 1000) * this.rate;
      this.lastWall = now;
      if (this.ac && this.audio && this.ac.state === 'running') {
        const clock = this.ac.currentTime - this.audioAnchor;
        if (Math.abs(clock - this.time) < 0.5) this.time = clock;
        else this.time += dt;
      } else {
        this.time += dt;
      }
      const end = this.range ? this.range[1] : this.duration;
      if (this.time >= end) {
        this.time = end;
        this.pause();
        return;
      }
      this.feedVideo(this.time + 0.35);
      if (this.audio) this.feedAudio(this.time + 1.5);
      this.paint(this.time);
      // 丢掉已经用不到的帧，避免长片占内存、并给解码器留出背压空间
      this.prune(this.time - 0.6);
      this.emit();
      this.raf = requestAnimationFrame(() => this.tick());
    }

    setVolume(v) {
      this.volume = v;
      if (this.gain) this.gain.gain.value = this.muted ? 0 : v;
    }
    setMuted(m) {
      this.muted = m;
      if (this.gain) this.gain.gain.value = m ? 0 : this.volume;
    }
    setRange(range) {
      this.range = range && range[1] > range[0] ? range : null;
    }
    emit() {
      if (this.onstate) this.onstate({ time: this.time, playing: this.playing, duration: this.duration });
    }
    destroy() {
      this.disposed = true;
      this.playing = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.stopAudio();
      for (const f of this.frames) { try { f.frame.close(); } catch (e) { /* noop */ } }
      this.frames = [];
      try { if (this.vd) this.vd.close(); } catch (e) { /* noop */ }
      try { if (this.ad) this.ad.close(); } catch (e) { /* noop */ }
      try { if (this.ac) this.ac.close(); } catch (e) { /* noop */ }
      this.buffer = null;
    }
  }

  global.DawnVideo = { inspect: inspect, Player: Player };
})(typeof globalThis !== 'undefined' ? globalThis : window);
