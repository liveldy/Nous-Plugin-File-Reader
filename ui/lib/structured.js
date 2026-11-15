/* 结构化内容的只读视图：JSON 树、CSV 表格、配置分节、XML/HTML 大纲。 */
(function (global) {
  'use strict';

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function chip(text, cls) { return el('span', 'chip' + (cls ? ' ' + cls : ''), text); }

  /* ---------- JSON ---------- */
  function jsonValue(value, depth, key) {
    const row = el('div', 'jt-row');
    if (value !== null && typeof value === 'object') {
      const isArray = Array.isArray(value);
      const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
      const details = document.createElement('details');
      details.className = 'jt-node';
      if (depth < 12 && entries.length <= 5000) details.open = depth < 2;
      const summary = document.createElement('summary');
      if (key !== undefined) {
        summary.appendChild(el('span', 'jt-key', isArray ? key : key));
        summary.appendChild(el('span', 'jt-punct', ': '));
      }
      summary.appendChild(el('span', 'jt-bracket', isArray ? '[' : '{'));
      summary.appendChild(el('span', 'jt-count', entries.length + (isArray ? ' 项' : ' 键')));
      summary.appendChild(el('span', 'jt-bracket', isArray ? ']' : '}'));
      details.appendChild(summary);
      const kids = el('div', 'jt-kids');
      const cap = Math.min(entries.length, 3000);
      for (let i = 0; i < cap; i++) {
        kids.appendChild(jsonValue(entries[i][1], depth + 1, entries[i][0]));
      }
      if (entries.length > cap) kids.appendChild(el('div', 'jt-more', '还有 ' + (entries.length - cap) + ' 项'));
      details.appendChild(kids);
      row.appendChild(details);
      return row;
    }
    if (key !== undefined) {
      row.appendChild(el('span', 'jt-key', key));
      row.appendChild(el('span', 'jt-punct', ': '));
    }
    if (typeof value === 'string') row.appendChild(el('span', 'jt-str', JSON.stringify(value)));
    else if (typeof value === 'number') row.appendChild(el('span', 'jt-num', value));
    else if (typeof value === 'boolean') row.appendChild(el('span', 'jt-bool', String(value)));
    else row.appendChild(el('span', 'jt-null', 'null'));
    return row;
  }

  function jsonView(text) {
    const wrap = el('div', 'jt');
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      const err = el('div', 'parse-error');
      err.appendChild(el('strong', null, 'JSON 解析失败'));
      err.appendChild(el('p', null, e.message));
      const pos = /position (\d+)/.exec(e.message);
      if (pos) {
        const at = Number(pos[1]);
        const around = text.slice(Math.max(0, at - 90), at + 90);
        err.appendChild(el('pre', null, around));
      }
      wrap.appendChild(err);
      return { node: wrap, ok: false };
    }
    wrap.appendChild(jsonValue(data, 0));
    return { node: wrap, ok: true };
  }

  /* ---------- CSV / TSV ---------- */
  function parseDelimited(text, sep) {
    const rows = [];
    let row = [], field = '', quote = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quote = false;
        } else field += ch;
      } else if (ch === '"') quote = true;
      else if (ch === sep) { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* 跳过 */ }
      else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
  }

  function guessSep(text, ext) {
    if (ext === 'tsv') return '\t';
    if (ext === 'psv') return '|';
    const head = text.slice(0, 4000).split('\n').slice(0, 8).join('\n');
    const counts = { ',': (head.match(/,/g) || []).length, '\t': (head.match(/\t/g) || []).length, ';': (head.match(/;/g) || []).length };
    let best = ',';
    for (const k of Object.keys(counts)) if (counts[k] > counts[best]) best = k;
    return best;
  }

  function tableView(text, ext) {
    const sep = guessSep(text, ext);
    const rows = parseDelimited(text, sep);
    const wrap = el('div', 'csv');
    if (!rows.length) { wrap.appendChild(el('div', 'parse-error', '没有可显示的行')); return { node: wrap, rows: 0, cols: 0 }; }
    const cols = Math.max.apply(null, rows.slice(0, 200).map(r => r.length));
    let head = rows[0];
    let body = rows.slice(1);
    const numeric = body.length > 1 && body.slice(0, 50).every(r => r.slice(0, Math.min(cols, 6)).every(c => c === '' || /^-?[\d.,%]+$/.test(c)));
    if (!numeric && body.length === 0) { head = rows[0]; body = []; }

    const table = el('table', 'csv-table');
    const thead = el('thead');
    const htr = el('tr');
    const corner = el('th', 'csv-rownum');
    corner.textContent = '#';
    htr.appendChild(corner);
    for (let c = 0; c < cols; c++) {
      const th = el('th');
      th.textContent = head[c] !== undefined ? head[c] : '';
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = el('tbody');
    const cap = Math.min(body.length, 2000);
    for (let r = 0; r < cap; r++) {
      const tr = el('tr');
      const num = el('td', 'csv-rownum');
      num.textContent = String(r + 1);
      tr.appendChild(num);
      for (let c = 0; c < cols; c++) {
        const td = el('td');
        const v = body[r][c];
        td.textContent = v === undefined ? '' : v;
        if (v !== undefined && /^-?[\d.,%]+$/.test(v) && v !== '') td.classList.add('num');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return { node: wrap, rows: rows.length, cols: cols, more: body.length - cap, sep: sep };
  }

  /* ---------- INI / TOML / YAML ---------- */
  function unquote(v) {
    v = v.trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
    return v;
  }

  function configView(text, format) {
    const wrap = el('div', 'cfg');
    const sections = [];
    if (format === 'yaml' || format === 'yml') {
      let current = { name: '', items: [] };
      let lastKey = null;
      text.split(/\r?\n/).forEach(raw => {
        if (!raw.trim() || /^\s*#/.test(raw)) return;
        const indent = raw.match(/^\s*/)[0].length;
        const m = /^\s*([^:#]+):\s*(.*)$/.exec(raw);
        if (m) {
          const key = m[1].trim();
          const value = m[2].trim();
          if (indent === 0 && !value) {
            sections.push(current);
            current = { name: key, items: [] };
            lastKey = key;
            return;
          }
          current.items.push({ key: (indent > 0 ? '· '.repeat(Math.floor(indent / 2)) : '') + key, value: value });
          lastKey = key;
        } else if (/^\s*-\s*/.test(raw)) {
          current.items.push({ key: '—', value: raw.replace(/^\s*-\s*/, '') });
        }
      });
      sections.push(current);
    } else if (format === 'toml') {
      let current = { name: '', items: [] };
      text.split(/\r?\n/).forEach(raw => {
        const sec = /^\s*\[([^\]]+)\]/.exec(raw);
        if (sec) { sections.push(current); current = { name: sec[1], items: [] }; return; }
        const m = /^\s*([\w.\-"']+)\s*=\s*(.*)$/.exec(raw);
        if (m) current.items.push({ key: m[1], value: m[2] });
        else if (/^\s*#/.test(raw) || !raw.trim()) { /* 注释 */ }
      });
      sections.push(current);
    } else {
      let current = { name: '', items: [] };
      text.split(/\r?\n/).forEach(raw => {
        const sec = /^\s*\[([^\]]*)\]/.exec(raw);
        if (sec) { sections.push(current); current = { name: sec[1], items: [] }; return; }
        if (!raw.trim() || /^\s*[;#]/.test(raw)) return;
        const idx = raw.search(/[=:]/);
        if (idx < 0) { current.items.push({ key: raw.trim(), value: '' }); return; }
        current.items.push({ key: raw.slice(0, idx).trim(), value: unquote(raw.slice(idx + 1).replace(/^\s*[=:]\s*/, '')) });
      });
      sections.push(current);
    }

    let keys = 0;
    for (const sec of sections) {
      if (!sec.items.length) continue;
      const box = el('div', 'cfg-sec');
      if (sec.name) box.appendChild(el('h3', 'cfg-name', sec.name));
      const list = el('dl', 'cfg-list');
      for (const item of sec.items) {
        keys++;
        const dt = el('dt');
        dt.appendChild(el('span', 'cfg-key', item.key));
        const dd = el('dd');
        const raw = item.value;
        const val = el('span', 'cfg-val');
        val.textContent = raw;
        if (/^(true|false)$/i.test(raw)) val.className = 'cfg-val v-bool';
        else if (/^-?\d+(\.\d+)?$/.test(raw)) val.className = 'cfg-val v-num';
        else if (/^["'].*["']$/.test(raw)) val.className = 'cfg-val v-str';
        dd.appendChild(val);
        list.appendChild(dt);
        list.appendChild(dd);
      }
      box.appendChild(list);
      wrap.appendChild(box);
    }
    if (!keys) wrap.appendChild(el('div', 'parse-error', '没有识别到键值，请查看源码'));
    return { node: wrap, keys: keys, sections: sections.filter(s => s.items.length).length };
  }

  /* ---------- XML / HTML 大纲 ---------- */
  function outlineView(text, isHtml) {
    const wrap = el('div', 'outline');
    let doc;
    try {
      doc = new DOMParser().parseFromString(text, isHtml ? 'text/html' : 'application/xml');
    } catch (e) { doc = null; }
    if (!doc) { wrap.appendChild(el('div', 'parse-error', '文档结构无法解析')); return { node: wrap, tags: 0 }; }
    const err = doc.querySelector('parsererror');
    if (err) {
      wrap.appendChild(el('div', 'parse-error', '结构解析报错：' + (err.textContent || '').split('\n')[0].slice(0, 200)));
    }
    let count = 0;
    const walk = (node, depth) => {
      if (count > 4000) return;
      for (const child of Array.from(node.children || [])) {
        count++;
        const row = el('div', 'ol-row');
        row.style.paddingLeft = (8 + depth * 16) + 'px';
        const tag = el('span', 'ol-tag', '<' + child.tagName.toLowerCase() + '>');
        row.appendChild(tag);
        const attrs = Array.from(child.attributes || []).slice(0, 6);
        for (const a of attrs) {
          row.appendChild(el('span', 'ol-attr', ' ' + a.name + '='));
          row.appendChild(el('span', 'ol-val', '"' + (a.value.length > 40 ? a.value.slice(0, 40) + '…' : a.value) + '"'));
        }
        const own = Array.from(child.childNodes).filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
        if (own) row.appendChild(el('span', 'ol-text', ' ' + (own.length > 60 ? own.slice(0, 60) + '…' : own)));
        wrap.appendChild(row);
        walk(child, depth + 1);
      }
    };
    const root = isHtml ? (doc.body || doc.documentElement) : doc.documentElement;
    if (root && !isHtml) {
      const head = el('div', 'ol-row');
      head.appendChild(el('span', 'ol-tag', '<' + root.tagName.toLowerCase() + '>'));
      wrap.appendChild(head);
      walk(root, 1);
    } else if (root) walk(root, 0);
    return { node: wrap, tags: count };
  }

  global.DawnStructured = { jsonView: jsonView, tableView: tableView, configView: configView, outlineView: outlineView };
})(typeof globalThis !== 'undefined' ? globalThis : window);
