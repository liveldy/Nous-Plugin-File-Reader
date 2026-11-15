/* 代码视图与编辑器：虚拟滚动的只读渲染 + 带语法着色的编辑区（行号、缩进、括号、补全提示）。 */
(function (global) {
  'use strict';

  const ROW = 21;
  const HIGHLIGHT_LIMIT = 1.8 * 1024 * 1024;

  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function measure(width) {
    return Math.max(1, Math.round(width / 8.2));
  }

  /* ---------------- 只读代码视图 ---------------- */
  function CodeView(host, options) {
    this.host = host;
    this.text = options.text || '';
    this.lang = options.lang || 'text';
    this.wrap = !!options.wrap;
    this.lines = this.text.split('\n');
    this.colored = this.text.length <= HIGHLIGHT_LIMIT && DawnHl.LANGS[this.lang] ? DawnHl.highlightLines(this.text, this.lang) : null;
    this.host.innerHTML = '';
    this.host.classList.add('cv');
    this.host.classList.toggle('cv--wrap', this.wrap);

    this.scroller = el('div', 'cv-scroll');
    this.gutter = el('div', 'cv-gutter');
    this.body = el('div', 'cv-body');
    this.rows = el('div', 'cv-rows');
    this.body.appendChild(this.rows);
    this.scroller.appendChild(this.gutter);
    this.scroller.appendChild(this.body);
    this.host.appendChild(this.scroller);

    const longest = this.lines.reduce((m, l) => Math.max(m, l.length), 0);
    this.colWidth = Math.min(longest, 400) * 8.2 + 32;
    this.total = this.lines.length;
    this.body.style.height = (this.total * ROW) + 'px';
    this.gutter.style.height = (this.total * ROW) + 'px';

    this.scroller.addEventListener('scroll', () => this.render());
    window.addEventListener('resize', this.onResize = () => this.render());
    this.render();
  }

  CodeView.prototype.destroy = function () {
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    this.host.innerHTML = '';
  };

  CodeView.prototype.render = function () {
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight || 400;
    const first = Math.max(0, Math.floor(top / ROW) - 4);
    const count = Math.ceil(height / ROW) + 9;
    const last = Math.min(this.total, first + count);
    const frag = document.createDocumentFragment();
    const gut = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const line = this.lines[i];
      const html = this.colored ? this.colored[i] : DawnHl.escape(line);
      const row = el('div', 'cv-row');
      row.style.top = (i * ROW) + 'px';
      row.innerHTML = html === '' ? '&nbsp;' : html;
      frag.appendChild(row);
      const g = el('div', 'cv-num');
      g.style.top = (i * ROW) + 'px';
      g.textContent = String(i + 1);
      gut.appendChild(g);
    }
    this.rows.innerHTML = '';
    this.rows.appendChild(frag);
    this.gutter.innerHTML = '';
    this.gutter.appendChild(gut);
    this.body.style.width = (this.wrap ? 'auto' : this.colWidth) + 'px';
  };

  CodeView.prototype.scrollToLine = function (line) {
    this.scroller.scrollTop = Math.max(0, (line - 1) * ROW - 40);
    this.render();
  };

  /* ---------------- 编辑器 ---------------- */
  const KEYWORDS = {
    c: 'printf scanf sizeof malloc free memset memcpy struct typedef union enum',
    cpp: 'std::string std::vector std::map std::cout std::cin std::endl printf malloc new delete noexcept template',
    js: 'console.log console.error document window Math JSON Promise async await fetch Array Object String Number',
    ts: 'interface type readonly Record Partial Promise Array string number boolean',
    py: 'def class return import from print range len enumerate zip open with as self',
    rs: 'fn let mut impl pub struct enum match println! vec! Option Result unwrap',
    go: 'func package import fmt.Println make len range struct interface error',
    java: 'System.out.println public static void class String int new',
    css: 'display flex grid position color background margin padding border',
    sql: 'SELECT FROM WHERE GROUP BY ORDER JOIN LEFT RIGHT INNER ON AS LIMIT',
    sh: 'echo export cd ls grep sed awk',
  };

  const SNIPPETS = {
    c: ['for (int i = 0; i < n; i++) {\n    \n}', 'if () {\n    \n}', '#include <>', 'int main(void) {\n    return 0;\n}'],
    cpp: ['for (auto& it : items) {\n    \n}', 'if () {\n    \n}', '#include <>', 'std::vector<> v;'],
    js: ['function name() {\n    \n}', 'const name = () => {\n    \n}', 'if () {\n    \n}', 'for (const item of items) {\n    \n}', 'async function run() {\n    \n}'],
    ts: ['interface Name {\n    \n}', 'type Name = ', 'function name(): void {\n    \n}'],
    py: ['def name():\n    ', 'class Name:\n    def __init__(self):\n        ', 'if __name__ == "__main__":\n    ', 'for item in items:\n    '],
    rs: ['fn name() {\n    \n}', 'match value {\n    _ => {}\n}', 'let mut x = 0;'],
    go: ['func name() {\n    \n}', 'if err != nil {\n    \n}', 'for i := 0; i < n; i++ {\n    \n}'],
    java: ['public void name() {\n    \n}', 'System.out.println();', 'if () {\n    \n}'],
    sql: ['SELECT *\nFROM \nWHERE ', 'INSERT INTO  () VALUES ();', 'CREATE TABLE  (\n    \n);'],
  };

  function Editor(host, options) {
    this.host = host;
    this.lang = options.lang || 'text';
    this.onChange = options.onChange || function () {};
    this.host.innerHTML = '';
    this.host.classList.add('ed');

    const shell = el('div', 'ed-box');
    this.gutter = el('div', 'ed-gutter');
    const stack = el('div', 'ed-stack');
    this.pre = el('pre', 'ed-hl');
    this.code = el('code');
    this.pre.appendChild(this.code);
    this.ta = document.createElement('textarea');
    this.ta.className = 'ed-ta';
    this.ta.spellcheck = false;
    this.ta.wrap = 'off';
    this.ta.value = options.text || '';
    this.ta.setAttribute('aria-label', '文件内容编辑器');
    stack.appendChild(this.pre);
    stack.appendChild(this.ta);
    shell.appendChild(this.gutter);
    shell.appendChild(stack);
    this.popup = el('div', 'ed-pop');
    this.popup.hidden = true;
    shell.appendChild(this.popup);
    this.host.appendChild(shell);

    this.text = this.ta.value;
    this.hints = [];
    this.hintIndex = 0;
    this.hintStart = 0;
    this.computeIndent();

    this.ta.addEventListener('scroll', () => this.syncScroll());
    this.ta.addEventListener('input', (event) => this.onInput(event));
    this.ta.addEventListener('keydown', (e) => this.onKey(e));
    this.ta.addEventListener('blur', () => { this.popup.hidden = true; });
    this.refresh();
  }

  Editor.prototype.computeIndent = function () {
    const lines = this.text.split('\n').slice(0, 200);
    let tabs = 0, spaces = 0;
    for (const l of lines) {
      if (/^\t/.test(l)) tabs++;
      else if (/^ {2}/.test(l)) spaces++;
    }
    this.indentUnit = tabs > spaces ? '\t' : (this.lang === 'py' ? '    ' : '  ');
  };

  Editor.prototype.refresh = function () {
    const lines = this.text.split('\n');
    const highlightable = this.text.length <= HIGHLIGHT_LIMIT && DawnHl.LANGS[this.lang];
    const colored = highlightable ? DawnHl.highlightLines(this.text, this.lang) : null;
    const html = [];
    const nums = [];
    for (let i = 0; i < lines.length; i++) {
      html.push('<span class="ed-line">' + (colored ? (colored[i] || '&nbsp;') : DawnHl.escape(lines[i]) || '&nbsp;') + '</span>');
      nums.push(String(i + 1));
    }
    this.code.innerHTML = html.join('\n');
    this.gutter.textContent = nums.join('\n');
    this.syncScroll();
    this.onChange(this.text);
  };

  Editor.prototype.syncScroll = function () {
    this.pre.scrollTop = this.ta.scrollTop;
    this.pre.scrollLeft = this.ta.scrollLeft;
    this.gutter.scrollTop = this.ta.scrollTop;
  };

  Editor.prototype.onInput = function (event) {
    this.text = this.ta.value;
    this.refresh();
    if (event && event.inputType === 'insertText' && /[A-Za-z0-9_$]/.test(event.data || '')) this.suggest();
    else if (event && event.inputType === 'insertText' && event.data === '.') this.suggest();
    else this.closeSuggest();
  };

  Editor.prototype.setValue = function (text) {
    this.text = text;
    this.ta.value = text;
    this.refresh();
  };

  /* 补全：文档内标识符 + 关键字 + 片段 */
  Editor.prototype.candidates = function (prefix, afterDot) {
    const pool = new Map();
    const add = (word, kind, insert) => {
      if (!pool.has(word)) pool.set(word, { word: word, kind: kind, insert: insert || word });
    };
    const words = KEYWORDS[this.lang] ? KEYWORDS[this.lang].split(' ') : [];
    for (const w of words) add(w, 'k');
    for (const sn of SNIPPETS[this.lang] || []) add(sn.split(/[\s(]/)[0], 's', sn);
    if (afterDot) {
      const props = (this.text.match(/\.([A-Za-z_$][\w$]*)/g) || []).map(s => s.slice(1));
      for (const p of props) add(p, 'm');
    }
    const idents = this.text.match(/[A-Za-z_$][\w$]{2,}/g) || [];
    const seen = new Set();
    for (const id of idents) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (seen.size > 3000) break;
      add(id, 'i');
    }
    const lower = prefix.toLowerCase();
    const list = [];
    for (const item of pool.values()) {
      if (!prefix || (item.word.toLowerCase().startsWith(lower) && item.word.toLowerCase() !== lower)) list.push(item);
      if (list.length > 40) break;
    }
    list.sort((a, b) => (a.kind === 'i' ? 1 : 0) - (b.kind === 'i' ? 1 : 0));
    return list.slice(0, 12);
  };

  Editor.prototype.suggest = function () {
    const pos = this.ta.selectionStart;
    const before = this.text.slice(Math.max(0, pos - 80), pos);
    const m = /([A-Za-z_$][\w$]*|[.]?)$/.exec(before);
    const prefix = m ? m[1].replace(/^\./, '') : '';
    const afterDot = /\.\w*$/.test(before);
    if (!prefix && !afterDot) { this.closeSuggest(); return; }
    const list = this.candidates(prefix, afterDot);
    if (!list.length) { this.closeSuggest(); return; }
    this.hints = list;
    this.hintIndex = 0;
    this.hintStart = pos - prefix.length;
    this.renderHints();
  };

  Editor.prototype.renderHints = function () {
    const pop = this.popup;
    pop.innerHTML = '';
    const pos = this.ta.selectionStart;
    const before = this.text.slice(0, pos);
    const row = (before.match(/\n/g) || []).length;
    const col = pos - before.lastIndexOf('\n') - 1;
    const lineHeight = 21;
    const top = (row + 1) * lineHeight - this.ta.scrollTop;
    const left = Math.min(col * 8.2 - this.ta.scrollLeft, Math.max(40, this.ta.clientWidth - 240));
    pop.style.top = Math.max(0, top) + 'px';
    pop.style.left = Math.max(0, Math.min(left, this.ta.clientWidth - 200)) + 'px';
    pop.hidden = false;
    this.hints.forEach((h, i) => {
      const item = el('button', 'ed-pop-item' + (i === this.hintIndex ? ' is-active' : ''));
      item.type = 'button';
      item.appendChild(el('span', 'ed-pop-kind')).textContent = h.kind === 's' ? '片段' : h.kind === 'k' ? '关键字' : h.kind === 'm' ? '属性' : '文中';
      item.appendChild(el('span', 'ed-pop-word')).textContent = h.insert.split('\n')[0].slice(0, 40);
      item.addEventListener('mousedown', (e) => { e.preventDefault(); this.hintIndex = i; this.accept(); });
      pop.appendChild(item);
    });
  };

  Editor.prototype.closeSuggest = function () {
    this.popup.hidden = true;
    this.hints = [];
  };

  Editor.prototype.accept = function () {
    const hint = this.hints[this.hintIndex];
    if (!hint) return;
    const start = this.hintStart;
    const pos = this.ta.selectionStart;
    const insert = hint.insert;
    this.ta.value = this.text.slice(0, start) + insert + this.text.slice(pos);
    const caret = start + insert.length;
    if (insert.indexOf('()') >= 0) {
      const idx = start + insert.indexOf('()') + 1;
      this.ta.selectionStart = this.ta.selectionEnd = idx;
    } else {
      this.ta.selectionStart = this.ta.selectionEnd = caret;
    }
    this.closeSuggest();
    this.text = this.ta.value;
    this.refresh();
    this.ta.focus();
  };

  Editor.prototype.onKey = function (e) {
    if (!this.popup.hidden) {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.hintIndex = (this.hintIndex + 1) % this.hints.length; this.renderHints(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.hintIndex = (this.hintIndex + this.hints.length - 1) % this.hints.length; this.renderHints(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.accept(); return; }
      if (e.key === 'Escape') { e.preventDefault(); this.closeSuggest(); return; }
    }
    if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); this.suggest(); return; }

    const ta = this.ta;
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart, end = ta.selectionEnd;
      if (start === end) {
        ta.value = this.text.slice(0, start) + this.indentUnit + this.text.slice(end);
        ta.selectionStart = ta.selectionEnd = start + this.indentUnit.length;
      } else {
        const from = this.text.lastIndexOf('\n', start - 1) + 1;
        const block = this.text.slice(from, end);
        const shifted = e.shiftKey
          ? block.replace(new RegExp('^( {1,4}|\t)', 'gm'), '')
          : block.replace(/^/gm, this.indentUnit);
        ta.value = this.text.slice(0, from) + shifted + this.text.slice(end);
        ta.selectionStart = from;
        ta.selectionEnd = from + shifted.length;
      }
      this.text = ta.value;
      this.refresh();
      return;
    }
    if (e.key === 'Enter') {
      const pos = ta.selectionStart;
      const lineStart = this.text.lastIndexOf('\n', pos - 1) + 1;
      const line = this.text.slice(lineStart, pos);
      const indent = /^\s*/.exec(line)[0];
      const opensBlock = /[{([]\s*$/.test(line);
      const next = this.text[pos];
      if (opensBlock && next && /[}\])]/.test(next)) {
        e.preventDefault();
        const insert = '\n' + indent + this.indentUnit + '\n' + indent;
        ta.value = this.text.slice(0, pos) + insert + this.text.slice(pos);
        ta.selectionStart = ta.selectionEnd = pos + 1 + indent.length + this.indentUnit.length;
        this.text = ta.value;
        this.refresh();
        return;
      }
      if (indent) {
        e.preventDefault();
        const insert = '\n' + indent + (opensBlock ? this.indentUnit : '');
        ta.value = this.text.slice(0, pos) + insert + this.text.slice(pos);
        ta.selectionStart = ta.selectionEnd = pos + insert.length;
        this.text = ta.value;
        this.refresh();
        return;
      }
    }
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
    if (pairs[e.key] && !e.ctrlKey && !e.altKey) {
      const start = ta.selectionStart, end = ta.selectionEnd;
      if (start !== end) return;
      const nextCh = this.text[start] || '';
      if (/[\w]/.test(nextCh)) return;
      if (e.key === '"' || e.key === "'") {
        const lineStart = this.text.lastIndexOf('\n', start) + 1;
        const line = this.text.slice(lineStart, start);
        if ((line.match(new RegExp(e.key, 'g')) || []).length % 2 === 1) return;
      }
      e.preventDefault();
      ta.value = this.text.slice(0, start) + e.key + pairs[e.key] + this.text.slice(end);
      ta.selectionStart = ta.selectionEnd = start + 1;
      this.text = ta.value;
      this.refresh();
      return;
    }
    if (e.key === 'Backspace') {
      const start = ta.selectionStart;
      if (start === ta.selectionEnd && start > 0) {
        const prev = this.text[start - 1], next = this.text[start];
        const mirror = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
        if (mirror[prev] && next === mirror[prev]) {
          e.preventDefault();
          ta.value = this.text.slice(0, start - 1) + this.text.slice(start + 1);
          ta.selectionStart = ta.selectionEnd = start - 1;
          this.text = ta.value;
          this.refresh();
        }
      }
    }
  };

  Editor.prototype.destroy = function () {
    this.host.innerHTML = '';
  };

  Editor.prototype.scrollToLine = function (line) {
    this.host.querySelector('.ed-box').scrollTop = Math.max(0, (line - 2) * ROW);
  };

  global.DawnCode = { CodeView: CodeView, Editor: Editor, ROW: ROW };
})(typeof globalThis !== 'undefined' ? globalThis : window);
