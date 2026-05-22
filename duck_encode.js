/**
 * duck_encode.js
 *
 * Node.js 编码器：把图片 / 文本数据隐藏进鸭子图
 * 对应 Python duck_encode_node.py 的核心逻辑（去除 ComfyUI 节点壳）
 *
 * 支持的输入类型：
 *   - 单张图片（PNG/JPEG Buffer 或文件路径）
 *   - 多张图片（Buffer 数组 —— 输出图片序列，每帧独立生成一张鸭子图）
 *   - 纯文本字符串
 *
 * 注意：视频合成（对应 Python _images_to_video）依赖 ffmpeg，本文件不包含，
 *       如需合成视频请在外部使用 fluent-ffmpeg 将帧序列合成 MP4 后，
 *       把 MP4 Buffer 通过 encodeBytes({ rawBytes, ext: 'mp4.binpng', ... }) 编码。
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');

const {
  buildFileHeader,
  exportDuckPayload,
  bytesToBinaryImage,
  requiredCanvasSize,
  embedPayloadLSB,
  buildDuckImageBuffer,
} = require('./duck_payload_exporter');

// ─── 工具：图片 Buffer → PNG 字节 ────────────────────────────────────────────

/**
 * 读取图片文件 / Buffer，统一转成 PNG Buffer
 */
async function toPngBuffer(input) {
  if (typeof input === 'string') {
    return sharp(input).toColorspace('srgb').removeAlpha().png().toBuffer();
  }
  if (Buffer.isBuffer(input)) {
    return sharp(input).toColorspace('srgb').removeAlpha().png().toBuffer();
  }
  throw new TypeError(`不支持的输入类型：${typeof input}`);
}

// ─── 主编码函数 ───────────────────────────────────────────────────────────────

/**
 * 把单张图片编码为鸭子图
 *
 * @param {object}         opts
 * @param {Buffer|string}  opts.image      输入图片（Buffer 或文件路径）
 * @param {string}         [opts.password] 加密密码
 * @param {string}         [opts.title]    鸭子图标题
 * @param {number}         [opts.compress] 压缩模式 2/6/8（默认 2）
 * @param {string}         [opts.outputPath] 若提供则保存 PNG 文件
 * @returns {Promise<{ imageBuffer: Buffer, filePath?: string }>}
 */
async function encodeImage({ image, password = '', title = '', compress = 2, outputPath = null }) {
  const pngBytes = await toPngBuffer(image);
  const result   = await exportDuckPayload({
    rawBytes: pngBytes,
    password,
    ext: 'png',
    compress,
    title,
  });

  if (outputPath) {
    await fs.promises.writeFile(outputPath, result.imageBuffer);
    return { imageBuffer: result.imageBuffer, filePath: outputPath };
  }
  return { imageBuffer: result.imageBuffer };
}

/**
 * 把纯文本编码为鸭子图
 *
 * @param {object}  opts
 * @param {string}  opts.text           待隐藏的文本（UTF-8）
 * @param {string}  [opts.password]     加密密码
 * @param {string}  [opts.title]        鸭子图标题
 * @param {number}  [opts.compress]     2/6/8（默认 2）
 * @param {string}  [opts.outputPath]   保存路径
 * @returns {Promise<{ imageBuffer: Buffer, filePath?: string }>}
 */
async function encodeText({ text, password = '', title = '', compress = 2, outputPath = null }) {
  const rawBytes = Buffer.from(text, 'utf-8');
  const result   = await exportDuckPayload({
    rawBytes,
    password,
    ext: 'txt',
    compress,
    title,
  });

  if (outputPath) {
    await fs.promises.writeFile(outputPath, result.imageBuffer);
    return { imageBuffer: result.imageBuffer, filePath: outputPath };
  }
  return { imageBuffer: result.imageBuffer };
}

/**
 * 把任意二进制数据编码为鸭子图（通用接口）
 *
 * @param {object}  opts
 * @param {Buffer}  opts.rawBytes       原始字节
 * @param {string}  opts.ext            扩展名，如 "png" / "txt" / "mp4.binpng"
 * @param {string}  [opts.password]
 * @param {string}  [opts.title]
 * @param {number}  [opts.compress]
 * @param {string}  [opts.outputPath]
 * @returns {Promise<{ imageBuffer: Buffer, filePath?: string }>}
 */
async function encodeBytes({ rawBytes, ext, password = '', title = '', compress = 2, outputPath = null }) {
  const result = await exportDuckPayload({ rawBytes, password, ext, compress, title });

  if (outputPath) {
    await fs.promises.writeFile(outputPath, result.imageBuffer);
    return { imageBuffer: result.imageBuffer, filePath: outputPath };
  }
  return { imageBuffer: result.imageBuffer };
}

/**
 * 把多张图片编码为「图片序列」（每帧一张独立的鸭子图）
 * 所有帧使用统一的画布尺寸（对应 Python combine_video=False 分支）
 *
 * @param {object}           opts
 * @param {Array<Buffer|string>} opts.images  图片数组
 * @param {string}           [opts.password]
 * @param {string}           [opts.title]
 * @param {number}           [opts.compress]
 * @param {string}           [opts.outputDir]  若提供则逐帧保存 PNG
 * @returns {Promise<{ frames: Buffer[], filePaths?: string[] }>}
 */
async function encodeImageSequence({ images, password = '', title = '', compress = 2, outputDir = null }) {
  if (!images || images.length === 0) throw new Error('images 数组不能为空');

  const lsbBits = compress >= 8 ? 8 : compress >= 6 ? 6 : 2;

  // 第一步：把所有帧转为 PNG 并构建文件头，计算最大所需尺寸
  const pngList    = await Promise.all(images.map(img => toPngBuffer(img)));
  const headerList = pngList.map(png => buildFileHeader(png, password, 'png'));
  const maxBits    = Math.max(...headerList.map(h => (h.length + 4) * 8));
  const unifiedSize = requiredCanvasSize(maxBits, lsbBits);

  // 第二步：逐帧嵌入（使用统一画布尺寸）
  const frames    = [];
  const filePaths = [];

  for (let i = 0; i < pngList.length; i++) {
    const frameTitle  = `${title} (${i + 1}/${pngList.length})`;
    const duckPng     = await buildDuckImageBuffer(unifiedSize, frameTitle);
    const resultFrame = await embedPayloadLSB(duckPng, headerList[i], lsbBits);

    frames.push(resultFrame);

    if (outputDir) {
      const outPath = path.join(outputDir, `duck_seq_${String(i).padStart(5, '0')}.png`);
      await fs.promises.mkdir(outputDir, { recursive: true });
      await fs.promises.writeFile(outPath, resultFrame);
      filePaths.push(outPath);
    }
  }

  return outputDir ? { frames, filePaths } : { frames };
}

/**
 * 把已有的 MP4 文件编码为鸭子图
 * （MP4 字节先转为 binpng 格式再走 LSB 嵌入，与 Python 视频路径对齐）
 *
 * @param {object}       opts
 * @param {Buffer|string} opts.mp4Input  MP4 Buffer 或文件路径
 * @param {string}        [opts.password]
 * @param {string}        [opts.title]
 * @param {number}        [opts.compress]
 * @param {string}        [opts.outputPath]
 * @returns {Promise<{ imageBuffer: Buffer, filePath?: string }>}
 */
async function encodeMp4({ mp4Input, password = '', title = '', compress = 2, outputPath = null }) {
  let mp4Bytes;
  if (typeof mp4Input === 'string') {
    mp4Bytes = await fs.promises.readFile(mp4Input);
  } else if (Buffer.isBuffer(mp4Input)) {
    mp4Bytes = mp4Input;
  } else {
    throw new TypeError('mp4Input 必须是 Buffer 或文件路径');
  }

  // MP4 字节 → binpng PNG Buffer（中间存储格式）
  const binPng      = await bytesToBinaryImage(mp4Bytes, 512);
  const binPngBytes = binPng;

  const result = await exportDuckPayload({
    rawBytes: binPngBytes,
    password,
    ext: 'mp4.binpng',
    compress,
    title,
  });

  if (outputPath) {
    await fs.promises.writeFile(outputPath, result.imageBuffer);
    return { imageBuffer: result.imageBuffer, filePath: outputPath };
  }
  return { imageBuffer: result.imageBuffer };
}

module.exports = {
  encodeImage,
  encodeText,
  encodeBytes,
  encodeImageSequence,
  encodeMp4,
};
