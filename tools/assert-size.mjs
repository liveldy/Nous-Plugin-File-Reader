// 打包后自检：体积、资源数、清单与文件是否对上，并打印 SHA-256 供发行包使用。
// node tools/assert-size.mjs
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const file = path.join(root, 'dist', 'app.nous.file-reader-1.0.0.nous-plugin.json');
const LIMIT_BYTES = 4 * 1024 * 1024;
const LIMIT_FILES = 256;

const info = await stat(file);
const text = await readFile(file, 'utf8');
const bundle = JSON.parse(text);
const files = Object.keys(bundle.files);
// 打包会按文件表重建资源清单，这里与源清单对照，确保两边没有漏项
const source = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const declared = source.resources || [];

const problems = [];
if (info.size > LIMIT_BYTES) problems.push(`包体 ${info.size} 字节，超过 ${LIMIT_BYTES}`);
if (files.length > LIMIT_FILES) problems.push(`资源 ${files.length} 个，超过 ${LIMIT_FILES}`);
for (const name of declared) {
  if (!(name in bundle.files)) problems.push(`清单里的资源没有打进包：${name}`);
}
for (const name of files) {
  if (declared.indexOf(name) < 0) problems.push(`包里有清单没声明的资源：${name}`);
}

const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');
console.log(JSON.stringify({
  file: path.relative(root, file),
  bytes: info.size,
  files: files.length,
  resources: declared.length,
  sha256: sha256,
  ok: problems.length === 0,
  problems: problems,
}, null, 1));
if (problems.length) process.exit(1);
