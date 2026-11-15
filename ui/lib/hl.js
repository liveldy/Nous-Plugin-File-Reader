/* 轻量语法着色：按语言配置切出注释、字符串、数字、关键字与调用名。
   输出逐行的 HTML 片段，供只读视图与编辑器共用。 */
(function (global) {
  'use strict';

  const LANGS = {
    c: { line: '//', block: ['/*', '*/'], quotes: '"\'', kw: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL nullptr class public private protected template typename namespace using new delete this operator friend virtual override constexpr nullptr_t' },
    cpp: { line: '//', block: ['/*', '*/'], quotes: '"\'', kw: 'auto break case catch char class const constexpr continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int lambda long mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast return short signed sizeof static_cast struct switch template this throw true try typedef typename union unsigned using virtual void volatile while bool std string vector map unique_ptr shared_ptr' },
    js: { line: '//', block: ['/*', '*/'], quotes: '"\'`', kw: 'async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while yield' },
    ts: { line: '//', block: ['/*', '*/'], quotes: '"\'`', kw: 'abstract any as async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface keyof let module namespace never new null number object of private protected public readonly return set static string super switch symbol this throw true try type typeof undefined unique unknown var void while yield' },
    py: { line: '#', block: ['"""', '"""'], quotes: '"\'', kw: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self print len range enumerate zip map filter' },
    rs: { line: '//', block: ['/*', '*/'], quotes: '"\'', kw: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while' },
    go: { line: '//', block: ['/*', '*/'], quotes: '"`\'', kw: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil' },
    java: { line: '//', block: ['/*', '*/'], quotes: '"\'', kw: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var true false null record' },
    cs: { line: '//', block: ['/*', '*/'], quotes: '"\'', kw: 'abstract as base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await' },
    php: { line: '//', block: ['/*', '*/'], quotes: '"\'' , kw: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null' },
    rb: { line: '#', block: ['=begin', '=end'], quotes: '"\'', kw: 'alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield puts require attr_accessor' },
    sh: { line: '#', quotes: '"\'', kw: 'case do done elif else esac fi for function if in local return select then until while export echo set source cd exit eval trap' },
    ps1: { line: '#', block: ['<#', '#>'], quotes: '"\'', kw: 'begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while write-host get-childitem set-location' },
    sql: { line: '--', block: ['/*', '*/'], quotes: '\'"', kw: 'add all alter and any as asc backup between by case check column commit constraint create database default delete desc distinct drop exec exists foreign from full group having if in index inner insert into is join key left like limit not null on or order outer primary procedure right rollback rownum select set table top truncate union unique update values view where with' },
    lua: { line: '--', block: ['--[[', ']]'], quotes: '"\'\'', kw: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while' },
    css: { line: '', block: ['/*', '*/'], quotes: '"\'\'', kw: 'important media supports keyframes import charset font-face from to and not only' },
    ini: { line: ';', quotes: '"\'\'', kw: 'true false null on off yes no' },
    toml: { line: '#', quotes: '"\'\'', kw: 'true false' },
    yaml: { line: '#', quotes: '"\'\'', kw: 'true false null yes no on off' },
    json: { line: '', quotes: '"', kw: 'true false null' },
    xml: { line: '', block: ['<!--', '-->'], quotes: '"\'\'', kw: '' },
    tex: { line: '%', quotes: '', kw: 'begin end section subsection documentclass usepackage textbf textit item' },
    dart: { line: '//', block: ['/*', '*/'], quotes: '"\'\'', kw: 'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield' },
    swift: { line: '//', block: ['/*', '*/'], quotes: '"', kw: 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil super self throw throws true try' },
    kotlin: { line: '//', block: ['/*', '*/'], quotes: '"\'', kw: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set where' },
    objc: { line: '//', block: ['/*', '*/'], quotes: '"\'', kw: 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while id self super nil YES NO interface implementation property synthesize import' },
    asm: { line: ';', quotes: '"\'\'', kw: 'mov push pop add sub cmp jmp je jne call ret lea inc dec xor and or shl shr int nop section global db dw dd' },
  };

  const ALIAS = {
    cpp: 'cpp', h: 'cpp', cc: 'cpp', hpp: 'cpp', cxx: 'cpp', hh: 'cpp', c: 'c',
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts',
    py: 'py', rs: 'rs', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', cs: 'cs',
    php: 'php', rb: 'rb', sh: 'sh', bash: 'sh', zsh: 'sh', ps1: 'ps1', sql: 'sql', lua: 'lua',
    css: 'css', scss: 'css', less: 'css', ini: 'ini', toml: 'toml', yaml: 'yaml', yml: 'yaml',
    json: 'json', jsonc: 'json', xml: 'xml', html: 'xml', svg: 'xml', xaml: 'xml', plist: 'xml',
    tex: 'tex', dart: 'dart', m: 'objc', mm: 'objc', asm: 'asm', s: 'asm', vue: 'ts', svelte: 'ts',
    proto: 'cpp', gradle: 'kotlin',
  };

  function escape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function langOf(ext) { return ALIAS[ext] || 'text'; }

  // 返回 [{type,text}]，type: kw/str/num/com/punct/ident/plain
  function tokenize(text, lang) {
    const cfg = LANGS[lang];
    if (!cfg) return [{ type: 'plain', text: text }];
    const out = [];
    const kw = cfg.kw ? new Set(cfg.kw.split(/\s+/).filter(Boolean)) : new Set();
    const block = cfg.block;
    let i = 0;
    const n = text.length;
    let plain = '';
    const flush = () => { if (plain) { out.push({ type: 'plain', text: plain }); plain = ''; } };

    while (i < n) {
      const ch = text[i];

      if (block && text.startsWith(block[0], i)) {
        const end = text.indexOf(block[1], i + block[0].length);
        const stop = end < 0 ? n : end + block[1].length;
        flush();
        out.push({ type: 'com', text: text.slice(i, stop) });
        i = stop;
        continue;
      }
      if (cfg.line && text.startsWith(cfg.line, i) && !(lang === 'sql' && ch === '-' && text[i - 1] === '-')) {
        const end = text.indexOf('\n', i);
        const stop = end < 0 ? n : end;
        flush();
        out.push({ type: 'com', text: text.slice(i, stop) });
        i = stop;
        continue;
      }
      if (cfg.quotes && cfg.quotes.indexOf(ch) >= 0) {
        let j = i + 1;
        while (j < n) {
          if (text[j] === '\\' && lang !== 'xml') { j += 2; continue; }
          if (text[j] === ch) { j++; break; }
          if (text[j] === '\n' && ch !== '`') break;
          j++;
        }
        flush();
        out.push({ type: 'str', text: text.slice(i, j) });
        i = j;
        continue;
      }
      if (ch === '#' && lang === 'yaml') {
        const end = text.indexOf('\n', i);
        flush();
        out.push({ type: 'com', text: text.slice(i, end < 0 ? n : end) });
        i = end < 0 ? n : end;
        continue;
      }
      if (/[0-9]/.test(ch) && !/[A-Za-z_$]/.test(text[i - 1] || '')) {
        let j = i;
        while (j < n && /[0-9a-fA-FxXoObB._eE+-]/.test(text[j])) j++;
        flush();
        out.push({ type: 'num', text: text.slice(i, j) });
        i = j;
        continue;
      }
      if (/[A-Za-z_$@]/.test(ch)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$]/.test(text[j])) j++;
        const word = text.slice(i, j);
        flush();
        if (kw.has(word)) out.push({ type: 'kw', text: word });
        else out.push({ type: 'ident', text: word });
        i = j;
        continue;
      }
      plain += ch;
      i++;
    }
    flush();
    return out;
  }

  // 转成按行切好的 HTML 数组（行号与内容分离，便于虚拟滚动）
  function highlightLines(text, lang) {
    const tokens = tokenize(text, lang);
    const lines = [[]];
    const push = (cls, s) => {
      const parts = s.split('\n');
      for (let p = 0; p < parts.length; p++) {
        if (p > 0) lines.push([]);
        if (parts[p]) lines[lines.length - 1].push(cls ? '<span class="t-' + cls + '">' + escape(parts[p]) + '</span>' : escape(parts[p]));
      }
    };
    for (const tk of tokens) {
      const cls = tk.type === 'plain' ? '' : tk.type;
      push(cls, tk.text);
    }
    return lines.map(l => l.join(''));
  }

  global.DawnHl = { highlightLines: highlightLines, langOf: langOf, escape: escape, LANGS: LANGS };
})(typeof globalThis !== 'undefined' ? globalThis : window);
