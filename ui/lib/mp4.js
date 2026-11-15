/* ISO BMFF (mp4/mov/m4v) 解复用：只做阅读器需要的部分——轨道、编解码器参数与样本表。 */
(function (global) {
  'use strict';

  function readType(view, at) {
    let s = '';
    for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(at + i));
    return s;
  }

  function boxes(view, start, end) {
    const list = [];
    let p = start;
    while (p + 8 <= end) {
      let size = view.getUint32(p);
      const type = readType(view, p + 4);
      let head = 8;
      if (size === 1) {
        if (p + 16 > end) break;
        size = Number(view.getBigUint64(p + 8));
        head = 16;
      } else if (size === 0) size = end - p;
      if (size < head || p + size > end) break;
      list.push({ type: type, start: p + head, end: p + size, box: p });
      p += size;
    }
    return list;
  }

  function child(view, parent, type) {
    if (!parent) return null;
    const list = boxes(view, parent.start, parent.end);
    for (const b of list) if (b.type === type) return b;
    return null;
  }
  function children(view, parent, type) {
    if (!parent) return [];
    return boxes(view, parent.start, parent.end).filter(b => b.type === type);
  }

  function fullBoxVersion(view, box) {
    return view.getUint8(box.start);
  }

  function readMatrixTimescaleDuration(view, box, kind) {
    const v = fullBoxVersion(view, box);
    const out = {};
    if (kind === 'mvhd' || kind === 'mdhd') {
      if (v === 1) {
        out.timescale = view.getUint32(box.start + 20);
        out.duration = Number(view.getBigUint64(box.start + 24));
      } else {
        out.timescale = view.getUint32(box.start + 12);
        out.duration = view.getUint32(box.start + 16);
      }
    }
    return out;
  }

  function hex2(n) { return n.toString(16).padStart(2, '0'); }

  function avcCodec(view, avcC) {
    const b = avcC.start;
    return 'avc1.' + hex2(view.getUint8(b + 1)) + hex2(view.getUint8(b + 2)) + hex2(view.getUint8(b + 3));
  }

  function descriptor(view, at, end) {
    // 读取 MPEG-4 描述符：返回 { tag, start, end, next }
    const tag = view.getUint8(at);
    let p = at + 1, len = 0, n = 0;
    while (p < end && n < 4) {
      const b = view.getUint8(p++);
      len = (len << 7) | (b & 0x7f);
      n++;
      if (!(b & 0x80)) break;
    }
    return { tag: tag, start: p, end: Math.min(p + len, end), next: p + len };
  }

  function esdsConfig(view, esds) {
    const end = esds.end;
    let p = esds.start + 4;
    const top = descriptor(view, p, end);
    if (top.tag !== 0x03) return null;
    let q = top.start + 2; // ES_ID
    const flags = view.getUint8(q++);
    if (flags & 0x80) q += 2;
    if (flags & 0x40) { const l = view.getUint8(q); q += 1 + l; }
    if (flags & 0x20) q += 2;
    const dcd = descriptor(view, q, top.end);
    if (dcd.tag !== 0x04) return null;
    let r = dcd.start + 13;
    const dsi = descriptor(view, r, dcd.end);
    if (dsi.tag !== 0x05) return null;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + dsi.start, dsi.end - dsi.start);
    return { objectType: view.getUint8(dcd.start), config: bytes.slice() };
  }

  function sampleEntry(view, entry) {
    const type = readType(view, entry.box + 4);
    const base = entry.start; // payload 起点
    const info = { format: type };
    if (/^(avc1|avc3|hvc1|hev1|vp08|vp09|av01|mp4v)$/.test(type)) {
      info.kind = 'video';
      info.width = view.getUint16(base + 24);
      info.height = view.getUint16(base + 26);
      const kids = boxes(view, base + 78, entry.end);
      for (const k of kids) {
        if (k.type === 'avcC') {
          info.codec = avcCodec(view, k);
          info.description = new Uint8Array(view.buffer, view.byteOffset + k.start, k.end - k.start).slice();
        } else if (k.type === 'hvcC') {
          const b = k.start;
          const flags = view.getUint8(b + 1);
          info.codec = 'hvc1.' + ['', 'A', 'B', 'C'][(flags >> 6) & 3] + (flags & 0x1f) + '.' +
            view.getUint32(b + 2).toString(16).toUpperCase() + '.' + ((flags >> 5) & 1 ? 'H' : 'L') + view.getUint8(b + 12);
          info.description = new Uint8Array(view.buffer, view.byteOffset + k.start, k.end - k.start).slice();
        } else if (k.type === 'vpcC') {
          info.codec = 'vp09.' + String(view.getUint8(k.start + 4)).padStart(2, '0') + '.' +
            String(view.getUint8(k.start + 5)).padStart(2, '0');
        } else if (k.type === 'av1C') {
          info.codec = 'av01.0.' + String(view.getUint8(k.start + 1) >> 5).padStart(2, '0');
        } else if (k.type === 'pasp') {
          info.par = [view.getUint32(k.start), view.getUint32(k.start + 4)];
        }
      }
    } else if (/^(mp4a|Opus|opus|fLaC|alac|ac-3|ec-3)$/.test(type)) {
      info.kind = 'audio';
      info.channels = view.getUint16(base + 16);
      info.sampleRate = view.getUint32(base + 24) >>> 16;
      const kids = boxes(view, base + 28, entry.end);
      for (const k of kids) {
        if (k.type === 'esds') {
          const cfg = esdsConfig(view, k);
          info.codec = 'mp4a.40.' + (cfg ? cfg.objectType === 0x40 ? 2 : 2 : 2);
          if (cfg) info.description = cfg.config;
        } else if (k.type === 'dOps') {
          info.codec = 'opus';
          info.description = new Uint8Array(view.buffer, view.byteOffset + k.start + 2, 4).slice();
        } else if (k.type === 'dfLa') {
          info.codec = 'flac';
        } else if (k.type === 'wave') {
          for (const w of boxes(view, k.start, k.end)) {
            if (w.type === 'esds') {
              const cfg = esdsConfig(view, w);
              if (cfg) info.description = cfg.config;
            }
          }
        }
      }
    } else {
      info.kind = 'other';
    }
    return info;
  }

  function buildSamples(view, stbl) {
    const stts = child(view, stbl, 'stts');
    const ctts = child(view, stbl, 'ctts');
    const stsc = child(view, stbl, 'stsc');
    const stsz = child(view, stbl, 'stsz');
    const stco = child(view, stbl, 'stco') || child(view, stbl, 'co64');
    const stss = child(view, stbl, 'stss');
    if (!stsz || !stsc || !stco) return { samples: [], count: 0 };

    const sizes = [];
    const uniform = view.getUint32(stsz.start + 4);
    const count = view.getUint32(stsz.start + 8);
    if (uniform) { for (let i = 0; i < count; i++) sizes.push(uniform); }
    else {
      for (let i = 0; i < count; i++) sizes.push(view.getUint32(stsz.start + 12 + i * 4));
    }

    const chunkCount = view.getUint32(stco.start + 4);
    const chunkOffsets = [];
    const wide = readType(view, stco.box + 4) === 'co64';
    for (let i = 0; i < chunkCount; i++) {
      chunkOffsets.push(wide ? Number(view.getBigUint64(stco.start + 8 + i * 8)) : view.getUint32(stco.start + 8 + i * 4));
    }

    const runs = [];
    const runCount = view.getUint32(stsc.start + 4);
    for (let i = 0; i < runCount; i++) {
      runs.push({
        first: view.getUint32(stsc.start + 8 + i * 12),
        per: view.getUint32(stsc.start + 12 + i * 12),
      });
    }

    const offsets = new Array(count);
    let sample = 0;
    for (let c = 0; c < chunkOffsets.length && sample < count; c++) {
      let per = runs[0].per;
      for (const run of runs) if (run.first <= c + 1) per = run.per;
      let off = chunkOffsets[c];
      for (let i = 0; i < per && sample < count; i++) {
        offsets[sample] = off;
        off += sizes[sample];
        sample++;
      }
    }

    const dts = new Array(count);
    let t = 0, s = 0;
    const sttsCount = view.getUint32(stts.start + 4);
    for (let i = 0; i < sttsCount && s < count; i++) {
      const n = view.getUint32(stts.start + 8 + i * 8);
      const delta = view.getUint32(stts.start + 12 + i * 8);
      for (let k = 0; k < n && s < count; k++) { dts[s] = t; t += delta; s++; }
    }
    while (s < count) { dts[s] = t; s++; }

    const cts = dts.slice();
    if (ctts) {
      const version = fullBoxVersion(view, ctts);
      const n = view.getUint32(ctts.start + 4);
      let i = 0;
      for (let e = 0; e < n && i < count; e++) {
        const cnt = view.getUint32(ctts.start + 8 + e * 8);
        const off = version === 1 ? view.getInt32(ctts.start + 12 + e * 8) : view.getUint32(ctts.start + 12 + e * 8);
        for (let k = 0; k < cnt && i < count; k++) cts[i++] += off;
      }
    }

    const sync = new Set();
    if (stss) {
      const n = view.getUint32(stss.start + 4);
      for (let i = 0; i < n; i++) sync.add(view.getUint32(stss.start + 8 + i * 4) - 1);
    }

    const samples = [];
    for (let i = 0; i < count; i++) {
      samples.push({
        offset: offsets[i] || 0,
        size: sizes[i],
        dts: dts[i],
        cts: cts[i],
        duration: (dts[i + 1] !== undefined ? dts[i + 1] : dts[i] + (t ? t / count : 0)) - dts[i],
        key: stss ? sync.has(i) : true,
      });
    }
    return { samples: samples, chunkCount: chunkCount };
  }

  function parse(view) {
    const file = boxes(view, 0, view.byteLength);
    const moov = file.find(b => b.type === 'moov');
    if (!moov) {
      return { error: file.some(b => b.type === 'moof') ? 'fragmented' : 'no-moov', brands: brandList(view, file) };
    }
    return parseMoov(view, moov, brandList(view, file));
  }

  function parseMoov(view, moov, brands) {
    const mvhd = child(view, moov, 'mvhd');
    const head = mvhd ? readMatrixTimescaleDuration(view, mvhd, 'mvhd') : { timescale: 1000, duration: 0 };
    const tracks = [];
    for (const trak of children(view, moov, 'trak')) {
      const tkhd = child(view, trak, 'tkhd');
      const mdia = child(view, trak, 'mdia');
      if (!mdia) continue;
      const mdhd = child(view, mdia, 'mdhd');
      const hdlr = child(view, mdia, 'hdlr');
      const handler = hdlr ? readType(view, hdlr.start + 8) : '';
      const minf = child(view, mdia, 'minf');
      const stbl = child(view, minf, 'stbl');
      const stsd = child(view, stbl, 'stsd');
      if (!stsd) continue;
      const entries = boxes(view, stsd.start + 8, stsd.end);
      const entry = entries[0];
      if (!entry) continue;
      const info = sampleEntry(view, entry);
      const timing = mdhd ? readMatrixTimescaleDuration(view, mdhd, 'mdhd') : head;
      const table = buildSamples(view, stbl);
      const track = {
        id: tracks.length + 1,
        handler: handler,
        kind: info.kind,
        codec: info.codec || info.format,
        format: info.format,
        description: info.description || null,
        width: info.width || 0,
        height: info.height || 0,
        channels: info.channels || 0,
        sampleRate: info.sampleRate || 0,
        timescale: timing.timescale || 1000,
        duration: timing.duration || 0,
        samples: table.samples,
        tkhd: tkhd ? true : false,
      };
      track.seconds = track.timescale ? track.duration / track.timescale : 0;
      tracks.push(track);
    }
    return {
      tracks: tracks,
      duration: head.timescale ? head.duration / head.timescale : 0,
      brands: brands || [],
    };
  }

  function brandList(view, file) {
    const ftyp = file.find(b => b.type === 'ftyp');
    if (!ftyp) return [];
    const list = [];
    const major = readType(view, ftyp.start);
    list.push(major);
    const n = (ftyp.end - ftyp.start - 8) / 4;
    for (let i = 0; i < n; i++) {
      const brand = readType(view, ftyp.start + 8 + i * 4);
      if (brand.trim()) list.push(brand);
    }
    return Array.from(new Set(list));
  }

  global.DawnMp4 = { parse: parse, parseMoov: parseMoov };
})(typeof globalThis !== 'undefined' ? globalThis : window);
