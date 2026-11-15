/* 二进制阅读：十六进制视图（按块读取，支持超大文件）与常见容器签名解析。 */
(function (global) {
  'use strict';

  const ROW = 24;
  const BLOCK = 64 * 1024;

  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function u16(bytes, at, le) { return (bytes[at] | (bytes[at + 1] << 8)); }
  function u32(b, at, le) {
    return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  }
  function str(b, at, len) {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(b[at + i]);
    return s;
  }

  function analyze(bytes, size) {
    const facts = [];
    let kind = '未识别的数据';
    const sig = str(bytes, 0, 2);
    if (sig === 'MZ') {
      const peOff = u32(bytes, 0x3c, true);
      if (str(bytes, peOff, 4) === 'PE\u0000\u0000') {
        const machine = u16(bytes, peOff + 4, true);
        const sections = u16(bytes, peOff + 6, true);
        const subsystem = u16(bytes, peOff + 24 + 68, true);
        const machines = { 0x14c: 'x86 (32 位)', 0x8664: 'x86-64', 0xaa64: 'ARM64', 0x1c0: 'ARM' };
        const systems = { 2: '图形界面 (Windows)', 3: '控制台 (CUI)', 1: '原生' };
        kind = 'Windows 可执行文件 (PE)';
        facts.push(['架构', machines[machine] || '0x' + machine.toString(16)]);
        facts.push(['节区', sections + ' 个']);
        facts.push(['子系统', systems[subsystem] || String(subsystem)]);
        facts.push(['PE 头偏移', '0x' + peOff.toString(16)]);
      } else kind = 'MS-DOS 可执行文件';
    } else if (str(bytes, 0, 4) === '\u007fELF') {
      kind = 'ELF 可执行文件 / 库';
      facts.push(['位数', bytes[4] === 2 ? '64 位' : '32 位']);
      facts.push(['字节序', bytes[5] === 2 ? '大端' : '小端']);
      const type = u16(bytes, 16, bytes[5] !== 2);
      const types = { 1: '可重定位文件', 2: '可执行', 3: '共享库', 4: '核心转储' };
      facts.push(['类型', types[type] || String(type)]);
    } else if (/^glTF/.test(str(bytes, 0, 4))) {
      kind = 'glTF 二进制模型 (GLB)';
      const version = u32(bytes, 4, true);
      const total = u32(bytes, 8, true);
      const jsonLen = u32(bytes, 12, true);
      const jsonType = str(bytes, 16, 4);
      facts.push(['版本', String(version)]);
      facts.push(['长度', total + ' 字节']);
      if (jsonType === 'JSON') {
        try {
          const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + Math.min(jsonLen, 200000))).replace(/\u0000+$/, ''));
          facts.push(['节点', (json.nodes || []).length + '']);
          facts.push(['网格', (json.meshes || []).length + '']);
          facts.push(['材质', (json.materials || []).length + '']);
          facts.push(['生成器', (json.asset && json.asset.generator) || '—']);
        } catch (e) { /* JSON 截断 */ }
      }
    } else if (str(bytes, 0, 4) === '%PDF') {
      kind = 'PDF 文档';
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(4096, bytes.length)));
      const ver = /%PDF-(\d\.\d)/.exec(head);
      facts.push(['版本', ver ? ver[1] : '—']);
    } else if (str(bytes, 4, 4) === 'ftyp') {
      kind = 'ISO 媒体容器 (MP4/MOV)';
      facts.push(['品牌', str(bytes, 8, 4).trim()]);
    } else if (str(bytes, 0, 4) === 'PK\u0003\u0004') {
      kind = 'ZIP 压缩包 / Office 文档';
    } else if (str(bytes, 0, 15) === 'SQLite format 3') {
      kind = 'SQLite 数据库';
      const pageSize = u16(bytes, 16, false);
      facts.push(['页大小', pageSize + ' 字节']);
      facts.push(['写版本', String(bytes[18])]);
    } else if (str(bytes, 0, 4) === '\u0000asm') {
      kind = 'WebAssembly 模块';
      facts.push(['版本', String(u32(bytes, 4, true))]);
    } else if (str(bytes, 0, 4) === 'wOFF' || str(bytes, 0, 4) === 'wOF2') {
      kind = '网页字体';
      const numTables = u16(bytes, 12, true);
      facts.push(['字体表', numTables + ' 个']);
    } else if (bytes[0] === 0x89 && str(bytes, 1, 3) === 'PNG') {
      kind = 'PNG 图像';
      facts.push(['宽高', u32(bytes, 16, false) + ' × ' + u32(bytes, 20, false)]);
      facts.push(['位深/色彩', bytes[24] + ' 位 / 类型 ' + bytes[25]]);
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      kind = 'JPEG 图像';
      let p = 2;
      while (p < Math.min(bytes.length, 65536)) {
        if (bytes[p] !== 0xff) { p++; continue; }
        const marker = bytes[p + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const h = u16(bytes, p + 5, false), w = u16(bytes, p + 7, false);
          facts.push(['宽高', w + ' × ' + h]);
          break;
        }
        p += 2 + u16(bytes, p + 2, false);
      }
    } else if (str(bytes, 0, 4) === 'RIFF') {
      kind = 'RIFF 容器 (' + str(bytes, 8, 4).trim() + ')';
      facts.push(['负载', (u32(bytes, 4, true) + 8) + ' 字节']);
    } else if (str(bytes, 0, 4) === 'OggS') kind = 'Ogg 媒体流';
    else if (str(bytes, 0, 4) === 'fLaC') kind = 'FLAC 音频';
    else if (str(bytes, 0, 3) === 'ID3') kind = 'MP3 音频（带 ID3 标签）';
    else if (bytes[0] === 0x1f && bytes[1] === 0x8b) kind = 'GZIP 压缩流';
    else if (str(bytes, 0, 2) === 'BM') kind = 'BMP 位图';

    // 一致性统计
    let printable = 0;
    const n = Math.min(bytes.length, 4096);
    for (let i = 0; i < n; i++) {
      const b = bytes[i];
      if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
    }
    facts.push(['可打印字节', Math.round((printable / Math.max(1, n)) * 100) + '%']);
    facts.push(['开头字节', Array.from(bytes.subarray(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')]);
    return { kind: kind, facts: facts };
  }

  function HexView(host, options) {
    this.host = host;
    this.file = options.file;
    this.size = options.file.size;
    this.host.innerHTML = '';
    this.host.classList.add('hex-host');
    this.blocks = new Map();
    this.pending = new Map();

    const head = el('div', 'hex-head');
    head.appendChild(el('span', 'hex-col hex-col--off', '偏移'));
    head.appendChild(el('span', 'hex-col hex-col--bytes', '00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F'));
    head.appendChild(el('span', 'hex-col hex-col--ascii', '文本'));
    this.scroller = el('div', 'hex-scroll');
    this.body = el('div', 'hex-body');
    this.rows = el('div', 'hex-rows');
    this.body.appendChild(this.rows);
    this.scroller.appendChild(this.body);
    this.host.appendChild(head);
    this.host.appendChild(this.scroller);

    this.total = Math.ceil(this.size / 16);
    this.body.style.height = (this.total * ROW) + 'px';
    this.scroller.addEventListener('scroll', () => this.render());
    this.render();
  }

  HexView.prototype.blockAt = function (index) {
    const start = index * BLOCK;
    if (this.blocks.has(start)) return this.blocks.get(start);
    if (this.pending.has(start)) return null;
    this.pending.set(start, true);
    this.file.slice(start, Math.min(this.size, start + BLOCK)).arrayBuffer().then((buf) => {
      this.blocks.set(start, new Uint8Array(buf));
      this.pending.delete(start);
      this.render(true);
    }).catch(() => { this.pending.delete(start); });
    return null;
  };

  HexView.prototype.render = function (force) {
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight || 400;
    const first = Math.max(0, Math.floor(top / ROW) - 3);
    const count = Math.ceil(height / ROW) + 8;
    const last = Math.min(this.total, first + count);
    const frag = document.createDocumentFragment();
    for (let r = first; r < last; r++) {
      const offset = r * 16;
      const blockStart = Math.floor(offset / BLOCK) * BLOCK;
      const block = this.blocks.get(blockStart);
      const row = el('div', 'hex-row');
      row.style.top = (r * ROW) + 'px';
      const off = el('span', 'hex-off');
      off.textContent = offset.toString(16).padStart(8, '0');
      row.appendChild(off);
      const hexCell = el('span', 'hex-bytes');
      const asciiCell = el('span', 'hex-ascii');
      if (!block) {
        hexCell.textContent = '……';
        this.blockAt(blockStart / BLOCK);
      } else {
        const local = offset - blockStart;
        let hexs = '';
        let text = '';
        for (let i = 0; i < 16; i++) {
          if (local + i >= block.length) { hexs += '   '; text += ' '; continue; }
          const b = block[local + i];
          hexs += b.toString(16).padStart(2, '0') + (i === 7 ? '  ' : ' ');
          text += b >= 32 && b < 127 ? String.fromCharCode(b) : '·';
        }
        hexCell.textContent = hexs;
        asciiCell.textContent = text;
      }
      row.appendChild(hexCell);
      row.appendChild(asciiCell);
      frag.appendChild(row);
    }
    this.rows.innerHTML = '';
    this.rows.appendChild(frag);
  };

  HexView.prototype.goTo = function (offset) {
    const target = Math.max(0, Math.min(this.size - 1, offset));
    this.scroller.scrollTop = Math.floor(target / 16) * ROW - 40;
    this.render();
  };

  HexView.prototype.destroy = function () { this.host.innerHTML = ''; };

  global.DawnBinary = { analyze: analyze, HexView: HexView };
})(typeof globalThis !== 'undefined' ? globalThis : window);
