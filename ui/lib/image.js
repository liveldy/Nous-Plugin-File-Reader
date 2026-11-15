/* 图像阅读与基础处理：缩放、平移、旋转、镜像、矩形裁剪。全部在 canvas 上完成。 */
(function (global) {
  'use strict';

  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function ImageView(host, options) {
    this.host = host;
    this.file = options.file;
    this.onMeta = options.onMeta || function () {};
    this.zoom = 1;
    this.fit = true;
    this.panX = 0;
    this.panY = 0;
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;
    this.crop = null;
    this.cropMode = false;

    this.host.innerHTML = '';
    this.host.classList.add('img-view');
    this.stage = el('div', 'img-stage');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'img-canvas';
    this.stage.appendChild(this.canvas);
    this.marquee = el('div', 'img-marquee');
    this.marquee.hidden = true;
    this.stage.appendChild(this.marquee);
    this.host.appendChild(this.stage);
    this.ctx = this.canvas.getContext('2d');

    this.bind();
    this.load();
  }

  ImageView.prototype.load = async function () {
    const url = URL.createObjectURL ? null : null;
    const buffer = await this.file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let mime = this.file.type || '';
    if (!mime || mime === 'application/octet-stream') {
      mime = /^89504e47/.test(hex(bytes, 4)) ? 'image/png' : /^ffd8/.test(hex(bytes, 3)) ? 'image/jpeg' : 'image/png';
    }
    const blob = new Blob([buffer], { type: mime });
    // 宿主 CSP 只允许 data:，所以走 FileReader
    this.dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const img = new Image();
    img.onload = () => {
      this.img = img;
      this.source = document.createElement('canvas');
      this.source.width = img.naturalWidth;
      this.source.height = img.naturalHeight;
      this.source.getContext('2d').drawImage(img, 0, 0);
      this.canvas.width = img.naturalWidth;
      this.canvas.height = img.naturalHeight;
      this.draw();
      this.onMeta({ width: img.naturalWidth, height: img.naturalHeight, mime: mime });
    };
    img.onerror = () => {
      this.stage.innerHTML = '';
      const fail = el('div', 'parse-error');
      fail.appendChild(el('strong', null, '这张图无法解码'));
      fail.appendChild(el('p', null, '宿主只接受 PNG、JPEG、GIF、WebP 等浏览器内置格式，其他格式请用对应的软件打开。'));
      this.stage.appendChild(fail);
    };
    img.src = this.dataUrl;
  };

  function hex(bytes, n) {
    let s = '';
    for (let i = 0; i < n && i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
  }

  ImageView.prototype.bind = function () {
    const stage = this.stage;
    stage.addEventListener('wheel', (e) => {
      if (!this.img) return;
      e.preventDefault();
      this.fit = false;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.zoom = Math.max(0.05, Math.min(16, this.zoom * factor));
      this.applyTransform();
    }, { passive: false });

    let dragging = false, lastX = 0, lastY = 0, startX = 0, startY = 0;
    stage.addEventListener('pointerdown', (e) => {
      if (!this.img) return;
      const rect = stage.getBoundingClientRect();
      if (this.cropMode) {
        dragging = true;
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        this.marquee.hidden = false;
        this.marquee.style.left = startX + 'px';
        this.marquee.style.top = startY + 'px';
        this.marquee.style.width = '0px';
        this.marquee.style.height = '0px';
        stage.setPointerCapture(e.pointerId);
        return;
      }
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = stage.getBoundingClientRect();
      if (this.cropMode) {
        const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
        const y = Math.min(Math.max(0, e.clientY - rect.top), rect.height);
        const left = Math.min(x, startX), top = Math.min(y, startY);
        this.marquee.style.left = left + 'px';
        this.marquee.style.top = top + 'px';
        this.marquee.style.width = Math.abs(x - startX) + 'px';
        this.marquee.style.height = Math.abs(y - startY) + 'px';
        return;
      }
      this.panX += e.clientX - lastX;
      this.panY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.fit = false;
      this.applyTransform();
    });
    stage.addEventListener('pointerup', () => {
      if (dragging && this.cropMode) this.confirmCrop();
      dragging = false;
    });
  };

  ImageView.prototype.applyTransform = function () {
    const scale = this.fit ? this.fitScale() : this.zoom;
    this.canvas.style.transform = 'translate(-50%, -50%) translate(' + this.panX + 'px,' + this.panY + 'px) scale(' + scale + ')';
  };

  ImageView.prototype.fitScale = function () {
    if (!this.img) return 1;
    const stage = this.stage.getBoundingClientRect();
    const sx = (stage.width - 48) / this.canvas.width;
    const sy = (stage.height - 48) / this.canvas.height;
    return Math.max(0.02, Math.min(1, Math.min(sx, sy)));
  };

  ImageView.prototype.draw = function () {
    if (!this.source) return;
    const src = this.source;
    const rot = ((this.rotation % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    this.canvas.width = swap ? src.height : src.width;
    this.canvas.height = swap ? src.width : src.height;
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(this.flipH ? -1 : 1, this.flipV ? -1 : 1);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    ctx.restore();
    this.applyTransform();
    this.onMeta({ width: this.canvas.width, height: this.canvas.height, edited: rot !== 0 || this.flipH || this.flipV });
  };

  ImageView.prototype.confirmCrop = function () {
    const rect = this.stage.getBoundingClientRect();
    const box = this.marquee.getBoundingClientRect();
    const scale = this.fit ? this.fitScale() : this.zoom;
    const left = (box.left - rect.left - rect.width / 2 - this.panX) / scale + this.canvas.width / 2;
    const top = (box.top - rect.top - rect.height / 2 - this.panY) / scale + this.canvas.height / 2;
    const w = box.width / scale;
    const h = box.height / scale;
    this.marquee.hidden = true;
    if (w < 4 || h < 4) return;
    const cut = document.createElement('canvas');
    cut.width = Math.round(w);
    cut.height = Math.round(h);
    cut.getContext('2d').drawImage(this.canvas, Math.round(left), Math.round(top), Math.round(w), Math.round(h), 0, 0, Math.round(w), Math.round(h));
    this.source = cut;
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;
    this.panX = 0;
    this.panY = 0;
    this.fit = true;
    this.cropMode = false;
    this.draw();
  };

  ImageView.prototype.rotate = function (deg) {
    if (!this.source) return;
    this.rotation = (this.rotation + deg + 360) % 360;
    this.draw();
  };
  ImageView.prototype.flip = function (axis) {
    if (!this.source) return;
    if (axis === 'h') this.flipH = !this.flipH; else this.flipV = !this.flipV;
    this.draw();
  };
  ImageView.prototype.toggleCrop = function (on) {
    this.cropMode = on === undefined ? !this.cropMode : !!on;
    this.stage.classList.toggle('is-cropping', this.cropMode);
    this.marquee.hidden = true;
    return this.cropMode;
  };
  ImageView.prototype.reset = async function () {
    this.source = document.createElement('canvas');
    this.source.width = this.img.naturalWidth;
    this.source.height = this.img.naturalHeight;
    this.source.getContext('2d').drawImage(this.img, 0, 0);
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;
    this.fit = true;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.draw();
  };
  ImageView.prototype.toDataUrl = function () {
    return this.canvas.toDataURL('image/png');
  };
  ImageView.prototype.destroy = function () {
    this.host.innerHTML = '';
  };

  global.DawnImage = { ImageView: ImageView };
})(typeof globalThis !== 'undefined' ? globalThis : window);
