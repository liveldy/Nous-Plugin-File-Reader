/* 三维模型阅读：STL / OBJ / PLY / GLB 的结构统计与点云预览。 */
(function (global) {
  'use strict';

  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function bounds() { return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; }
  function grow(b, x, y, z) {
    if (x < b.min[0]) b.min[0] = x;
    if (y < b.min[1]) b.min[1] = y;
    if (z < b.min[2]) b.min[2] = z;
    if (x > b.max[0]) b.max[0] = x;
    if (y > b.max[1]) b.max[1] = y;
    if (z > b.max[2]) b.max[2] = z;
  }

  function parseStl(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(80, bytes.length)));
    const ascii = /^\s*solid/.test(head) && !/facet/.test(head) ? true : /^\s*solid/.test(head);
    if (ascii && bytes.length > 84) {
      const count = view.getUint32(80, true);
      if (84 + count * 50 === bytes.length) return parseStlBinary(bytes, count);
    }
    if (ascii) return parseStlAscii(new TextDecoder('utf-8').decode(bytes));
    const count = view.getUint32(80, true);
    return parseStlBinary(bytes, count);
  }

  function parseStlBinary(bytes, count) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const b = bounds();
    const points = [];
    const stride = Math.max(1, Math.floor(count / 4000));
    for (let i = 0; i < count; i++) {
      const base = 84 + i * 50 + 12;
      for (let v = 0; v < 3; v++) {
        const x = view.getFloat32(base + v * 12, true);
        const y = view.getFloat32(base + v * 12 + 4, true);
        const z = view.getFloat32(base + v * 12 + 8, true);
        grow(b, x, y, z);
        if (i % stride === 0) points.push([x, y, z]);
      }
    }
    return { triangles: count, points: points, bounds: b, ascii: false };
  }

  function parseStlAscii(text) {
    const b = bounds();
    const points = [];
    let tris = 0;
    const re = /vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g;
    let m;
    while ((m = re.exec(text))) {
      const x = Number(m[1]), y = Number(m[2]), z = Number(m[3]);
      grow(b, x, y, z);
      if (points.length < 12000) points.push([x, y, z]);
      if (points.length % 3 === 0) tris++;
    }
    return { triangles: Math.floor(points.length / 3), points: points, bounds: b, ascii: true };
  }

  function parseObj(text) {
    const b = bounds();
    const points = [];
    let vertices = 0, faces = 0, lines = 0, normals = 0, uvs = 0;
    const rows = text.split('\n');
    for (const row of rows) {
      if (row[0] === 'v' && row[1] === ' ') {
        const p = row.trim().split(/\s+/);
        const x = Number(p[1]), y = Number(p[2]), z = Number(p[3]);
        vertices++;
        if (!Number.isNaN(x)) {
          grow(b, x, y, z);
          if (vertices % Math.max(1, Math.floor(rows.length / 6000)) === 0 && points.length < 12000) points.push([x, y, z]);
        }
      } else if (row[0] === 'f' && row[1] === ' ') faces++;
      else if (row[0] === 'l' && row[1] === ' ') lines++;
      else if (row[0] === 'v' && row[1] === 'n') normals++;
      else if (row[0] === 'v' && row[1] === 't') uvs++;
    }
    return { vertices: vertices, faces: faces, lines: lines, normals: normals, uvs: uvs, points: points, bounds: b };
  }

  function parsePly(bytes) {
    const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
    const headerEnd = text.indexOf('end_header');
    const header = text.slice(0, headerEnd < 0 ? 2000 : headerEnd).split(/\r?\n/);
    const info = { vertices: 0, faces: 0, format: '', extra: [] };
    for (const line of header) {
      const m = /^element\s+(\w+)\s+(\d+)/.exec(line);
      if (m) {
        if (m[1] === 'vertex') info.vertices = Number(m[2]);
        if (m[1] === 'face') info.faces = Number(m[2]);
      }
      const f = /^format\s+(\S+)/.exec(line);
      if (f) info.format = f[1];
    }
    return info;
  }

  function parseGlb(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(4, true);
    const jsonLen = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)).replace(/\u0000+$/, ''));
    const out = {
      version: version,
      meshes: (json.meshes || []).length,
      nodes: (json.nodes || []).length,
      materials: (json.materials || []).length,
      animations: (json.animations || []).length,
      generator: (json.asset && json.asset.generator) || '',
      triangles: 0,
      bounds: bounds(),
      points: [],
    };
    for (const mesh of json.meshes || []) {
      for (const prim of mesh.primitives || []) {
        const acc = prim.indices !== undefined ? json.accessors[prim.indices] : null;
        if (acc) out.triangles += Math.floor(acc.count / 3);
        const pos = prim.attributes && prim.attributes.POSITION !== undefined ? json.accessors[prim.attributes.POSITION] : null;
        if (pos && pos.min && pos.max) {
          grow(out.bounds, pos.min[0], pos.min[1], pos.min[2]);
          grow(out.bounds, pos.max[0], pos.max[1], pos.max[2]);
        }
      }
    }
    return out;
  }

  function stats(info) {
    const rows = [];
    if (info.triangles !== undefined) rows.push(['三角面', info.triangles.toLocaleString('zh-CN')]);
    if (info.vertices !== undefined) rows.push(['顶点', info.vertices.toLocaleString('zh-CN')]);
    if (info.faces !== undefined && info.triangles === undefined) rows.push(['面', info.faces.toLocaleString('zh-CN')]);
    if (info.meshes !== undefined) {
      rows.push(['网格', String(info.meshes)]);
      rows.push(['节点', String(info.nodes)]);
      rows.push(['材质', String(info.materials)]);
      if (info.animations) rows.push(['动画', String(info.animations)]);
      if (info.generator) rows.push(['生成器', info.generator]);
    }
    if (info.format) rows.push(['编码', info.format]);
    const b = info.bounds;
    if (b && isFinite(b.min[0])) {
      const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
      rows.push(['包围盒', size.map(v => v.toFixed(2)).join(' × ')]);
      rows.push(['原点范围', b.min.map(v => v.toFixed(1)).join(', ') + ' → ' + b.max.map(v => v.toFixed(1)).join(', ')]);
    }
    return rows;
  }

  /* 点云预览 */
  function Preview(host, points, boundsBox) {
    this.host = host;
    this.points = points || [];
    this.box = boundsBox;
    this.yaw = 0.7;
    this.pitch = 0.42;
    this.host.innerHTML = '';
    this.canvas = el('canvas', 'model-canvas');
    this.host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.center = [
      (boundsBox.min[0] + boundsBox.max[0]) / 2,
      (boundsBox.min[1] + boundsBox.max[1]) / 2,
      (boundsBox.min[2] + boundsBox.max[2]) / 2,
    ];
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw += (e.clientX - drag[0]) * 0.01;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (e.clientY - drag[1]) * 0.01));
      drag = [e.clientX, e.clientY];
      this.draw();
    });
    this.canvas.addEventListener('pointerup', () => { drag = null; });
    window.addEventListener('resize', this.onResize = () => this.draw());
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.draw());
      this.observer.observe(this.host);
    }
    this.draw();
  }

  Preview.prototype.draw = function () {
    const rect = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(320, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(240, Math.floor(rect.height * dpr));
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--action').trim() || '#dafa9c';
    const b = this.box;
    if (!isFinite(b.min[0]) || !this.points.length) {
      ctx.fillStyle = css.getPropertyValue('--muted').trim() || '#888';
      ctx.font = (14 * dpr) + 'px system-ui';
      ctx.fillText('该文件没有可预览的顶点', 24 * dpr, H / 2);
      return;
    }
    const span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1;
    const scale = Math.min(W, H) * 0.42 / span;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const projected = [];
    for (const p of this.points) {
      const x = p[0] - this.center[0], y = p[1] - this.center[1], z = p[2] - this.center[2];
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y1 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      projected.push([W / 2 + x1 * scale, H / 2 - y1 * scale, z2]);
    }
    if (this.points.length <= 2400 && this.points.length % 3 === 0) {
      /* 面数少的时候铺三角面 + 描边，比点云看得清结构。
         分组必须在排序之前：只要按深度给三角排序，别动顶点顺序。 */
      const tris = [];
      for (let i = 0; i + 2 < this.points.length; i += 3) {
        tris.push({
          a: projected[i], b: projected[i + 1], c: projected[i + 2],
          depth: (projected[i][2] + projected[i + 1][2] + projected[i + 2][2]) / 3,
        });
      }
      tris.sort((p, q) => q.depth - p.depth);
      ctx.lineWidth = 1.1 * dpr;
      for (const t of tris) {
        const level = Math.max(0, Math.min(1, 1 - (t.depth + span / 2) / span));
        ctx.beginPath();
        ctx.moveTo(t.a[0], t.a[1]);
        ctx.lineTo(t.b[0], t.b[1]);
        ctx.lineTo(t.c[0], t.c[1]);
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.05 + level * 0.12;
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.36 + level * 0.54;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    projected.sort((a, b2) => a[2] - b2[2]);
    for (const p of projected) {
      const depth = (p[2] + span / 2) / span;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.15 + Math.max(0, Math.min(1, 1 - depth)) * 0.75;
      ctx.fillRect(p[0], p[1], 1.6 * dpr, 1.6 * dpr);
    }
    ctx.globalAlpha = 1;
  };

  Preview.prototype.destroy = function () {
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    if (this.observer) this.observer.disconnect();
    this.host.innerHTML = '';
  };

  global.DawnModel = {
    parse: async function (file, ext) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (ext === 'stl' || /^\s*solid/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 5)))) return parseStl(bytes);
      if (ext === 'obj') return parseObj(new TextDecoder('utf-8').decode(bytes));
      if (ext === 'ply') return parsePly(bytes);
      if (ext === 'glb' || (bytes[0] === 0x67 && bytes[1] === 0x6c)) return parseGlb(bytes);
      if (ext === 'gltf') {
        const json = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        return {
          meshes: (json.meshes || []).length,
          nodes: (json.nodes || []).length,
          materials: (json.materials || []).length,
          generator: (json.asset && json.asset.generator) || '',
          bounds: bounds(),
          points: [],
        };
      }
      return null;
    },
    stats: stats,
    Preview: Preview,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
