/* HTML 阅读：把页面解析成安全的静态结构再渲染。
   宿主沙箱里 frame-src 被关掉，不能开 iframe，所以脚本、外链样式、事件属性、外链资源一律丢掉，
   只保留版式与内容：标题、段落、列表、表格、引用、代码、data: 图片与 https 链接。 */
(function (global) {
  'use strict';

  const SKIP = new Set([
    'script', 'style', 'link', 'meta', 'base', 'title', 'head', 'noscript', 'template',
    'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'canvas', 'dialog',
    'form', 'input', 'button', 'select', 'option', 'textarea', 'label', 'fieldset',
    'audio', 'video', 'source', 'track', 'map', 'area', 'svg', 'math', 'slot', 'portal',
  ]);
  const HEADINGS = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
  const MAX_NODES = 20000;
  const MAX_TEXT = 4000000;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function safeUrl(raw) {
    const url = String(raw || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function render(text) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(String(text || ''), 'text/html');
    } catch (e) {
      doc = null;
    }
    const root = el('div', 'html-read');
    const counts = { nodes: 0, images: 0, links: 0, skipped: 0, truncated: false, title: '' };
    if (!doc) {
      root.appendChild(el('p', 'doc-note', '这份 HTML 解析不了。'));
      return { node: root, stats: counts };
    }
    counts.title = (doc.title || '').trim();
    const body = doc.body;
    if (!body) {
      root.appendChild(el('p', 'doc-note', '这份 HTML 没有正文。'));
      return { node: root, stats: counts };
    }
    copyChildren(body, root, counts, 0);
    if (!root.children.length && !root.textContent.trim()) {
      root.appendChild(el('p', 'doc-note', '这份 HTML 只有脚本或样式，没有可读内容。'));
    }
    if (counts.truncated) {
      root.appendChild(el('p', 'doc-note', '内容过长，只渲染了前 ' + MAX_NODES + ' 个节点。'));
    }
    return { node: root, stats: counts };
  }

  function copyChildren(from, to, counts, depth) {
    for (const child of Array.from(from.childNodes)) copyNode(child, to, counts, depth);
  }

  function copyNode(node, host, counts, depth) {
    if (counts.truncated) return;
    if (node.nodeType === 3) {
      const raw = node.nodeValue || '';
      const value = raw.replace(/\s+/g, ' ');
      if (value.trim()) {
        host.appendChild(document.createTextNode(value));
        counts.nodes++;
      } else if (host.firstChild && host.lastChild && host.lastChild.nodeType === 3) {
        host.appendChild(document.createTextNode(' '));
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (SKIP.has(tag)) { counts.skipped++; return; }
    if (counts.nodes++ > MAX_NODES) { counts.truncated = true; return; }

    if (tag === 'br') { host.appendChild(document.createElement('br')); return; }
    if (tag === 'hr') { host.appendChild(el('hr', 'md-hr')); return; }
    if (tag === 'img') {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      if (/^data:image\//i.test(src)) {
        const img = document.createElement('img');
        img.className = 'html-img';
        img.src = src;
        img.alt = alt;
        host.appendChild(img);
        counts.images++;
      } else if (src) {
        host.appendChild(el('span', 'md-img', alt ? alt + '（图片）' : '图片'));
        counts.images++;
      }
      return;
    }
    if (tag === 'pre') {
      const pre = el('pre', 'md-code');
      pre.appendChild(el('code', null, node.textContent.replace(/\n+$/, '')));
      host.appendChild(pre);
      return;
    }
    if (tag === 'a') {
      const url = safeUrl(node.getAttribute('href'));
      const inner = url ? el('a', 'md-link') : el('span');
      if (url) {
        inner.href = '#';
        inner.dataset.url = url;
        counts.links++;
      }
      copyChildren(node, inner, counts, depth + 1);
      host.appendChild(inner);
      return;
    }

    let target;
    if (HEADINGS[tag]) {
      target = el(tag, 'md-h md-h' + HEADINGS[tag]);
      if (node.getAttribute('id')) target.id = node.getAttribute('id');
    } else if (tag === 'p') target = el('p', 'md-p');
    else if (tag === 'ul' || tag === 'ol') target = el(tag, 'md-list');
    else if (tag === 'li') target = el('li');
    else if (tag === 'dl' || tag === 'dt' || tag === 'dd' || tag === 'figure' || tag === 'figcaption') target = el(tag);
    else if (tag === 'table') target = el('table', 'md-table');
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot' || tag === 'tr' || tag === 'caption') target = el(tag);
    else if (tag === 'th' || tag === 'td') {
      target = el(tag);
      for (const name of ['colspan', 'rowspan']) {
        const n = parseInt(node.getAttribute(name) || '1', 10);
        if (n > 1) target.setAttribute(name, String(Math.min(n, 20)));
      }
    } else if (tag === 'blockquote') target = el('blockquote', 'md-quote');
    else if (tag === 'code') target = el('code');
    else if (tag === 'strong' || tag === 'b') target = el('strong');
    else if (tag === 'em' || tag === 'i') target = el('em');
    else if (tag === 'u' || tag === 'ins') target = el('u');
    else if (tag === 's' || tag === 'del' || tag === 'strike') target = el('s');
    else if (tag === 'small') target = el('small');
    else if (tag === 'sub' || tag === 'sup' || tag === 'mark' || tag === 'time') target = el(tag);
    else if (tag === 'details' || tag === 'summary') target = el(tag);
    else target = el('div');
    if (node.getAttribute('title')) target.title = node.getAttribute('title');

    copyChildren(node, target, counts, depth + 1);
    if (depth > 60) counts.truncated = true;
    host.appendChild(target);
    if (counts.nodes * 64 > MAX_TEXT && !counts.truncated && depth === 0) counts.truncated = true;
  }

  global.DawnHtml = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : window);
