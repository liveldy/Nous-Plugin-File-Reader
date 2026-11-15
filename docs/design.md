# 设计说明

## 目标

一个插件读完手上的文件，不在类型之间来回切应用。判断标准很朴素：**打开任何文件，都该看到它本来的样子**——源码看到着色，表格看到行列，图像看到像素，视频看到画面，未知字节看到偏移。能给更多就再给一层：改一行代码、裁一块图、圈一段音频、看压缩包里那个文件。

## 宿主环境的实测约束

插件页跑在 `sandbox="allow-scripts allow-forms"` 的 iframe 里，CSP 是 `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; ...`。摸清边界之后才有现在的实现：

| 想做的事 | 沙箱里的实测结果 | 采取的做法 |
| --- | --- | --- |
| 用 `<img src=blob:>` 显示图 | 被 CSP 拦 | 读成 data URL，`img-src data:` 放行 |
| 用 `<video>` / `<audio>` 播 | `media-src` 落到 `default-src none`，静默失败 | 音频 `decodeAudioData` 解 PCM 自己画波形、Web Audio 播；视频 WebCodecs 解帧画到 canvas |
| 用 `showSaveFilePicker` 另存 | 抛 `SecurityError` | 不提供另存；编辑结果走宿主剪贴板（≤ 30000 字符） |
| 用 `<a download>` 导出 | 被 sandbox 拦 | 同上，界面里如实说明 |
| `localStorage` | 不可用 | 走宿主 `storage.get/set`（64 KiB） |
| 发网络请求 | `connect-src 'none'` | 全部解析在本地完成；外链交 `external.open` |
| 字体 | `font-src data:` | Geist / Geist Mono 以 `@font-face` + data URL 内联进包 |

打包侧的硬指标是 4 MiB / 256 个资源，`sdk/pack.mjs` 只把二进制转成 data URL；真正的内联（link→style、script→inline、CSS `url()`→data URL）由宿主的 `sdk/protocol.mjs` 完成，所以本机的 `tools/harness.mjs` 也必须是它来生成页面，否则测的不是宿主看到的东西。

## 识别顺序

1. 读文件头 64 KiB，按魔数判断：`%PDF`、`PK\x03\x04`（再分辨 docx/xlsx/pptx）、`ftyp`（MP4/MOV）、RIFF/WAVE、PNG、JPEG、GIF、WebP、PE `MZ`、ELF、Mach-O、ZIP、GLB 等。
2. 魔数没结论再用扩展名。
3. 都没有就当文本试解码：BOM → UTF-8 → GB18030，坏字节太多就退到二进制视图。

类别决定挂载哪个视图，视图之间是并列的（源码 / 阅读 / 结构 / 大纲），不是层层套娃。文本设了 24 MB 上限，超过就截断并标记，避免一次解码把内存打满。

## 只在必要处自研

能交给浏览器的都交出去：图像解码、音频 PCM 解码、视频解码器、`DecompressionStream` 解 deflate、Web Audio 混音。自己写的只有浏览器不给的部分：

- **文本着色**：约 20 种语言的轻量 tokenizer，输出逐行 HTML；虚拟滚动只渲染可视区域，几百万行的文件也能滚。
- **编辑器**：透明 textarea 叠在着色层上，光标、选择、输入法都交给浏览器，自己只管行号、缩进、括号配对和补全列表；补全来源是关键字、片段和文中出现过的标识符。
- **MP4 解复用**：读 `moov`，从 `stts/ctts/stsc/stsz/stco/stss` 还原样本表，给 WebCodecs 喂 `EncodedVideoChunk`。解码器要背压，所以限制解码队列长度、按播放位置 `prune` 掉旧帧；跳转时 `reset()` 后重配并从关键帧重喂。
- **ZIP 与 Office**：读中央目录，按需解压单个条目；docx 走 `w:p` / `w:tbl`，xlsx 走 `sharedStrings` + `sheet*.xml`，pptx 按幻灯片抽文本。
- **PDF**：解析 xref 与对象，`FlateDecode` 解流，从内容流里取文本操作符。只有文本层，扫描件按“未抽到”处理并给出说明。
- **三维**：STL / OBJ / PLY / GLB 只取点与包围盒；面数少于 2400 时铺三角面加描边并按深度排序，面多就退化成点云。

## 界面

一屏一个任务：左边是文件列表，右边是文件本身，工具条只放当前视图用得上的动作。没有多余的说明文字和标签——版式、单位和数值自己会说话。暗色是默认，浅色跟随宿主主题事件切换；两种主题的正文与辅助文字都在 4.5:1 以上，可点区域不小于 28 px，键盘焦点有 `:focus-visible` 描边，窄到 900 px 以下时列表转为横向、工具条换行。

## 关于设计检查

用 taste-skill 的检查器（`consistency.mjs`，1440/1024/768/390 四档）跑过 `dist/harness.html`：13 项 FAIL、8 项 WARN，全部落在落地页规则上——因为检查器看到的是宿主同构页，产品界面在它的 sandbox iframe 里，它读不到。逐条处置：

| 检查项 | 处置 | 理由 |
| --- | --- | --- |
| `container-edges`（页面应切成 nav / main / footer） | 豁免 | 外层是宿主同构页，插件页面由 iframe 承载，没有营销结构 |
| `copy-headline` / `copy-fact` / `heading-scale` | 豁免 | 应用首屏不是营销 hero；文档本身有唯一 h1（品牌名），标题层级为 h1 → h2（文件名）→ 小节 |
| `cta`（hero 缺按钮） | 豁免 | 首屏的主操作就是顶栏「打开文件」，与内容区同属一个工具条而非 hero 区 |
| `no-visual` | 豁免 | 检查器看不到 iframe 内部；每个视图都有实际内容（见 `docs/shots/`） |
| `moment-none` / `share-meta` / `skip-link` | 豁免 | 动效、分享元数据、跳转锚点属于对外发布页；插件没有 `head` 控制权 |

对比度、点击尺寸和横向溢出没有豁免，而是在插件页内单独量过：两套主题下抽查的正文、辅助文字、按钮、分段控件全部 ≥ 4.5:1，可点元素高度 ≥ 28 px，900 × 620 与 390 px 宽度下 `scrollWidth == clientWidth`。

`tools/harness.mjs` 用宿主同款握手（`frame.ready` → `render` → `rendered` → `init`）把打包产物装进带同样 CSP 和 sandbox 的 iframe，父页按 `src/plugins/PluginPage.tsx` 的形状回答 `clipboard.write`、`storage.*`、`external.open`、`host.info`。本机看到的就是宿主看到的。

## 已知限制

- 编辑结果不能另存成文件，只能复制带走（沙箱没有写文件通道）。
- 视频支持 MP4 / MOV 的 H.264、HEVC、AV1、VP9 视频与 AAC 音频；没有 `moov` 的分片 MP4、超过 512 MB 的文件直接说清楚不解码。
- PDF 只抽文本层，不做版面还原，不渲染图像。
- docx / pptx 只取文字，样式、图片、表格边框不还原。
- 二进制视图只解释常见签名；其余显示偏移与字节。
