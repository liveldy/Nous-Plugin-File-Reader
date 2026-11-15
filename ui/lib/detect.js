/* 文件格式识别：先看魔数，再退到扩展名。返回给界面用的分类和说明。 */
(function (global) {
  'use strict';

  const EXT = {
    md: ['md', 'markdown', 'mdx'], json: ['json', 'jsonc'], table: ['csv', 'tsv', 'psv'],
    config: ['ini', 'toml', 'yaml', 'yml', 'conf', 'cfg', 'properties', 'env', 'gitignore', 'editorconfig'],
    xml: ['xml', 'svg', 'plist', 'xaml', 'rss', 'atom'],
    html: ['html', 'htm', 'xhtml'],
    pdf: ['pdf'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tif', 'tiff', 'heic'],
    audio: ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'aiff', 'wma'],
    video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'ts'],
    archive: ['zip', 'jar', 'apk', '7z', 'rar', 'gz', 'tgz', 'bz2', 'xz', 'tar'],
    model: ['stl', 'obj', 'ply', 'glb', 'gltf', 'fbx', '3mf', 'step', 'stp', 'iges', 'igs', 'dae'],
    font: ['ttf', 'otf', 'woff', 'woff2'],
  };

  const CODE_NAMES = {
    c: 'C', h: 'C 头文件', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++ 头文件', hh: 'C++ 头文件',
    js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', jsx: 'JavaScript',
    py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', swift: 'Swift', cs: 'C#',
    php: 'PHP', rb: 'Ruby', sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell',
    sql: 'SQL', lua: 'Lua', dart: 'Dart', scala: 'Scala', r: 'R', m: 'Objective-C', mm: 'Objective-C',
    css: 'CSS', scss: 'SCSS', less: 'Less', vue: 'Vue', svelte: 'Svelte', gradle: 'Gradle',
    bat: '批处理', cmd: '批处理', makeup: 'Makefile', mk: 'Makefile', dockerfile: 'Dockerfile',
    asm: '汇编', s: '汇编', v: 'Verilog', vhd: 'VHDL', tex: 'LaTeX', proto: 'Protobuf', ttf: '字体',
  };

  const DOC = { docx: 'Word 文档', docm: 'Word 文档', xlsx: 'Excel 表格', xlsm: 'Excel 表格', pptx: '演示文稿', ppsx: '演示文稿', epub: 'EPUB 电子书', odt: 'ODT 文档', ods: 'ODS 表格' };

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function has(bytes, at, sig) {
    if (bytes.length < at + sig.length) return false;
    for (let i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return false;
    return true;
  }
  function ascii(bytes, at, len) {
    let s = '';
    for (let i = 0; i < len && at + i < bytes.length; i++) s += String.fromCharCode(bytes[at + i]);
    return s;
  }

  function categoryOf(ext) {
    for (const cat of Object.keys(EXT)) if (EXT[cat].indexOf(ext) >= 0) return cat;
    if (CODE_NAMES[ext]) return 'code';
    if (DOC[ext]) return 'document';
    return '';
  }

  function magic(bytes, size) {
    if (!bytes || !bytes.length) return '';
    if (has(bytes, 0, [0x89, 0x50, 0x4e, 0x47])) return 'png';
    if (has(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpg';
    if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return 'wav';
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'AVI ') return 'avi';
    if (has(bytes, 0, [0x42, 0x4d])) return 'bmp';
    if (has(bytes, 0, [0x00, 0x00, 0x01, 0x00])) return 'ico';
    if (has(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) || has(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
    if (ascii(bytes, 4, 4) === 'ftyp') {
      const brand = ascii(bytes, 8, 4).trim();
      if (/heic|heix|mif1/.test(brand)) return 'heic';
      if (/avif|avis/.test(brand)) return 'avif';
      if (/M4A|M4B|m4a|mp42/.test(brand) && /M4A/.test(brand)) return 'm4a';
      return 'mp4';
    }
    if (ascii(bytes, 0, 4) === 'fLaC') return 'flac';
    if (ascii(bytes, 0, 4) === 'OggS') return 'ogg';
    if (ascii(bytes, 0, 3) === 'ID3' || has(bytes, 0, [0xff, 0xfb]) || has(bytes, 0, [0xff, 0xf3])) return 'mp3';
    if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
    if (has(bytes, 0, [0x50, 0x4b, 0x03, 0x04]) || has(bytes, 0, [0x50, 0x4b, 0x05, 0x06])) return 'zip';
    if (has(bytes, 0, [0x1f, 0x8b])) return 'gz';
    if (ascii(bytes, 0, 4) === 'Rar!') return 'rar';
    if (has(bytes, 0, [0x37, 0x7a, 0xbc, 0xaf])) return '7z';
    if (has(bytes, 0, [0x7f, 0x45, 0x4c, 0x46])) return 'elf';
    if (ascii(bytes, 0, 2) === 'MZ') return 'exe';
    if (has(bytes, 0, [0xfe, 0xed, 0xfa, 0xce]) || has(bytes, 0, [0xcf, 0xfa, 0xed, 0xfe]) || has(bytes, 0, [0xca, 0xfe, 0xba, 0xbe])) return 'macho';
    if (ascii(bytes, 0, 4) === 'wOFF') return 'woff';
    if (ascii(bytes, 0, 4) === 'wOF2') return 'woff2';
    if (has(bytes, 0, [0x00, 0x01, 0x00, 0x00]) || ascii(bytes, 0, 4) === 'OTTO' || ascii(bytes, 0, 4) === 'true') return 'ttf';
    if (ascii(bytes, 0, 4) === 'glTF') return 'glb';
    if (ascii(bytes, 0, 3) === 'ply') return 'ply';
    if (ascii(bytes, 0, 15) === 'SQLite format 3') return 'sqlite';
    if (ascii(bytes, 0, 4) === '{\\rt') return 'rtf';
    if (ascii(bytes, 0, 5) === '<?xml') return 'xml';
    if (/^\s*<(!doctype html|html)/i.test(ascii(bytes, 0, 200))) return 'html';
    return '';
  }

  function looksBinary(bytes) {
    const n = Math.min(bytes.length, 4096);
    let weird = 0;
    for (let i = 0; i < n; i++) {
      const b = bytes[i];
      if (b === 0) return true;
      if (b < 7 || (b > 13 && b < 27)) weird++;
    }
    return n > 0 && weird / n > 0.12;
  }

  function detect(name, bytes, size) {
    const ext = extOf(name);
    const magicType = magic(bytes, size);
    let category = categoryOf(ext);
    let format = ext;

    if (!category) {
      if (DOC[ext]) category = 'document';
      else if (magicType) {
        if (['png', 'jpg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'avif', 'heic'].indexOf(magicType) >= 0) category = 'image';
        else if (['mp4', 'avi'].indexOf(magicType) >= 0) category = 'video';
        else if (['wav', 'mp3', 'flac', 'ogg', 'm4a'].indexOf(magicType) >= 0) category = 'audio';
        else if (magicType === 'pdf') category = 'pdf';
        else if (['zip', 'gz', 'rar', '7z'].indexOf(magicType) >= 0) category = 'archive';
        else if (['stl', 'ply', 'glb'].indexOf(magicType) >= 0) category = 'model';
        else if (['ttf', 'woff', 'woff2'].indexOf(magicType) >= 0) category = 'font';
        else category = 'binary';
      } else if (bytes && bytes.length && !looksBinary(bytes)) category = 'text';
      else category = 'binary';
      if (magicType && magicType !== ext) format = magicType;
    }

    if (!format && magicType) format = magicType;

    // 文本类再细分
    if (category === 'text') {
      if (ext === 'md' || ext === 'markdown') category = 'md';
      else if (ext === 'json') category = 'json';
      else if (['csv', 'tsv', 'psv'].indexOf(ext) >= 0) category = 'table';
      else if (['ini', 'toml', 'yaml', 'yml', 'conf', 'cfg', 'properties', 'env', 'editorconfig'].indexOf(ext) >= 0) category = 'config';
      else if (['xml', 'plist', 'xaml', 'rss', 'atom'].indexOf(ext) >= 0) category = 'xml';
      else if (['html', 'htm', 'xhtml'].indexOf(ext) >= 0) category = 'html';
      else if (CODE_NAMES[ext]) category = 'code';
    }
    if (category === 'archive' && DOC[ext]) category = 'document';
    if (category === 'binary' && DOC[ext]) category = 'document';

    // 无扩展名的文本猜一下结构
    if (category === 'text' && bytes) {
      const head = ascii(bytes, 0, Math.min(bytes.length, 200)).trim();
      if (head.startsWith('{') || head.startsWith('[')) { category = 'json'; format = 'json'; }
    }

    return {
      category: category,
      format: format || 'bin',
      label: labelOf(category, format, ext),
      ext: ext,
    };
  }

  function labelOf(category, format, ext) {
    if (category === 'code') return CODE_NAMES[ext] || '源码';
    if (category === 'document') return DOC[ext] || '文档';
    if (category === 'md') return 'Markdown';
    if (category === 'json') return 'JSON';
    if (category === 'table') return format === 'tsv' ? 'TSV 表格' : 'CSV 表格';
    if (category === 'config') return ({ ini: 'INI', toml: 'TOML', yaml: 'YAML', yml: 'YAML', conf: '配置', cfg: '配置', properties: 'PROPERTIES', env: '环境变量' })[ext] || '配置';
    if (category === 'xml') return 'XML';
    if (category === 'html') return 'HTML';
    if (category === 'image') return '图像';
    if (category === 'audio') return '音频';
    if (category === 'video') return '视频';
    if (category === 'archive') return format === 'gz' ? 'GZIP 压缩' : '压缩包';
    if (category === 'model') return '三维模型';
    if (category === 'font') return '字体';
    if (category === 'pdf') return 'PDF';
    if (category === 'text') return '纯文本';
    return '二进制';
  }

  global.DawnDetect = { detect: detect, extOf: extOf, looksBinary: looksBinary, ascii: ascii };
})(typeof globalThis !== 'undefined' ? globalThis : window);
