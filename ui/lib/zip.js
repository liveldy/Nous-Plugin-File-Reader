/* ZIP / Office 文档：读中央目录、按需解压条目，并抽出 docx、xlsx、pptx 的正文。 */
(function (global) {
  'use strict';

  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  async function inflateRaw(bytes, method) {
    if (method === 0) return bytes;
    if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持 DecompressionStream');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZip(file) {
    const tailSize = Math.min(file.size, 66000);
    const tail = new Uint8Array(await file.slice(file.size - tailSize).arrayBuffer());
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('没有找到 ZIP 中央目录');
    const dv = new DataView(tail.buffer, tail.byteOffset + eocd);
    const count = dv.getUint16(10, true);
    const cdSize = dv.getUint32(12, true);
    const cdOffset = dv.getUint32(16, true);
    const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const view = new DataView(cd.buffer, cd.byteOffset);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const crc = view.getUint32(p + 16, true);
      const compSize = view.getUint32(p + 20, true);
      const size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(cd.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name: name, method: method, crc: crc, compressed: compSize, size: size, offset: localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries: entries, file: file };
  }

  async function readEntry(zip, entry) {
    const head = new Uint8Array(await zip.file.slice(entry.offset, entry.offset + 30).arrayBuffer());
    const dv = new DataView(head.buffer, head.byteOffset);
    if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('本地文件头损坏');
    const nameLen = dv.getUint16(26, true);
    const extraLen = dv.getUint16(28, true);
    const start = entry.offset + 30 + nameLen + extraLen;
    const raw = new Uint8Array(await zip.file.slice(start, start + entry.compressed).arrayBuffer());
    return inflateRaw(raw, entry.method);
  }

  async function entryText(zip, name) {
    const entry = zip.entries.find(e => e.name === name);
    if (!entry) return '';
    const bytes = await readEntry(zip, entry);
    return new TextDecoder('utf-8').decode(bytes);
  }

  /* ---------- docx ---------- */
  async function docx(zip) {
    const xml = await entryText(zip, 'word/document.xml');
    if (!xml) return { kind: 'docx', blocks: [] };
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const blocks = [];
    const body = doc.getElementsByTagName('w:body')[0];
    if (!body) return { kind: 'docx', blocks: blocks };
    const walk = (node) => {
      for (const child of Array.from(node.children)) {
        const tag = child.tagName;
        if (tag === 'w:p') {
          const texts = Array.from(child.getElementsByTagName('w:t')).map(t => t.textContent).join('');
          const style = child.getElementsByTagName('w:pStyle')[0];
          const level = style && /^Heading(\d)$/i.exec(style.getAttribute('w:val') || '');
          if (texts.trim()) blocks.push({ type: level ? 'h' + Math.min(3, Number(level[1])) : 'p', text: texts });
        } else if (tag === 'w:tbl') {
          const rows = Array.from(child.getElementsByTagName('w:tr')).map(tr =>
            Array.from(tr.getElementsByTagName('w:tc')).map(tc => Array.from(tc.getElementsByTagName('w:t')).map(t => t.textContent).join('')));
          if (rows.length) blocks.push({ type: 'table', rows: rows });
        } else if (child.children && child.children.length) walk(child);
      }
    };
    walk(body);
    return { kind: 'docx', blocks: blocks };
  }

  /* ---------- xlsx ---------- */
  async function xlsx(zip) {
    const sharedXml = await entryText(zip, 'xl/sharedStrings.xml');
    const shared = [];
    if (sharedXml) {
      const doc = new DOMParser().parseFromString(sharedXml, 'application/xml');
      for (const si of Array.from(doc.getElementsByTagName('si'))) {
        shared.push(Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join(''));
      }
    }
    const wb = await entryText(zip, 'xl/workbook.xml');
    const names = [];
    if (wb) {
      const doc = new DOMParser().parseFromString(wb, 'application/xml');
      for (const s of Array.from(doc.getElementsByTagName('sheet'))) names.push(s.getAttribute('name') || 'Sheet');
    }
    const sheetFiles = zip.entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name)).sort();
    const sheets = [];
    for (let i = 0; i < sheetFiles.length; i++) {
      const xml = await entryText(zip, sheetFiles[i].name);
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const rows = [];
      for (const row of Array.from(doc.getElementsByTagName('row'))) {
        const cells = [];
        for (const c of Array.from(row.getElementsByTagName('c'))) {
          const ref = c.getAttribute('r') || '';
          const col = colIndex(ref);
          const type = c.getAttribute('t');
          const v = c.getElementsByTagName('v')[0];
          let value = '';
          if (type === 's' && v) value = shared[Number(v.textContent)] || '';
          else if (type === 'inlineStr') value = Array.from(c.getElementsByTagName('t')).map(t => t.textContent).join('');
          else if (v) value = v.textContent;
          cells[col] = value;
        }
        rows.push(cells);
        if (rows.length > 3000) break;
      }
      sheets.push({ name: names[i] || 'Sheet' + (i + 1), rows: rows });
    }
    return { kind: 'xlsx', sheets: sheets };
  }

  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref);
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  /* ---------- pptx ---------- */
  async function pptx(zip) {
    const slides = zip.entries.filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
      .sort((a, b) => Number(/(\d+)/.exec(a.name)[1]) - Number(/(\d+)/.exec(b.name)[1]));
    const out = [];
    for (const s of slides.slice(0, 200)) {
      const xml = await entryText(zip, s.name);
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const texts = Array.from(doc.getElementsByTagName('a:t')).map(t => t.textContent).filter(Boolean);
      out.push(texts);
    }
    return { kind: 'pptx', slides: out };
  }

  global.DawnZip = { readZip: readZip, readEntry: readEntry, entryText: entryText, docx: docx, xlsx: xlsx, pptx: pptx };
})(typeof globalThis !== 'undefined' ? globalThis : window);
