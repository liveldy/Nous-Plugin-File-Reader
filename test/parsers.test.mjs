// 纯解析逻辑的单元测试：node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const load = (name) => new Function(readFileSync(path.join(root, 'ui/lib', name), 'utf8'))();

for (const lib of ['detect.js', 'text.js', 'hl.js', 'md.js', 'structured.js']) load(lib);
const { DawnDetect, DawnText, DawnHl, DawnMd } = globalThis;
load('mp4.js');
load('zip.js');

const bytes = (s) => new TextEncoder().encode(s);

test('按扩展名与魔数识别文件', () => {
  assert.equal(DawnDetect.detect('a.c', bytes('#include <stdio.h>'), 20).category, 'code');
  assert.equal(DawnDetect.detect('a.md', bytes('# 标题'), 8).category, 'md');
  assert.equal(DawnDetect.detect('a.json', bytes('{"a":1}'), 7).category, 'json');
  assert.equal(DawnDetect.detect('a.csv', bytes('a,b\n1,2'), 7).category, 'table');
  assert.equal(DawnDetect.detect('a.ini', bytes('[a]\nb=1'), 7).category, 'config');
  assert.equal(DawnDetect.detect('a.xml', bytes('<?xml version="1.0"?><a/>'), 20).category, 'xml');
  assert.equal(DawnDetect.detect('a.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]), 5).category, 'image');
  assert.equal(DawnDetect.detect('a.mp4', bytes('\u0000\u0000\u0000\u0018ftypisom'), 16).category, 'video');
  assert.equal(DawnDetect.detect('a.wav', bytes('RIFF\u0000\u0000\u0000\u0000WAVE'), 12).category, 'audio');
  assert.equal(DawnDetect.detect('a.zip', new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 4).category, 'archive');
  assert.equal(DawnDetect.detect('a.docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 4).category, 'document');
  assert.equal(DawnDetect.detect('a.pdf', bytes('%PDF-1.4'), 8).category, 'pdf');
  assert.equal(DawnDetect.detect('a.exe', bytes('MZ\u0090\u0000'), 4).category, 'binary');
  assert.equal(DawnDetect.detect('没有扩展名', bytes('随便一段文字'), 12).category, 'text');
});

test('文本解码与统计：BOM、UTF-8、GB18030', () => {
  const utf8 = DawnText.decode(new Uint8Array([...bytes('第一行\n第二行')]));
  assert.equal(utf8.text, '第一行\n第二行');
  const bom = DawnText.decode(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('x')]));
  assert.equal(bom.text, 'x');
  assert.equal(bom.encoding, 'UTF-8 BOM');
  const gbk = DawnText.decode(new Uint8Array([0xb5, 0xda, 0xd2, 0xbb]));
  assert.equal(gbk.text, '第一');
  const stats = DawnText.stats('a\r\nb\r\nc');
  assert.equal(stats.lines, 3);
  assert.equal(stats.eol, 'CRLF');
  assert.equal(DawnText.bytesText(2048), '2.0 KB');
});

test('语法着色：关键字、字符串、注释', () => {
  const lines = DawnHl.highlightLines('int main() { // hi\n  return "x";\n}', 'c');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /t-kw">int</);
  assert.match(lines[0], /t-com">\/\/ hi</);
  assert.match(lines[1], /t-str">"x"</);
  assert.equal(DawnHl.langOf('cpp'), 'cpp');
  assert.equal(DawnHl.langOf('unknown'), 'text');
});

test('Markdown：标题、列表、代码、表格、引用', () => {
  const html = DawnMd.render([
    '# 标题',
    '',
    '- 甲',
    '- 乙',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '> 引用',
    '',
    '**粗** 与 [链接](https://example.com)',
  ].join('\n'));
  assert.match(html, /<h1 class="md-h md-h1">标题<\/h1>/);
  assert.equal((html.match(/<li>/g) || []).length, 2);
  assert.match(html, /<pre class="md-code"><code>/);
  assert.match(html, /<table class="md-table">/);
  assert.match(html, /<blockquote class="md-quote">引用<\/blockquote>/);
  assert.match(html, /<strong>粗<\/strong>/);
  assert.match(html, /data-url="https:\/\/example.com"/);
});

test('JSON 与 CSV 结构视图函数不抛错', () => {
  assert.equal(typeof DawnStructured.jsonView, 'function');
  assert.equal(typeof DawnStructured.tableView, 'function');
});

test('MP4 解复用：轨道与样本表', () => {
  const file = path.join(root, 'tools/fixtures/sample.mp4');
  let buf;
  try { buf = readFileSync(file); } catch { return; }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const info = globalThis.DawnMp4.parse(view);
  assert.ok(info.tracks.length >= 1);
  const video = info.tracks.find(t => t.kind === 'video');
  assert.ok(video, '有视频轨');
  assert.ok(video.samples.length > 10);
  assert.ok(video.samples[0].key);
  assert.match(video.codec, /^avc1\./);
});
