/* 破晓文件解析阅读器 · 主界面：收文件、识别、按类型挂载阅读器。 */
(function () {
  'use strict';

  const T = DawnText;
  const state = { files: [], activeId: null, viewer: null, seq: 0 };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  /* ---------------- 小工具 ---------------- */
  let toastTimer = null;
  function toast(message, tone) {
    const node = $('#toast');
    node.textContent = message;
    node.dataset.tone = tone || 'info';
    node.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 3200);
  }

  async function copy(text) {
    if (!text) { toast('没有可复制的内容', 'warn'); return; }
    if (text.length > 30000) { toast('内容有 ' + text.length + ' 字符，超过宿主 30000 字符的剪贴板上限', 'warn'); return; }
    if (!window.NousPlugin || !NousPlugin.supports || !NousPlugin.supports('clipboard.write')) {
      toast('宿主没有开放剪贴板权限', 'warn');
      return;
    }
    try {
      await NousPlugin.request('clipboard.write', { text: text });
      toast('已复制 ' + text.length + ' 字符');
    } catch (e) {
      toast('复制失败：' + (e && e.message ? e.message : e), 'warn');
    }
  }

  function button(label, onClick, cls, title) {
    const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function fmtTime(s) {
    if (!isFinite(s)) return '—';
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    return (m > 0 ? m + ':' : '') + (rest < 10 && m > 0 ? '0' : '') + rest.toFixed(2) + (m > 0 ? '' : ' 秒');
  }

  function fmtClock(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  /* ---------------- 文件收口 ---------------- */
  async function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    for (const file of incoming) {
      const head = new Uint8Array(await file.slice(0, Math.min(file.size, 4096)).arrayBuffer());
      const detected = DawnDetect.detect(file.name, head, file.size);
      const entry = {
        id: 'f' + (++state.seq),
        file: file,
        name: file.name,
        size: file.size,
        time: file.lastModified,
        category: detected.category,
        format: detected.format,
        ext: detected.ext,
        label: detected.label,
        head: head,
        text: null,
        encoding: '',
        edited: null,
      };
      state.files.push(entry);
    }
    renderRail();
    if (!state.activeId) select(state.files[0].id);
    else toast('已加入 ' + incoming.length + ' 个文件');
  }

  function renderRail() {
    const list = $('#fileList');
    list.innerHTML = '';
    for (const entry of state.files) {
      const li = el('li', 'file-item' + (entry.id === state.activeId ? ' is-active' : ''));
      li.tabIndex = 0;
      li.dataset.kind = entry.category;
      const dot = el('span', 'file-dot');
      const name = el('span', 'file-name', entry.name);
      name.title = entry.name;
      const size = el('span', 'file-size', T.bytesText(entry.size));
      li.appendChild(dot);
      li.appendChild(name);
      li.appendChild(size);
      li.addEventListener('click', () => select(entry.id));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(entry.id); } });
      list.appendChild(li);
    }
    const count = state.files.length;
    $('#railCount').textContent = count ? count + ' 个文件' : '没有文件';
    $('#clear').disabled = !count;
    $('#dropHint').hidden = count > 0;
  }

  function removeFile(id) {
    const idx = state.files.findIndex(f => f.id === id);
    if (idx < 0) return;
    state.files.splice(idx, 1);
    if (state.activeId === id) {
      state.activeId = null;
      teardown();
      if (state.files.length) select(state.files[Math.min(idx, state.files.length - 1)].id);
      else showEmpty();
    }
    renderRail();
  }

  function emptyNode() {
    const box = el('div', 'empty');
    box.appendChild(el('p', 'empty-title', '把文件放进来'));
    const kinds = el('p', 'empty-kinds');
    kinds.innerHTML = '文本<span>·</span>代码<span>·</span>Markdown<span>·</span>表格<span>·</span>配置<span>·</span>图像<span>·</span>音频<span>·</span>视频<span>·</span>压缩包<span>·</span>三维模型<span>·</span>二进制';
    box.appendChild(kinds);
    return box;
  }

  function showEmpty() {
    const body = $('#stageBody');
    body.innerHTML = '';
    $('#stageHead').hidden = true;
    body.appendChild(emptyNode());
  }

  function teardown() {
    if (state.viewer && state.viewer.destroy) {
      try { state.viewer.destroy(); } catch (e) { /* noop */ }
    }
    state.viewer = null;
  }

  async function readText(entry) {
    if (entry.text !== null && entry.edited === null) return entry.text;
    const buffer = await entry.file.slice(0, Math.min(entry.size, T.LIMIT)).arrayBuffer();
    const decoded = T.decode(new Uint8Array(buffer));
    entry.text = decoded.text;
    entry.encoding = decoded.encoding;
    entry.truncated = decoded.truncated;
    return entry.text;
  }

  /* ---------------- 选择与挂载 ---------------- */
  async function select(id, keepScroll) {
    const entry = state.files.find(f => f.id === id);
    if (!entry) return;
    state.activeId = id;
    renderRail();
    teardown();
    const head = $('#stageHead');
    head.hidden = false;
    head.innerHTML = '';
    const body = $('#stageBody');
    body.innerHTML = '';
    body.appendChild(el('div', 'loading', '正在读取…'));

    const titleRow = el('div', 'file-title');
    const name = el('h2', 'file-name', entry.name);
    name.title = entry.name;
    titleRow.appendChild(name);
    titleRow.appendChild(el('span', 'file-tag', entry.label));
    const tools = el('div', 'file-tools');
    titleRow.appendChild(tools);
    head.appendChild(titleRow);
    const metaRow = el('div', 'file-meta');
    head.appendChild(metaRow);
    entry.metaRow = metaRow;
    entry.tools = tools;
    metaRow.appendChild(el('span', null, T.bytesText(entry.size)));

    const mount = MOUNTERS[entry.category] || MOUNTERS.binary;
    body.innerHTML = '';
    const host = el('div', 'viewer');
    const loading = el('div', 'loading', '正在读取…');
    host.appendChild(loading);
    body.appendChild(host);
    try {
      await mount(entry, host, tools, metaRow);
      if (loading.isConnected) loading.remove();
    } catch (error) {
      host.innerHTML = '';
      const fail = el('div', 'parse-error');
      fail.appendChild(el('strong', null, '这个文件读不出来'));
      fail.appendChild(el('p', null, String(error && error.message ? error.message : error)));
      body.appendChild(fail);
    }
    if (keepScroll) body.scrollTop = 0;
  }

  /* ---------------- 通用：文本类视图 ---------------- */
  function textTools(entry, tools, hooks) {
    const group = el('div', 'seg');
    const modes = hooks.modes;
    let current = hooks.initial;
    const buttons = {};
    for (const mode of modes) {
      const b = button(mode.label, () => apply(mode.key), 'seg-btn', mode.title);
      buttons[mode.key] = b;
      group.appendChild(b);
    }
    tools.appendChild(group);
    if (hooks.onCopy) tools.appendChild(button('复制', () => hooks.onCopy(), 'btn--ghost'));
    if (hooks.extra) hooks.extra(tools);
    function apply(key) {
      current = key;
      for (const k of Object.keys(buttons)) buttons[k].classList.toggle('is-on', k === key);
      hooks.render(key);
    }
    apply(hooks.initial);
    return { apply: apply, get current() { return current; } };
  }

  function metaLine(entry, parts) {
    const row = entry.metaRow;
    for (const p of parts) {
      if (p === undefined || p === null || p === '') continue;
      if (row.childNodes.length) row.appendChild(el('span', 'sep', '·'));
      row.appendChild(el('span', null, p));
    }
  }

  function mountTextLike(entry, body, tools, metaRow, options) {
    const lang = DawnHl.langOf(entry.ext);
    return readText(entry).then((text) => {
      const stats = T.stats(text);
      const lines = text.split('\n');
      metaLine(entry, [entry.encoding, stats.eol, stats.lines.toLocaleString('zh-CN') + ' 行', entry.truncated ? '已截断' : '']);
      let view = null;
      const render = (mode) => {
        if (view && view.destroy) view.destroy();
        body.innerHTML = '';
        if (mode === 'read' && options.renderRead) {
          const pane = el('div', 'read-pane');
          pane.innerHTML = options.renderRead(entry.edited !== null ? entry.edited : text);
          body.appendChild(pane);
          bindLinks(pane);
          view = { destroy: () => { } };
          return;
        }
        if (mode === 'edit') {
          const editor = new DawnCode.Editor(body, {
            text: entry.edited !== null ? entry.edited : text,
            lang: lang,
            onChange: (value) => { entry.edited = value; updateDirty(entry); },
          });
          view = editor;
          return;
        }
        if (mode === 'tree' && options.renderTree) {
          const result = options.renderTree(entry.edited !== null ? entry.edited : text, entry);
          body.appendChild(result.node);
          view = { destroy: () => { } };
          return;
        }
        if (mode === 'outline' && options.renderOutline) {
          const result = options.renderOutline(entry.edited !== null ? entry.edited : text, entry);
          body.appendChild(result.node);
          view = { destroy: () => { } };
          return;
        }
        const code = new DawnCode.CodeView(body, { text: entry.edited !== null ? entry.edited : text, lang: lang });
        view = code;
      };
      state.viewer = { destroy: () => { if (view && view.destroy) view.destroy(); } };
      textTools(entry, tools, {
        modes: options.modes,
        initial: options.initial,
        render: render,
        onCopy: () => copy(entry.edited !== null ? entry.edited : text),
      });
      return null;
    });
  }

  function bindLinks(root) {
    root.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-url]');
      if (!a) return;
      e.preventDefault();
      const url = a.dataset.url;
      if (!/^https?:\/\//.test(url)) { toast('只支持在系统浏览器打开 http(s) 链接', 'warn'); return; }
      if (NousPlugin.supports && NousPlugin.supports('external.open')) {
        NousPlugin.request('external.open', { url: url }).catch(() => toast('链接打不开', 'warn'));
      } else {
        copy(url);
      }
    });
  }

  function updateDirty(entry) {
    const name = $('#stageHead .file-name');
    if (!name) return;
    const dirty = entry.edited !== null;
    name.classList.toggle('is-dirty', dirty);
  }

  /* ---------------- 各类型挂载 ---------------- */
  const MOUNTERS = {};

  MOUNTERS.text = MOUNTERS.code = (entry, body, tools) =>
    mountTextLike(entry, body, tools, entry.metaRow, {
      modes: [{ key: 'source', label: '源码' }, { key: 'edit', label: '编辑' }],
      initial: 'source',
    });

  MOUNTERS.md = (entry, body, tools) =>
    mountTextLike(entry, body, tools, entry.metaRow, {
      modes: [{ key: 'read', label: '阅读' }, { key: 'source', label: '源码' }, { key: 'edit', label: '编辑' }],
      initial: 'read',
      renderRead: (text) => DawnMd.render(text),
    });

  MOUNTERS.html = (entry, body, tools) =>
    mountTextLike(entry, body, tools, entry.metaRow, {
      modes: [{ key: 'outline', label: '大纲' }, { key: 'source', label: '源码' }, { key: 'edit', label: '编辑' }],
      initial: 'source',
      renderOutline: (text) => DawnStructured.outlineView(text, true),
    });

  MOUNTERS.xml = (entry, body, tools) =>
    mountTextLike(entry, body, tools, entry.metaRow, {
      modes: [{ key: 'outline', label: '大纲' }, { key: 'source', label: '源码' }, { key: 'edit', label: '编辑' }],
      initial: 'source',
      renderOutline: (text) => DawnStructured.outlineView(text, false),
    });

  MOUNTERS.json = (entry, body, tools) =>
    mountTextLike(entry, body, tools, entry.metaRow, {
      modes: [{ key: 'tree', label: '结构' }, { key: 'source', label: '源码' }, { key: 'edit', label: '编辑' }],
      initial: 'tree',
      renderTree: (text) => DawnStructured.jsonView(text),
    });

  MOUNTERS.table = (entry, body, tools) =>
    mountTextLike(entry, body, tools, entry.metaRow, {
      modes: [{ key: 'tree', label: '表格' }, { key: 'source', label: '源码' }, { key: 'edit', label: '编辑' }],
      initial: 'tree',
      renderTree: (text) => {
        const result = DawnStructured.tableView(text, entry.ext);
        if (result.rows) metaLine(entry, [result.cols + ' 列', result.more ? '显示前 2000 行' : '']);
        return result;
      },
    });

  MOUNTERS.config = (entry, body, tools) =>
    mountTextLike(entry, body, tools, entry.metaRow, {
      modes: [{ key: 'tree', label: '结构' }, { key: 'source', label: '源码' }, { key: 'edit', label: '编辑' }],
      initial: 'tree',
      renderTree: (text) => {
        const result = DawnStructured.configView(text, entry.ext);
        if (result.keys) metaLine(entry, [result.keys + ' 个键', result.sections + ' 节']);
        return result;
      },
    });

  MOUNTERS.image = async (entry, body, tools, metaRow) => {
    metaLine(entry, [entry.format.toUpperCase()]);
    const dims = el('span', 'img-dims');
    metaRow.appendChild(dims);
    const viewer = new DawnImage.ImageView(body, {
      file: entry.file,
      onMeta: (meta) => { dims.textContent = '· ' + meta.width + ' × ' + meta.height; },
    });
    state.viewer = viewer;
    tools.appendChild(button('适应窗口', () => { viewer.fit = true; viewer.zoom = 1; viewer.panX = 0; viewer.panY = 0; viewer.applyTransform(); }, 'btn--ghost'));
    tools.appendChild(button('1:1', () => { viewer.fit = false; viewer.zoom = 1; viewer.applyTransform(); }, 'btn--ghost'));
    tools.appendChild(button('旋转', () => viewer.rotate(90), 'btn--ghost'));
    tools.appendChild(button('水平镜像', () => viewer.flip('h'), 'btn--ghost'));
    const cropBtn = button('裁剪', (e) => {
      const on = viewer.toggleCrop();
      cropBtn.classList.toggle('is-on', on);
      toast(on ? '在图像上拖出要保留的区域' : '已退出裁剪');
    }, 'btn--ghost');
    tools.appendChild(cropBtn);
    tools.appendChild(button('还原', () => viewer.reset(), 'btn--ghost'));
  };

  MOUNTERS.audio = async (entry, body, tools, metaRow) => {
    metaLine(entry, [entry.format.toUpperCase()]);
    const viewer = new DawnAudio.AudioView(body, {
      file: entry.file,
      onMeta: (info) => {
        metaLine(entry, [
          info.duration ? fmtClock(info.duration) : '',
          info.sampleRate ? info.sampleRate / 1000 + ' kHz' : '',
          info.channels ? (info.channels === 1 ? '单声道' : info.channels === 2 ? '立体声' : info.channels + ' 声道') : '',
        ]);
      },
      onState: (st) => {
        if (st.time !== undefined) timeLabel.textContent = fmtClock(st.time);
        if (st.playing !== undefined) playBtn.textContent = st.playing ? '暂停' : '播放';
        if (st.range) rangeLabel.textContent = st.range[1] - st.range[0] > 0.01 ? fmtClock(st.range[1] - st.range[0]) : '';
      },
    });
    state.viewer = viewer;
    const playBtn = button('播放', () => {
      if (viewer.playing) { viewer.stop(); playBtn.textContent = '播放'; }
      else viewer.play();
    }, 'btn--primary');
    tools.appendChild(playBtn);
    const loopBtn = button('循环片段', () => {
      viewer.loop = !viewer.loop;
      loopBtn.classList.toggle('is-on', viewer.loop);
    }, 'btn--ghost');
    tools.appendChild(loopBtn);
    const timeLabel = el('span', 'tool-readout', '0:00');
    tools.appendChild(timeLabel);
    const rangeLabel = el('span', 'tool-readout tool-readout--dim');
    tools.appendChild(rangeLabel);
    tools.appendChild(button('复制时间码', () => copy(fmtClock(viewer.time || 0) + (viewer.range ? ' → ' + fmtClock(viewer.range[1]) : '')), 'btn--ghost'));
  };

  MOUNTERS.video = async (entry, body, tools, metaRow) => {
    metaLine(entry, [entry.format.toUpperCase()]);
    const stage = el('div', 'video-stage');
    body.appendChild(stage);
    const canvas = document.createElement('canvas');
    canvas.className = 'video-canvas';
    stage.appendChild(canvas);
    const player = new DawnVideo.Player(canvas);
    state.viewer = player;
    const info = await player.load(entry.file);
    if (info.error) {
      stage.innerHTML = '';
      const fail = el('div', 'parse-error');
      fail.appendChild(el('strong', null, '这种容器暂时读不了'));
      fail.appendChild(el('p', null, info.error === 'fragmented' ? '分片 MP4（fragmented）需要先合并，再放进来看。' : '没有找到 moov 索引，文件可能不完整。'));
      stage.appendChild(fail);
      return;
    }
    const support = player.supports();
    const v = player.video;
    if (v) metaLine(entry, [v.width + ' × ' + v.height, v.codec, fmtClock(player.duration)]);
    if (player.audio) metaLine(entry, [player.audio.channels + ' 声道', player.audio.sampleRate / 1000 + ' kHz']);
    if (support.reason) {
      const fail = el('div', 'parse-error');
      fail.appendChild(el('strong', null, '这个编码在此设备上解不了'));
      const why = {
        'no-webcodecs': '宿主没有提供 WebCodecs 解码接口。',
        'too-large': '文件超过 512 MB，先裁成小段再看。',
        'no-tracks': '没有找到可播放的音视频轨道。',
      }[support.reason] || support.reason;
      fail.appendChild(el('p', null, why));
      stage.appendChild(fail);
      return;
    }

    // 进度条 + 入点/出点
    const bar = el('div', 'timeline');
    const track = el('div', 'timeline-track');
    const played = el('div', 'timeline-played');
    const inMark = el('div', 'timeline-in');
    const outMark = el('div', 'timeline-out');
    track.appendChild(played);
    track.appendChild(inMark);
    track.appendChild(outMark);
    const handle = el('div', 'timeline-handle');
    track.appendChild(handle);
    bar.appendChild(track);
    body.appendChild(bar);

    let range = null;
    const setRange = (r) => {
      range = r;
      player.setRange(r);
      inMark.style.left = (r ? (r[0] / player.duration) * 100 : 0) + '%';
      outMark.style.left = (r ? (r[1] / player.duration) * 100 : 100) + '%';
      rangeLabel.textContent = r ? fmtClock(r[1] - r[0]) : '';
    };
    player.onstate = (st) => {
      const pct = st.duration ? (st.time / st.duration) * 100 : 0;
      played.style.width = pct + '%';
      handle.style.left = pct + '%';
      timeLabel.textContent = fmtClock(st.time) + ' / ' + fmtClock(st.duration);
      if (st.playing !== undefined) playBtn.textContent = st.playing ? '暂停' : '播放';
    };
    track.addEventListener('click', (e) => {
      const rect = track.getBoundingClientRect();
      const t = ((e.clientX - rect.left) / rect.width) * player.duration;
      player.seek(t);
    });

    const playBtn = button('播放', () => {
      if (player.playing) player.pause(); else player.play();
    }, 'btn--primary');
    tools.appendChild(playBtn);
    tools.appendChild(button('-1 秒', () => player.seek(player.time - 1), 'btn--ghost'));
    tools.appendChild(button('+1 秒', () => player.seek(player.time + 1), 'btn--ghost'));
    tools.appendChild(button('设入点', () => setRange([player.time, range ? Math.max(range[1], player.time + 0.1) : player.duration]), 'btn--ghost'));
    tools.appendChild(button('设出点', () => setRange([range ? range[0] : 0, player.time]), 'btn--ghost'));
    tools.appendChild(button('清除片段', () => setRange(null), 'btn--ghost'));
    const timeLabel = el('span', 'tool-readout', '0:00 / ' + fmtClock(player.duration));
    tools.appendChild(timeLabel);
    const rangeLabel = el('span', 'tool-readout tool-readout--dim');
    tools.appendChild(rangeLabel);
    tools.appendChild(button('复制时间码', () => copy(fmtClock(player.time) + ' / ' + fmtClock(player.duration)), 'btn--ghost'));

    await player.seek(0);
  };

  MOUNTERS.binary = async (entry, body, tools, metaRow) => {
    const analysis = DawnBinary.analyze(entry.head, entry.size);
    metaLine(entry, [analysis.kind]);
    const layout = el('div', 'bin-layout');
    const side = el('div', 'bin-side');
    const dl = el('dl', 'facts');
    for (const [k, v] of analysis.facts) {
      dl.appendChild(el('dt', null, k));
      dl.appendChild(el('dd', null, v));
    }
    side.appendChild(dl);
    const hexHost = el('div', 'bin-hex');
    layout.appendChild(side);
    layout.appendChild(hexHost);
    body.appendChild(layout);
    const hex = new DawnBinary.HexView(hexHost, { file: entry.file });
    state.viewer = { destroy: () => hex.destroy() };

    const jump = el('input', 'input input--sm');
    jump.type = 'text';
    jump.placeholder = '偏移';
    jump.inputMode = 'numeric';
    jump.setAttribute('aria-label', '跳到偏移');
    tools.appendChild(jump);
    tools.appendChild(button('跳转', () => {
      const raw = jump.value.trim();
      const value = /^0x/i.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10);
      if (Number.isFinite(value)) hex.goTo(value);
      else toast('写十进制或 0x 开头的十六进制', 'warn');
    }, 'btn--ghost'));
    tools.appendChild(button('复制十六进制', () => {
      const from = 0, len = Math.min(1024, entry.size);
      const buf = entry.head;
      const parts = [];
      for (let i = 0; i < Math.min(len, buf.length); i += 16) {
        const row = Array.from(buf.subarray(i, i + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        parts.push(i.toString(16).padStart(8, '0') + '  ' + row);
      }
      copy(parts.join('\n'));
    }, 'btn--ghost'));
  };

  MOUNTERS.archive = async (entry, body, tools, metaRow) => {
    metaLine(entry, [entry.format.toUpperCase()]);
    if (entry.format === 'gz' || entry.format === 'rar' || entry.format === '7z') {
      const fail = el('div', 'parse-error');
      fail.appendChild(el('strong', null, '这种压缩格式只做识别'));
      fail.appendChild(el('p', null, 'ZIP 可以直接列目录；GZIP、RAR、7z 需要各自的解压实现，这里先给出签名与体积。'));
      body.appendChild(fail);
      const analysis = DawnBinary.analyze(entry.head, entry.size);
      const dl = el('dl', 'facts facts--wide');
      for (const [k, v] of analysis.facts) { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
      body.appendChild(dl);
      return;
    }
    let zip;
    try {
      zip = await DawnZip.readZip(entry.file);
    } catch (e) {
      body.innerHTML = '';
      const fail = el('div', 'parse-error');
      fail.appendChild(el('strong', null, '中央目录读不出来'));
      fail.appendChild(el('p', null, e.message));
      body.appendChild(fail);
      return;
    }
    const totalSize = zip.entries.reduce((s, e) => s + e.size, 0);
    metaLine(entry, [zip.entries.length + ' 个条目', T.bytesText(totalSize)]);

    if (entry.category === 'document') {
      const docHost = el('div', 'doc-host');
      body.appendChild(docHost);
      await renderDocument(entry, zip, docHost);
      state.viewer = { destroy: () => { } };
      return;
    }

    const layout = el('div', 'zip-layout');
    const list = el('div', 'zip-list');
    const preview = el('div', 'zip-preview');
    layout.appendChild(list);
    layout.appendChild(preview);
    body.appendChild(layout);

    let activeRow = null;
    const showEntry = async (item) => {
      if (activeRow) activeRow.classList.remove('is-active');
      activeRow = item.row;
      activeRow.classList.add('is-active');
      preview.innerHTML = '';
      preview.appendChild(el('div', 'loading', '正在解压…'));
      try {
        const bytes = await DawnZip.readEntry(zip, item.entry);
        preview.innerHTML = '';
        const head = el('div', 'zip-preview-head');
        head.appendChild(el('span', 'zip-preview-name', item.entry.name));
        head.appendChild(el('span', 'file-size', T.bytesText(item.entry.size)));
        preview.appendChild(head);
        if (isTextName(item.entry.name) && bytes.length < 4 * 1024 * 1024) {
          const decoded = T.decode(bytes);
          if (/[\u0000-\u0008]/.test(decoded.text.slice(0, 2000))) {
            preview.appendChild(binaryBlock(bytes));
          } else {
            const host = el('div', 'zip-text');
            preview.appendChild(host);
            new DawnCode.CodeView(host, { text: decoded.text, lang: DawnHl.langOf(entryOf(item.entry.name)) });
          }
        } else {
          preview.appendChild(binaryBlock(bytes));
        }
      } catch (e) {
        preview.innerHTML = '';
        preview.appendChild(el('div', 'parse-error', '解压失败：' + e.message));
      }
    };

    function binaryBlock(bytes) {
      const wrap = el('div', 'mini-hex');
      const lines = [];
      for (let i = 0; i < Math.min(bytes.length, 2048); i += 16) {
        const row = Array.from(bytes.subarray(i, i + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        lines.push(i.toString(16).padStart(6, '0') + '  ' + row);
      }
      const pre = el('pre', 'mini-hex-pre', lines.join('\n'));
      wrap.appendChild(pre);
      return wrap;
    }

    const rows = [];
    for (const item of zip.entries.slice(0, 4000)) {
      const row = el('button', 'zip-row');
      row.type = 'button';
      row.appendChild(el('span', 'zip-name', item.name));
      row.appendChild(el('span', 'file-size', T.bytesText(item.size)));
      row.addEventListener('click', () => showEntry({ entry: item, row: row }));
      list.appendChild(row);
      rows.push({ entry: item, row: row });
    }
    if (zip.entries.length > 4000) list.appendChild(el('div', 'zip-more', '还有 ' + (zip.entries.length - 4000) + ' 个条目'));
    const first = rows.find(r => !/\/$/.test(r.entry.name)) || rows[0];
    if (first) showEntry(first);
    state.viewer = { destroy: () => { } };
  };

  function isTextName(name) {
    return /\.(txt|md|json|js|ts|css|html|xml|csv|yml|yaml|ini|toml|sh|py|java|c|h|cpp|rs|go|svg|rels|mf|cfg|properties|log)$/i.test(name) || !/\./.test(name);
  }
  function entryOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name);
    return m ? m[1].toLowerCase() : '';
  }

  async function renderDocument(entry, zip, host) {
    try {
      if (/\.docx$|\.docm$/i.test(entry.name)) {
        const doc = await DawnZip.docx(zip);
        for (const block of doc.blocks) {
          if (block.type === 'table') {
            const table = el('table', 'md-table');
            const body2 = el('tbody');
            for (const row of block.rows) {
              const tr = el('tr');
              for (const cell of row) tr.appendChild(el('td', null, cell));
              body2.appendChild(tr);
            }
            table.appendChild(body2);
            host.appendChild(table);
          } else {
            const tag = block.type === 'p' ? 'p' : block.type;
            const node = el(tag, 'doc-' + block.type, block.text);
            host.appendChild(node);
          }
        }
        metaLine(entry, [doc.blocks.filter(b => b.type !== 'table').length + ' 段']);
      } else if (/\.xlsx$|\.xlsm$/i.test(entry.name)) {
        const book = await DawnZip.xlsx(zip);
        host.classList.add('doc-host--wide');
        const tabs = el('div', 'seg');
        const host2 = el('div', 'doc-sheet');
        host.appendChild(tabs);
        host.appendChild(host2);
        const render = (index) => {
          host2.innerHTML = '';
          const sheet = book.sheets[index];
          if (!sheet) return;
          let cols = 0;
          for (const row of sheet.rows) {
            for (let i = row.length - 1; i >= cols; i--) {
              if (row[i] !== undefined && row[i] !== '') { cols = i + 1; break; }
            }
          }
          cols = Math.min(cols, 200);
          const table = el('table', 'csv-table sheet-table');
          const tbody = el('tbody');
          sheet.rows.slice(0, 2000).forEach((row, r) => {
            const tr = el('tr');
            tr.appendChild(el('td', 'csv-rownum', String(r + 1)));
            for (let c = 0; c < cols; c++) {
              const value = row[c] === undefined || row[c] === null ? '' : String(row[c]);
              const cell = el('td', null, value);
              if (value) cell.title = value;
              tr.appendChild(cell);
            }
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          host2.appendChild(table);
          metaLine(entry, [sheet.name, sheet.rows.length + ' 行', cols + ' 列']);
        };
        book.sheets.forEach((sheet, i) => tabs.appendChild(button(sheet.name, () => render(i), 'seg-btn' + (i === 0 ? ' is-on' : ''))));
        render(0);
      } else if (/\.pptx$/i.test(entry.name)) {
        const deck = await DawnZip.pptx(zip);
        deck.slides.forEach((texts, i) => {
          const box = el('div', 'doc-slide');
          box.appendChild(el('div', 'doc-slide-num', '第 ' + (i + 1) + ' 页'));
          texts.forEach(t => box.appendChild(el('p', 'md-p', t)));
          host.appendChild(box);
        });
        metaLine(entry, [deck.slides.length + ' 页']);
      } else {
        host.appendChild(el('p', 'doc-note', '这种文档只列出内部文件，展开条目可看到原文。'));
      }
    } catch (e) {
      host.appendChild(el('div', 'parse-error', '正文解析失败：' + e.message));
    }
  }

  MOUNTERS.document = async (entry, body, tools, metaRow) => {
    await MOUNTERS.archive(entry, body, tools, metaRow);
  };

  MOUNTERS.pdf = async (entry, body, tools, metaRow) => {
    const info = await DawnPdf.read(entry.file);
    metaLine(entry, ['PDF ' + info.version, info.pages + ' 页', info.encrypted ? '已加密' : '']);
    const layout = el('div', 'pdf-layout');
    const side = el('div', 'pdf-side');
    const dl = el('dl', 'facts');
    dl.appendChild(el('dt', null, '版本'));
    dl.appendChild(el('dd', null, info.version || '—'));
    dl.appendChild(el('dt', null, '页数'));
    dl.appendChild(el('dd', null, info.pages + ''));
    if (info.title) { dl.appendChild(el('dt', null, '标题')); dl.appendChild(el('dd', null, info.title)); }
    if (info.producer) { dl.appendChild(el('dt', null, '生成器')); dl.appendChild(el('dd', null, info.producer)); }
    dl.appendChild(el('dt', null, '内容流'));
    dl.appendChild(el('dd', null, info.streams + ' 段'));
    if (info.encrypted) {
      dl.appendChild(el('dt', null, '状态'));
      dl.appendChild(el('dd', null, '加密文档，文本层不可读'));
    }
    side.appendChild(dl);
    const textHost = el('div', 'pdf-text');
    layout.appendChild(side);
    layout.appendChild(textHost);
    body.appendChild(layout);
    if (info.text) {
      const view = new DawnCode.CodeView(textHost, { text: info.text, lang: 'text' });
      state.viewer = view;
      tools.appendChild(button('复制正文', () => copy(info.text), 'btn--ghost'));
    } else {
      textHost.appendChild(el('div', 'doc-note', '没有抽到文本层：这可能是一份扫描件，或使用了子集字体编码。'));
      state.viewer = { destroy: () => { } };
    }
  };

  MOUNTERS.model = async (entry, body, tools, metaRow) => {
    const ext = entry.ext || entry.format;
    metaLine(entry, [ext.toUpperCase()]);
    let info;
    try {
      info = await DawnModel.parse(entry.file, ext);
    } catch (e) {
      info = null;
    }
    if (!info) {
      const analysis = DawnBinary.analyze(entry.head, entry.size);
      body.appendChild(el('div', 'doc-note', '这种模型格式这里只做识别：' + analysis.kind));
      return;
    }
    const layout = el('div', 'model-layout');
    const side = el('div', 'model-side');
    const dl = el('dl', 'facts');
    const rows = DawnModel.stats(info);
    for (const [k, v] of rows) { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
    side.appendChild(dl);
    const canvasHost = el('div', 'model-stage');
    layout.appendChild(side);
    layout.appendChild(canvasHost);
    body.appendChild(layout);
    const preview = new DawnModel.Preview(canvasHost, info.points, info.bounds);
    state.viewer = preview;
    canvasHost.appendChild(el('div', 'model-hint', '拖动旋转'));
    tools.appendChild(button('复制统计', () => copy(rows.map(r => r[0] + '：' + r[1]).join('\n')), 'btn--ghost'));
  };

  /* ---------------- 拖放与入口 ---------------- */
  function wire() {
    $('#pick').addEventListener('click', () => $('#picker').click());
    $('#picker').addEventListener('change', (e) => {
      addFiles(e.target.files);
      e.target.value = '';
    });
    $('#clear').addEventListener('click', () => {
      state.files = [];
      state.activeId = null;
      teardown();
      renderRail();
      showEmpty();
    });
    $('#dropHint').addEventListener('click', () => $('#picker').click());
    const body = document.body;
    let depth = 0;
    body.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; body.classList.add('is-dragging'); });
    body.addEventListener('dragover', (e) => { e.preventDefault(); });
    body.addEventListener('dragleave', (e) => {
      depth--;
      if (depth <= 0) { depth = 0; body.classList.remove('is-dragging'); }
    });
    body.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      body.classList.remove('is-dragging');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        $('#picker').click();
      }
    });
  }

  function boot() {
    wire();
    renderRail();
    showEmpty();
    if (window.NousPlugin && NousPlugin.ready) {
      NousPlugin.ready.then(() => { }).catch(() => { });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
