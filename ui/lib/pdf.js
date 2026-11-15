/* PDF 阅读：解析文档信息、页数，并从内容流里尽量还原文本层。 */
(function (global) {
  'use strict';

  function latin1(bytes) { return new TextDecoder('latin1').decode(bytes); }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }

  function pdfString(raw) {
    return raw
      .replace(/\\(\d{1,3})/g, (m, oct) => String.fromCharCode(parseInt(oct, 8)))
      .replace(/\\([nrtbf()\\])/g, (m, ch) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[ch] || ch);
  }

  function extractText(content) {
    const out = [];
    const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g;
    const tj = /\[((?:[^\][])*)\]\s*TJ|\((?:\\.|[^\\()])*\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj|(T\*|Td|TD|ET)/g;
    let m;
    while ((m = tj.exec(content))) {
      if (m[1] !== undefined) {
        const parts = m[1].match(re) || [];
        let line = '';
        for (const part of parts) {
          if (part[0] === '(') line += pdfString(part.slice(1, -1));
          else if (part[0] === '<') line += hexString(part.slice(1, -1));
        }
        out.push(line);
      } else if (m[2] !== undefined) {
        out.push(hexString(m[2]));
      } else if (m[3] !== undefined) {
        out.push('\n');
      }
    }
    return out.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  function hexString(hex) {
    const clean = hex.replace(/\s+/g, '');
    if (clean.length % 4 === 0 && /^(00|fe|ff)/i.test(clean.slice(0, 2))) {
      // 常见双字节（UTF-16BE）编码
      let s = '';
      for (let i = 0; i + 3 < clean.length; i += 4) s += String.fromCharCode(parseInt(clean.substr(i, 4), 16));
      return s;
    }
    let s = '';
    for (let i = 0; i + 1 < clean.length; i += 2) s += String.fromCharCode(parseInt(clean.substr(i, 2), 16));
    return s;
  }

  async function read(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = latin1(bytes);
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const version = (/%PDF-(\d\.\d)/.exec(text) || [])[1] || '';
    const encrypted = /\/Encrypt\s/.test(text);
    const producer = (/\/Producer\s*\(([^)]*)\)/.exec(text) || [])[1] || '';
    const title = (/\/Title\s*\(([^)]*)\)/.exec(text) || [])[1] || '';

    const pagesText = [];
    const streamRe = /stream\r?\n/g;
    let m;
    let count = 0;
    while ((m = streamRe.exec(text)) && count < 400) {
      const start = m.index + m[0].length;
      const end = text.indexOf('endstream', start);
      if (end < 0) break;
      const dictStart = text.lastIndexOf('/', m.index);
      const slice = bytes.subarray(start, end);
      const isContent = /\/Contents/.test(text.slice(Math.max(0, m.index - 400), m.index)) || /BT[\s\S]{0,4000}ET/.test(latin1(slice.subarray(0, 600)));
      if (!isContent) continue;
      count++;
      let data = slice;
      if (/\/FlateDecode/.test(text.slice(Math.max(0, m.index - 600), m.index))) {
        const inf = await inflate(slice);
        if (inf) data = inf;
      }
      const body = latin1(data);
      if (!/BT|Tj|TJ/.test(body)) continue;
      const extracted = extractText(body);
      if (extracted) pagesText.push(extracted);
    }
    return {
      version: version,
      pages: pages,
      encrypted: encrypted,
      title: pdfString(title),
      producer: pdfString(producer),
      text: pagesText.join('\n\n'),
      streams: count,
    };
  }

  global.DawnPdf = { read: read };
})(typeof globalThis !== 'undefined' ? globalThis : window);
