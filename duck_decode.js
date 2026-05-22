/**
 * duck_decode.js
 *
 * Node.js 解码器：从鸭子图还原隐藏的数据
 * 对应 Python duck_decode_node.py 的核心逻辑（去除 ComfyUI 节点壳）
 *
 * 还原类型：
 *   - 图片（ext = "png"）→ PNG Buffer
 *   - 文本（ext = "txt"）→ string
 *   - MP4（ext = "mp4" 或 "mp4.binpng"）→ MP4 Buffer
 *   - 其他任意二进制（ext = 任意）→ Buffer
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const sharp = require('sharp');

const {
  extractPayloadWithK,
  parseHeader,
  binaryImageToBytes,
} = require('./duck_payload_exporter');

// ─── 主解码函数 ───────────────────────────────────────────────────────────────

/**
 * 从鸭子图中解码出隐藏的数据
 *
 * 自动尝试 LSB k=2、k=6、k=8 三种模式（与 Python 一致）
 *
 * @param {object}         opts
 * @param {Buffer|string}  opts.duckImage   鸭子图（PNG Buffer 或文件路径）
 * @param {string}         [opts.password]  解密密码（无加密时留空）
 * @param {string}         [opts.outputDir] 若提供则把还原文件写入此目录
 * @returns {Promise<DecodeResult>}
 *
 * @typedef {object} DecodeResult
 * @property {Buffer}  data        原始数据字节
 * @property {string}  ext         文件扩展名
 * @property {string}  [filePath]  写出的文件路径（outputDir 不为空时有值）
 * @property {string}  [text]      ext='txt' 时的 UTF-8 文本内容
 * @property {Buffer}  [imageBuffer] ext='png' 时的 PNG Buffer（即 data 本身）
 * @property {Buffer}  [mp4Buffer]   ext='mp4' 或 'mp4.binpng' 时的 MP4 Buffer
 */
async function decodeDuckImage({ duckImage, password = '', outputDir = null }) {
  // ── 加载图片 → 原始 RGB 像素 ─────────────────────────────────────────────
  const inputBuffer = typeof duckImage === 'string'
    ? await fs.promises.readFile(duckImage)
    : duckImage;

  const { data: rawPixels, info } = await sharp(inputBuffer)
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // ── 自动探测 LSB 位数（k = 2 → 6 → 8） ──────────────────────────────────
  let payload  = null;
  let parsed   = null;
  let lastErr  = null;

  for (const k of [2, 6, 8]) {
    try {
      payload = extractPayloadWithK(rawPixels, width, height, k);
      parsed  = parseHeader(payload, password);
      break; // 成功则退出循环
    } catch (err) {
      lastErr = err;
      payload = null;
      parsed  = null;
    }
  }

  if (!parsed) {
    throw lastErr || new Error('解析失败，无法从图片中提取有效数据');
  }

  const { data, ext } = parsed;
  const result        = { data, ext };

  // ── 按扩展名分发处理 ──────────────────────────────────────────────────────
  if (ext.toLowerCase() === 'txt') {
    // 文本：解码 UTF-8，回退 GBK（Node.js 原生不支持 GBK，回退时保留原始 Buffer）
    let text = '';
    try {
      text = data.toString('utf-8');
    } catch {
      try {
        // 如果系统安装了 iconv-lite，可以尝试 GBK 解码
        const iconv = require('iconv-lite');
        text = iconv.decode(data, 'gbk');
      } catch {
        text = `[无法解码文本内容，原始数据已存储于 data 字段]`;
      }
    }
    result.text = text;

  } else if (ext.toLowerCase().endsWith('.binpng') || ext.toLowerCase() === 'mp4') {
    // 视频：binpng → 还原 MP4 字节，或直接使用 MP4 字节
    let mp4Bytes;
    if (ext.toLowerCase().endsWith('.binpng')) {
      // binpng 格式：data 本身就是一张 PNG（像素 = MP4 字节）
      mp4Bytes = await binaryImageToBytes(data);
    } else {
      mp4Bytes = data;
    }
    result.mp4Buffer = mp4Bytes;

  } else if (ext.toLowerCase() === 'png') {
    result.imageBuffer = data;

  }
  // 其他格式（jpg、zip 等）：data 即原始字节，调用方自行处理

  // ── 可选：写出文件 ────────────────────────────────────────────────────────
  if (outputDir) {
    await fs.promises.mkdir(outputDir, { recursive: true });
    const safeName = 'duck_recovered.' + (ext.endsWith('.binpng') ? 'mp4' : ext.replace(/[/\\?%*:|"<>]/g, '_'));
    const filePath = path.join(outputDir, safeName);

    const bytesToWrite = result.mp4Buffer || result.imageBuffer || data;
    await fs.promises.writeFile(filePath, bytesToWrite);
    result.filePath = filePath;
  }

  return result;
}

/**
 * 从本地文件解码（便捷方法）
 *
 * @param {string}  duckFilePath   鸭子图文件路径
 * @param {string}  [password]
 * @param {string}  [outputDir]
 * @returns {Promise<DecodeResult>}
 */
async function decodeFromFile(duckFilePath, password = '', outputDir = null) {
  return decodeDuckImage({ duckImage: duckFilePath, password, outputDir });
}

/**
 * 从 Buffer 解码（便捷方法）
 *
 * @param {Buffer}  duckBuffer     鸭子图 PNG Buffer
 * @param {string}  [password]
 * @param {string}  [outputDir]
 * @returns {Promise<DecodeResult>}
 */
async function decodeFromBuffer(duckBuffer, password = '', outputDir = null) {
  return decodeDuckImage({ duckImage: duckBuffer, password, outputDir });
}

module.exports = {
  decodeDuckImage,
  decodeFromFile,
  decodeFromBuffer,
};
