/* Markdown 渲染：标题、段落、列表、引用、代码、表格、链接与强调。 */
(function (global) {
  'use strict';
  const esc = DawnHl.escape;

  function inline(s) {
    let out = esc(s);
    out = out.replace(/`([^`]+)`/g, (m, code) => '<code>' + code + '</code>');
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, src) => {
      return '<span class="md-img">' + (alt || '图片') + '</span>';
    });
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, text, url) => {
      return '<a class="md-link" data-url="' + url.replace(/"/g, '&quot;') + '" href="#">' + text + '</a>';
    });
    out = out.replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, (m, pre, url) => pre + '<a class="md-link" data-url="' + url + '" href="#">' + url + '</a>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    out = out.replace(/\b__([^_]+)__\b/g, '<strong>$1</strong>');
    return out;
  }

  function codeBlock(lines, lang) {
    let body;
    if (lang && DawnHl.LANGS[lang]) {
      const text = lines.join('\n');
      const hl = DawnHl.highlightLines(text, lang);
      body = hl.map(l => '<span class="md-code-line">' + (l || ' ') + '</span>').join('');
    } else {
      body = esc(lines.join('\n'));
    }
    return '<pre class="md-code"><code>' + body + '</code></pre>';
  }

  function render(source) {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let i = 0;
    const lists = [];
    let itemOpen = false;

    const closeItem = () => {
      if (itemOpen) { html.push('</li>'); itemOpen = false; }
    };
    const closeLists = (depth) => {
      while (lists.length > depth) {
        closeItem();
        html.push('</' + lists.pop() + '>');
      }
      if (depth === 0) closeItem();
    };

    while (i < lines.length) {
      const line = lines[i];

      // 代码块
      if (/^```/.test(line.trim())) {
        closeLists(0);
        const lang = line.trim().slice(3).trim().split(/\s+/)[0].toLowerCase();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++]);
        i++;
        html.push(codeBlock(buf, lang));
        continue;
      }

      // 标题
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        closeLists(0);
        const level = Math.min(3, h[1].length);
        html.push('<h' + level + ' class="md-h md-h' + h[1].length + '">' + inline(h[2].replace(/\s#+\s*$/, '')) + '</h' + level + '>');
        i++;
        continue;
      }

      // 分隔线
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
        closeLists(0);
        html.push('<hr class="md-hr">');
        i++;
        continue;
      }

      // 表格
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        closeLists(0);
        const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(cells(lines[i])); i++; }
        html.push('<table class="md-table"><thead><tr>' + head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        closeLists(0);
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        html.push('<blockquote class="md-quote">' + inline(buf.join(' ')) + '</blockquote>');
        continue;
      }

      // 列表
      const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        const depth = Math.floor(li[1].length / 2) + 1;
        const ordered = /\d/.test(li[2]);
        if (lists.length > depth) closeLists(depth);
        if (lists.length === depth) closeItem();
        while (lists.length < depth) {
          const tag = ordered && lists.length === depth - 1 ? 'ol' : 'ul';
          html.push('<' + tag + ' class="md-list">');
          lists.push(tag);
        }
        html.push('<li>' + inline(li[3]));
        itemOpen = true;
        i++;
        continue;
      }

      if (!line.trim()) {
        closeLists(0);
        i++;
        continue;
      }

      // 段落
      closeLists(0);
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s|\s*>)/.test(lines[i])) buf.push(lines[i++]);
      html.push('<p class="md-p">' + inline(buf.join('\n').replace(/\n/g, ' ')) + '</p>');
    }
    closeLists(0);
    return html.join('');
  }

  global.DawnMd = { render: render, inline: inline };
})(typeof globalThis !== 'undefined' ? globalThis : window);
