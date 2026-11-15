/* 文本解码与基础统计：BOM、UTF-8 校验、GB18030 回退。 */
(function (global) {
  'use strict';

  const LIMIT = 24 * 1024 * 1024;

  function decode(bytes) {
    if (!bytes || !bytes.length) return { text: '', encoding: '空文件', truncated: false };
    let view = bytes, encoding = '';
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      view = bytes.subarray(3); encoding = 'UTF-8 BOM';
    } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      view = bytes.subarray(2); encoding = 'UTF-16 LE';
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      view = bytes.subarray(2); encoding = 'UTF-16 BE';
    }
    const truncated = view.length > LIMIT;
    if (truncated) view = view.subarray(0, LIMIT);

    if (encoding === 'UTF-16 LE' || encoding === 'UTF-16 BE') {
      try {
        return { text: new TextDecoder(encoding === 'UTF-16 LE' ? 'utf-16le' : 'utf-16be').decode(view), encoding: encoding, truncated: truncated };
      } catch (e) { /* 落到下面 */ }
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(view);
      return { text: text, encoding: encoding || 'UTF-8', truncated: truncated };
    } catch (e) { /* 不是 UTF-8 */ }

    const candidates = ['gb18030', 'big5', 'shift_jis', 'utf-16le'];
    let best = null;
    for (const enc of candidates) {
      try {
        const text = new TextDecoder(enc, { fatal: true }).decode(view);
        best = { text: text, encoding: enc === 'gb18030' ? 'GB18030' : enc, truncated: truncated };
        break;
      } catch (err) { /* 下一个 */ }
    }
    if (best) return best;
    const fallback = new TextDecoder('windows-1252').decode(view);
    return { text: fallback, encoding: 'windows-1252', truncated: truncated };
  }

  function stats(text) {
    const lines = text.split('\n');
    let crlf = 0, lf = 0, cr = 0;
    for (let i = 0; i < text.length && i < 4000000; i++) {
      if (text[i] === '\n') { if (i > 0 && text[i - 1] === '\r') crlf++; else lf++; }
      else if (text[i] === '\r' && text[i + 1] !== '\n') cr++;
    }
    const eol = crlf > lf ? 'CRLF' : cr > lf ? 'CR' : 'LF';
    const tabs = (text.match(/\t/g) || []).length;
    return { lines: lines.length, eol: eol, tabs: tabs };
  }

  function bytesText(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  global.DawnText = { decode: decode, stats: stats, bytesText: bytesText, LIMIT: LIMIT };
})(typeof globalThis !== 'undefined' ? globalThis : window);
