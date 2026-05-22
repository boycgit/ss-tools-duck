#!/usr/bin/env node
/**
 * duck-cli.js — SS_tools Duck 隐写命令行工具
 *
 * 用法：
 *   node duck-cli.js encode text   [选项] <输出路径>
 *   node duck-cli.js encode image  [选项] <输出路径>
 *   node duck-cli.js encode bytes  [选项] <输出路径>
 *   node duck-cli.js encode video  [选项] <输出路径>    （需系统 ffmpeg）
 *   node duck-cli.js encode frames [选项] <输出路径>    （需系统 ffmpeg）
 *   node duck-cli.js decode        [选项] <输入路径>
 *   node duck-cli.js check-ffmpeg
 *   node duck-cli.js help
 *
 * 完整帮助：node duck-cli.js help
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── 彩色输出 ─────────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

function ok(msg)   { console.log(`${C.green}✅ ${msg}${C.reset}`); }
function err(msg)  { console.error(`${C.red}❌ ${msg}${C.reset}`); }
function info(msg) { console.log(`${C.cyan}ℹ  ${msg}${C.reset}`); }
function warn(msg) { console.warn(`${C.yellow}⚠  ${msg}${C.reset}`); }

// ─── 参数解析 ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        // 下一个 token 若不以 -- 开头则是值，否则是布尔
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }

  return { flags, positional };
}

// ─── 帮助文本 ─────────────────────────────────────────────────────────────────

const HELP_TEXT = `
${C.bold}SS_tools Duck 隐写 CLI${C.reset}

${C.bold}用法${C.reset}
  node duck-cli.js <命令> [子命令] [选项] [路径]

${C.bold}命令${C.reset}

  ${C.cyan}encode text${C.reset}  <输出.png>
      将文本隐藏到鸭子图中
      选项：
        --text=<内容>         要隐藏的文本（与 --text-file 二选一）
        --text-file=<路径>    从文件读取文本
        --password=<密码>     加密密码（留空=不加密）
        --title=<标题>        鸭子图标题
        --compress=<2|6|8>    压缩比（默认：2）

  ${C.cyan}encode image${C.reset}  <输出.png>
      将图片隐藏到鸭子图中
      选项：
        --input=<路径>        输入图片路径（必填）
        --password=<密码>
        --title=<标题>
        --compress=<2|6|8>

  ${C.cyan}encode bytes${C.reset}  <输出.png>
      将任意文件隐藏到鸭子图中
      选项：
        --input=<路径>        输入文件路径（必填）
        --ext=<扩展名>        文件扩展名（如 pdf、zip；默认取输入文件扩展名）
        --password=<密码>
        --title=<标题>
        --compress=<2|6|8>

  ${C.cyan}encode video${C.reset}  <输出.png>
      将 MP4 视频隐藏到鸭子图中（binpng 格式）
      选项：
        --input=<路径>        输入 MP4 文件路径（必填）
        --password=<密码>
        --title=<标题>
        --compress=<2|6|8>

  ${C.cyan}encode frames${C.reset}  <输出.png>
      将图片帧序列合成为 MP4，再隐藏到鸭子图
      需要系统安装 ffmpeg
      选项：
        --frames=<glob>       帧图片 glob（如 "frames/*.png"）
        --fps=<帧率>          默认 24
        --audio=<路径>        音频文件路径（可选）
        --password=<密码>
        --title=<标题>
        --compress=<2|6|8>

  ${C.cyan}decode${C.reset}  <输入.png>
      从鸭子图中还原隐藏数据
      选项：
        --password=<密码>     加密密码
        --output=<目录>       输出目录（默认：当前目录）
        --json                只输出 JSON 元数据，不保存文件

  ${C.cyan}check-ffmpeg${C.reset}
      检查系统 ffmpeg 是否可用

  ${C.cyan}help${C.reset}
      显示本帮助

${C.bold}示例${C.reset}

  # 隐藏文本
  node duck-cli.js encode text output.png --text="Hello 世界" --password=123

  # 隐藏图片
  node duck-cli.js encode image output.png --input=photo.jpg --compress=6

  # 隐藏任意文件
  node duck-cli.js encode bytes output.png --input=document.pdf

  # 解码
  node duck-cli.js decode output.png --password=123 --output=./result

  # 合成视频并隐藏
  node duck-cli.js encode frames output.png --frames="./frames/*.png" --fps=30

${C.gray}注意：encode frames / encode video 需要系统安装 ffmpeg 并在 PATH 中可用${C.reset}
`;

// ─── 主逻辑 ───────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);

  const [cmd, sub] = positional;
  const outputPath  = positional[2];

  if (!cmd || cmd === 'help' || flags.help) {
    console.log(HELP_TEXT);
    return;
  }

  // ── check-ffmpeg ──────────────────────────────────────────────────────────
  if (cmd === 'check-ffmpeg') {
    const { checkFfmpegAvailable } = require('./duck_video');
    const available = await checkFfmpegAvailable();
    if (available) ok('ffmpeg 可用');
    else err('ffmpeg 不可用，请安装后将其加入 PATH');
    return;
  }

  // ── decode ────────────────────────────────────────────────────────────────
  if (cmd === 'decode') {
    const inputPath = positional[1];
    if (!inputPath) { err('请提供输入文件路径'); process.exit(1); }
    if (!fs.existsSync(inputPath)) { err(`文件不存在：${inputPath}`); process.exit(1); }

    const { decodeFromFile } = require('./duck_decode');

    const password  = flags.password || '';
    const outputDir = flags.output   || process.cwd();

    info(`正在解码：${inputPath} …`);
    try {
      const result = await decodeFromFile(inputPath, password, outputDir);

      if (flags.json) {
        const meta = {
          ext:       result.ext,
          filePath:  result.filePath  || null,
          text:      result.text      || null,
          dataBytes: result.data ? result.data.length : 0,
        };
        console.log(JSON.stringify(meta, null, 2));
      } else {
        ok(`解码成功（ext=${result.ext}）`);
        if (result.text)     info(`文本内容：${result.text}`);
        if (result.filePath) info(`文件已保存：${result.filePath}`);
      }
    } catch (e) {
      err(`解码失败：${e.message}`);
      process.exit(1);
    }
    return;
  }

  // ── encode ────────────────────────────────────────────────────────────────
  if (cmd === 'encode') {
    if (!sub) { err('请指定编码子命令：text / image / bytes / video / frames'); process.exit(1); }
    if (!outputPath) { err('请提供输出文件路径'); process.exit(1); }

    const password = flags.password || '';
    const title    = flags.title    || '';
    const compress = parseInt(flags.compress || '2', 10);

    // ── encode text ──────────────────────────────────────────────────────────
    if (sub === 'text') {
      let text = flags.text;
      if (!text && flags['text-file']) {
        if (!fs.existsSync(flags['text-file'])) { err(`文件不存在：${flags['text-file']}`); process.exit(1); }
        text = fs.readFileSync(flags['text-file'], 'utf8');
      }
      if (!text) { err('请通过 --text 或 --text-file 提供文本'); process.exit(1); }

      const { encodeText } = require('./duck_encode');
      info('正在编码文本 …');
      const { filePath } = await encodeText({ text, password, title, compress, outputPath });
      ok(`已写出：${filePath}`);
      return;
    }

    // ── encode image ─────────────────────────────────────────────────────────
    if (sub === 'image') {
      if (!flags.input) { err('请提供 --input'); process.exit(1); }
      if (!fs.existsSync(flags.input)) { err(`文件不存在：${flags.input}`); process.exit(1); }

      const { encodeImage } = require('./duck_encode');
      const image = fs.readFileSync(flags.input);
      info(`正在编码图片：${flags.input} …`);
      const { filePath } = await encodeImage({ image, password, title, compress, outputPath });
      ok(`已写出：${filePath}`);
      return;
    }

    // ── encode bytes ─────────────────────────────────────────────────────────
    if (sub === 'bytes') {
      if (!flags.input) { err('请提供 --input'); process.exit(1); }
      if (!fs.existsSync(flags.input)) { err(`文件不存在：${flags.input}`); process.exit(1); }

      const { encodeBytes } = require('./duck_encode');
      const rawBytes = fs.readFileSync(flags.input);
      const ext      = flags.ext || path.extname(flags.input).replace('.', '') || 'bin';
      info(`正在编码文件：${flags.input}（ext=${ext}）…`);
      const { filePath } = await encodeBytes({ rawBytes, ext, password, title, compress, outputPath });
      ok(`已写出：${filePath}`);
      return;
    }

    // ── encode video ─────────────────────────────────────────────────────────
    if (sub === 'video') {
      if (!flags.input) { err('请提供 --input（MP4 文件路径）'); process.exit(1); }
      if (!fs.existsSync(flags.input)) { err(`文件不存在：${flags.input}`); process.exit(1); }

      const { encodeMp4 } = require('./duck_encode');
      const mp4Input = fs.readFileSync(flags.input);
      info(`正在编码视频：${flags.input} …`);
      const { filePath } = await encodeMp4({ mp4Input, password, title, compress, outputPath });
      ok(`已写出：${filePath}`);
      return;
    }

    // ── encode frames ────────────────────────────────────────────────────────
    if (sub === 'frames') {
      const { glob } = await import('glob').catch(() => {
        // Node 18 之前无内置 glob，尝试 fast-glob
        return require('fast-glob').then ? require('fast-glob') : { glob: null };
      });

      // 展开 glob 路径
      const frameGlob = flags.frames;
      if (!frameGlob) { err('请提供 --frames="<glob>"'); process.exit(1); }

      let framePaths;
      try {
        // 若系统 Node 18+，用内置 fs.glob 或 glob 包
        const { globSync } = require('glob');
        framePaths = globSync(frameGlob, { absolute: true }).sort();
      } catch {
        // fallback：直接当文件路径
        framePaths = frameGlob.split(',').map(p => p.trim()).filter(Boolean);
      }

      if (framePaths.length === 0) { err(`没有匹配的帧文件：${frameGlob}`); process.exit(1); }
      info(`找到 ${framePaths.length} 帧`);

      const frames = framePaths.map(p => fs.readFileSync(p));
      const fps    = parseFloat(flags.fps || '24');
      const audio  = flags.audio || null;

      const { checkFfmpegAvailable, encodeVideoFrames } = require('./duck_video');
      if (!(await checkFfmpegAvailable())) {
        err('ffmpeg 不可用，请安装后重试');
        process.exit(1);
      }

      info(`正在合成视频（${fps}fps）并编码 …`);
      const { filePath } = await encodeVideoFrames({ frames, fps, audioPath: audio, password, title, compress, outputPath });
      ok(`已写出：${filePath}`);
      return;
    }

    err(`未知子命令：${sub}，请使用 text / image / bytes / video / frames`);
    process.exit(1);
  }

  err(`未知命令：${cmd}`);
  console.log(`运行 ${C.cyan}node duck-cli.js help${C.reset} 查看帮助`);
  process.exit(1);
}

main().catch(e => {
  err(e.message || String(e));
  process.exit(1);
});
