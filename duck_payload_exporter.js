/**
 * duck_payload_exporter.js
 *
 * Node.js port of duck_payload_exporter.py
 * 与 Python 版本完全对齐的核心工具函数：
 *   - 文件头构建 / 解析
 *   - XOR 流密码加密 / 解密
 *   - LSB 像素隐写嵌入 / 提取
 *   - 鸭子图生成（SVG → PNG）
 *   - 二进制数据 ↔ PNG 像素矩阵转换
 *
 * 依赖：sharp（npm install sharp）
 */

'use strict';

const crypto = require('crypto');
const sharp  = require('sharp');

// ─── 常量（与 Python 完全一致） ─────────────────────────────────────────────
const WATERMARK_SKIP_W_RATIO = 0.40;
const WATERMARK_SKIP_H_RATIO = 0.08;
const DUCK_CHANNELS          = 3;

// ─── 位操作工具 ────────────────────────────────────────────────────────────────

/**
 * 把 Buffer 转为 bit 数组（每字节 8 位，高位在前 = big-endian）
 * 与 Python np.unpackbits(bitorder="big") 完全对应
 */
function bytesToBits(buf) {
  const bits = new Uint8Array(buf.length * 8);
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    for (let j = 0; j < 8; j++) {
      bits[i * 8 + j] = (byte >> (7 - j)) & 1;
    }
  }
  return bits;
}

/**
 * 把 bit 数组（高位在前）转回 Buffer
 * bit 数组长度必须是 8 的倍数（不足则右侧补 0 处理）
 */
function bitsToBytes(bits) {
  const byteCount = Math.ceil(bits.length / 8);
  const result    = Buffer.alloc(byteCount);
  for (let i = 0; i < byteCount; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      const bitIdx = i * 8 + j;
      if (bitIdx < bits.length) {
        b = (b << 1) | (bits[bitIdx] & 1);
      } else {
        b = b << 1; // 补 0
      }
    }
    result[i] = b & 0xff;
  }
  return result;
}

// ─── 密钥流生成（SHA-256 迭代，与 Python 对齐） ─────────────────────────────

/**
 * 生成任意长度的密钥流
 * key_material = password + salt.hex()，迭代 SHA-256 直到长度足够
 *
 * @param {string} password
 * @param {Buffer} salt        16 字节随机盐
 * @param {number} length      所需字节数
 * @returns {Buffer}
 */
function generateKeyStream(password, salt, length) {
  const keyMaterial = Buffer.from(password + salt.toString('hex'), 'utf-8');
  const out          = [];
  let   counter      = 0;
  while (out.length < length) {
    const hash = crypto
      .createHash('sha256')
      .update(Buffer.concat([keyMaterial, Buffer.from(String(counter), 'utf-8')]))
      .digest();
    for (const b of hash) out.push(b);
    counter++;
  }
  return Buffer.from(out.slice(0, length));
}

// ─── 加密 / 解密 ──────────────────────────────────────────────────────────────

/**
 * XOR 流密码加密
 * @param {Buffer} data
 * @param {string} password  空字符串 = 不加密
 * @returns {{ cipher: Buffer, salt: Buffer, pwdHash: Buffer, hasPwd: boolean }}
 */
function encryptWithPassword(data, password) {
  if (!password) {
    return { cipher: data, salt: Buffer.alloc(0), pwdHash: Buffer.alloc(0), hasPwd: false };
  }
  const salt      = crypto.randomBytes(16);
  const keyStream = generateKeyStream(password, salt, data.length);
  const cipher    = Buffer.from(data.map((b, i) => b ^ keyStream[i]));
  const pwdHash   = crypto
    .createHash('sha256')
    .update(Buffer.from(password + salt.toString('hex'), 'utf-8'))
    .digest();
  return { cipher, salt, pwdHash, hasPwd: true };
}

// ─── 文件头构建 / 解析 ───────────────────────────────────────────────────────

/**
 * 构建文件头（与 Python _build_file_header 完全对齐的二进制格式）
 *
 * 格式（无密码）:
 *   [0x00][extLen:1][ext:extLen][dataLen:4 big-endian][data]
 *
 * 格式（有密码）:
 *   [0x01][pwdHash:32][salt:16][extLen:1][ext:extLen][dataLen:4 big-endian][encryptedData]
 *
 * @param {Buffer} raw       原始数据字节
 * @param {string} password  加密密码，空表示不加密
 * @param {string} ext       扩展名，如 "png"、"txt"、"mp4.binpng"
 * @returns {Buffer}
 */
function buildFileHeader(raw, password, ext = 'png') {
  const { cipher, salt, pwdHash, hasPwd } = encryptWithPassword(raw, password);
  const payload    = cipher;
  const extBytes   = Buffer.from(ext, 'utf-8');
  const dataLenBuf = Buffer.alloc(4);
  dataLenBuf.writeUInt32BE(payload.length);

  const parts = [Buffer.from([hasPwd ? 1 : 0])];
  if (hasPwd) {
    parts.push(pwdHash); // 32 bytes
    parts.push(salt);    // 16 bytes
  }
  parts.push(Buffer.from([extBytes.length])); // 1 byte ext length
  parts.push(extBytes);
  parts.push(dataLenBuf);
  parts.push(payload);

  return Buffer.concat(parts);
}

/**
 * 解析文件头，验证密码，返回原始数据和扩展名
 *
 * @param {Buffer} header
 * @param {string} password  解密密码，无加密时传空字符串即可
 * @returns {{ data: Buffer, ext: string }}
 * @throws {Error} 密码错误 / 文件头损坏 / 数据长度不匹配
 */
function parseHeader(header, password) {
  let idx = 0;
  if (header.length < 1) throw new Error('Header corrupted. 文件头损坏');

  const hasPwd = header[idx] === 1;
  idx += 1;

  let pwdHash = Buffer.alloc(0);
  let salt    = Buffer.alloc(0);
  if (hasPwd) {
    if (header.length < idx + 32 + 16) throw new Error('Header corrupted. 文件头损坏');
    pwdHash = header.slice(idx, idx + 32); idx += 32;
    salt    = header.slice(idx, idx + 16); idx += 16;
  }

  if (header.length < idx + 1) throw new Error('Header corrupted. 文件头损坏');
  const extLen = header[idx]; idx += 1;

  if (header.length < idx + extLen + 4) throw new Error('Header corrupted. 文件头损坏');
  const ext     = header.slice(idx, idx + extLen).toString('utf-8'); idx += extLen;
  const dataLen = header.readUInt32BE(idx); idx += 4;
  const data    = header.slice(idx);

  if (data.length !== dataLen) throw new Error('Data length mismatch. 数据长度不匹配');

  if (!hasPwd) return { data, ext };

  // 密码验证
  if (!password) throw new Error('Password required. 需要密码');
  const checkHash = crypto
    .createHash('sha256')
    .update(Buffer.from(password + salt.toString('hex'), 'utf-8'))
    .digest();
  if (!checkHash.equals(pwdHash)) throw new Error('Wrong password. 密码错误');

  // 解密
  const keyStream = generateKeyStream(password, salt, data.length);
  const plain     = Buffer.from(data.map((b, i) => b ^ keyStream[i]));
  return { data: plain, ext };
}

// ─── 画布尺寸计算 ─────────────────────────────────────────────────────────────

/**
 * 计算容纳 bitLen 个 bit 所需的最小正方形画布边长
 * 与 Python _required_canvas_size 完全对齐
 *
 * @param {number} bitLen   需要存储的总 bit 数
 * @param {number} lsbBits  每通道使用的 LSB 位数
 * @returns {number}        画布边长（像素）
 */
function requiredCanvasSize(bitLen, lsbBits) {
  let side = 640;
  while (true) {
    const skipW   = Math.floor(side * WATERMARK_SKIP_W_RATIO);
    const skipH   = Math.floor(side * WATERMARK_SKIP_H_RATIO);
    const excluded   = skipW * skipH;
    const usableBits = (side * side - excluded) * DUCK_CHANNELS * lsbBits;
    if (usableBits >= bitLen) return side;
    side += 64;
  }
}

// ─── 鸭子图生成（SVG） ────────────────────────────────────────────────────────

/**
 * 用弧度和椭圆参数计算 SVG arc 路径的起点 / 终点坐标
 */
function _ellipsePoint(cx, cy, rx, ry, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
}

/**
 * 生成鸭子图 SVG 字符串（与 Python _build_duck_image 视觉接近）
 *
 * @param {number} size   画布边长
 * @param {string} title  标题文字（最多 30 字符）
 * @returns {string}      SVG 字符串
 */
function buildDuckImageSVG(size, title = '') {
  const s = size;

  // ── 水波弧线辅助（对应 PIL draw.arc） ─────────────────────────────────
  function arcPath(bbX0, bbY0, bbX1, bbY1, startDeg, endDeg) {
    const cx  = (bbX0 + bbX1) / 2;
    const cy  = (bbY0 + bbY1) / 2;
    const rx  = (bbX1 - bbX0) / 2;
    const ry  = (bbY1 - bbY0) / 2;
    const p1  = _ellipsePoint(cx, cy, rx, ry, startDeg);
    const p2  = _ellipsePoint(cx, cy, rx, ry, endDeg);
    // 从 startDeg 顺时针到 endDeg，角度跨度 = endDeg - startDeg
    const sweep  = 1; // 顺时针
    const arcDeg = endDeg - startDeg;
    const large  = arcDeg > 180 ? 1 : 0;
    return `M ${p1.x.toFixed(2)},${p1.y.toFixed(2)} A ${rx.toFixed(2)},${ry.toFixed(2)} 0 ${large},${sweep} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }

  // ── 鸭嘴多边形顶点 ─────────────────────────────────────────────────────
  const beakPts = [
    [s * 0.65, s * 0.32],
    [s * 0.78, s * 0.36],
    [s * 0.68, s * 0.40],
    [s * 0.60, s * 0.38],
  ].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

  // ── 标题文字 ───────────────────────────────────────────────────────────
  const titleStr  = title ? title.slice(0, 30) : '';
  const fontSize  = Math.max(12, Math.floor(s * 0.06));
  const titleElem = titleStr
    ? `<text x="${Math.floor(s * 0.06)}" y="${Math.floor(s * 0.16)}"
         font-size="${fontSize}" font-family="sans-serif" fill="rgba(0,0,0,0.85)"
         text-anchor="start">${escapeXml(titleStr)}</text>`
    : '';

  // ── 版本号 ─────────────────────────────────────────────────────────────
  const verFontSize = Math.max(8, Math.floor(s * 0.022));
  const verElem     = `<text x="${(s / 2).toFixed(0)}" y="${(s * 0.94).toFixed(0)}"
      font-size="${verFontSize}" font-family="sans-serif" fill="rgba(255,255,255,0.9)"
      text-anchor="middle">V1.0</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${s}" height="${s}" xmlns="http://www.w3.org/2000/svg">
  <!-- 天空背景 -->
  <rect width="${s}" height="${s}" fill="rgb(153,204,255)"/>

  <!-- 身体 -->
  <ellipse cx="${s * 0.5}" cy="${s * 0.6}" rx="${s * 0.3}" ry="${s * 0.25}"
           fill="rgb(255,223,94)" stroke="rgb(255,190,60)" stroke-width="4"/>

  <!-- 头部 -->
  <ellipse cx="${s * 0.5}" cy="${s * 0.3}" rx="${s * 0.15}" ry="${s * 0.15}"
           fill="rgb(255,223,94)" stroke="rgb(255,190,60)" stroke-width="4"/>

  <!-- 翅膀 -->
  <ellipse cx="${s * 0.575}" cy="${s * 0.65}" rx="${s * 0.175}" ry="${s * 0.1}"
           fill="rgb(255,200,70)" stroke="rgb(255,190,60)" stroke-width="3"/>

  <!-- 嘴巴 -->
  <polygon points="${beakPts}" fill="rgb(255,153,51)" stroke="rgb(200,120,30)" stroke-width="2"/>

  <!-- 眼睛（右） -->
  <ellipse cx="${s * 0.58}" cy="${s * 0.26}" rx="${s * 0.02}" ry="${s * 0.02}" fill="black"/>

  <!-- 眼睛（左） -->
  <ellipse cx="${s * 0.49}" cy="${s * 0.26}" rx="${s * 0.02}" ry="${s * 0.02}" fill="black"/>

  <!-- 水波纹 1 -->
  <path d="${arcPath(s * 0.1, s * 0.75, s * 0.9, s * 0.9, 10, 170)}"
        stroke="rgba(255,255,255,0.9)" fill="none" stroke-width="3"/>

  <!-- 水波纹 2 -->
  <path d="${arcPath(s * 0.15, s * 0.78, s * 0.85, s * 0.93, 10, 170)}"
        stroke="rgba(240,240,240,0.7)" fill="none" stroke-width="2"/>

  ${titleElem}
  ${verElem}
</svg>`;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成鸭子图 PNG（Buffer）
 *
 * @param {number} size
 * @param {string} [title]
 * @returns {Promise<Buffer>}  PNG 格式
 */
async function buildDuckImageBuffer(size, title = '') {
  const svgStr = buildDuckImageSVG(size, title);
  return sharp(Buffer.from(svgStr))
    .resize(size, size)
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ─── LSB 嵌入 ─────────────────────────────────────────────────────────────────

/**
 * LSB 隐写嵌入（与 Python _embed_payload_lsb 完全对齐）
 *
 * 算法要点：
 *   1. 跳过左上角 40%宽 × 8%高 的水印区域
 *   2. 把 [4字节大端长度 + fileHeader字节] 展开为 bit 数组
 *   3. 每 lsbBits 个 bit 为一组写入一个通道的最低位
 *   4. 处理完后把水印区域的像素用右侧相邻像素填充（视觉自然）
 *
 * @param {Buffer} pngBuffer    输入图片（PNG）
 * @param {Buffer} fileHeader   由 buildFileHeader() 生成的文件头
 * @param {number} lsbBits      每通道 LSB 位数（2 / 6 / 8）
 * @returns {Promise<Buffer>}   嵌入数据后的 PNG
 */
async function embedPayloadLSB(pngBuffer, fileHeader, lsbBits) {
  // 获取原始 RGB 像素
  const { data: rawPixels, info } = await sharp(pngBuffer)
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // 构造 [长度前缀(4字节)] + [fileHeader]
  const lenBuf  = Buffer.alloc(4);
  lenBuf.writeUInt32BE(fileHeader.length);
  const payload = Buffer.concat([lenBuf, fileHeader]);

  // 展开为 bit 数组并补齐到 lsbBits 的整数倍
  const bits   = Array.from(bytesToBits(payload));
  const groups = Math.ceil(bits.length / lsbBits);
  while (bits.length < groups * lsbBits) bits.push(0);

  const skipW   = Math.floor(width  * WATERMARK_SKIP_W_RATIO);
  const skipH   = Math.floor(height * WATERMARK_SKIP_H_RATIO);
  const lsbMask = (1 << lsbBits) - 1;

  const pixels = Buffer.from(rawPixels); // 复制，不修改原始 buffer
  let groupIdx = 0;

  // ── 按行 → 列 → 通道顺序嵌入（与 Python flatten 顺序一致） ───────────────
  outer:
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 跳过水印区域
      if (y < skipH && x < skipW) continue;
      if (groupIdx >= groups) break outer;

      for (let c = 0; c < 3; c++) {
        if (groupIdx >= groups) break;

        // 把 lsbBits 个 bit 组合成一个值（高位在前）
        let val = 0;
        for (let b = 0; b < lsbBits; b++) {
          val = (val << 1) | (bits[groupIdx * lsbBits + b] & 1);
        }

        const idx      = (y * width + x) * 3 + c;
        pixels[idx]    = (pixels[idx] & ~lsbMask) | (val & lsbMask);
        groupIdx++;
      }
    }
  }

  if (groupIdx < groups) {
    throw new Error('Data too large, capacity exceeded. 数据过大，鸭子图容量不够。');
  }

  // ── 用右侧像素填充水印区域（与 Python 逻辑对齐） ─────────────────────────
  const srcW = Math.max(0, width - skipW);
  if (skipW > 0 && skipH > 0 && srcW > 0) {
    const blockW = Math.min(skipW, srcW);
    for (let y = 0; y < skipH; y++) {
      for (let x = 0; x < skipW; x++) {
        const srcX  = skipW + (x % blockW);
        const dstI  = (y * width + x)    * 3;
        const srcI  = (y * width + srcX) * 3;
        pixels[dstI]     = pixels[srcI];
        pixels[dstI + 1] = pixels[srcI + 1];
        pixels[dstI + 2] = pixels[srcI + 2];
      }
    }
  }

  // 转回 PNG
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ─── LSB 提取 ─────────────────────────────────────────────────────────────────

/**
 * 从原始 RGB 像素中提取 LSB payload（与 Python _extract_payload_with_k 对齐）
 *
 * @param {Buffer} rawPixels  uint8 RGB 行优先像素，大小 = height * width * 3
 * @param {number} width
 * @param {number} height
 * @param {number} k          LSB 位数（2 / 6 / 8）
 * @returns {Buffer}          提取出的 payload（不含长度前缀）
 * @throws {Error}            数据不足 / 长度异常
 */
function extractPayloadWithK(rawPixels, width, height, k) {
  const skipW = Math.floor(width  * WATERMARK_SKIP_W_RATIO);
  const skipH = Math.floor(height * WATERMARK_SKIP_H_RATIO);
  const mask  = (1 << k) - 1;

  // 先收集所有可用通道的 bit
  const allBits = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (y < skipH && x < skipW) continue;
      for (let c = 0; c < 3; c++) {
        const val = rawPixels[(y * width + x) * 3 + c] & mask;
        // 展开为 k 位（高位在前，与 Python np.unpackbits[-k:] 一致）
        for (let b = k - 1; b >= 0; b--) {
          allBits.push((val >> b) & 1);
        }
      }
    }
  }

  if (allBits.length < 32) throw new Error('Insufficient image data. 图像数据不足');

  // 读前 32 bit → 大端 uint32 = header_len
  let headerLen = 0;
  for (let i = 0; i < 32; i++) {
    headerLen = ((headerLen << 1) | allBits[i]) >>> 0;
  }

  const totalBits = 32 + headerLen * 8;
  if (headerLen <= 0 || totalBits > allBits.length) {
    throw new Error('Payload length invalid. 载荷长度异常');
  }

  // 提取 payload bits
  const payloadBits = allBits.slice(32, 32 + headerLen * 8);
  return bitsToBytes(payloadBits);
}

// ─── 二进制数据 ↔ PNG 像素矩阵（用于视频字节的中间存储） ────────────────────

/**
 * 将任意二进制数据铺入 PNG 像素（每 3 字节 = 1 像素）
 * 与 Python _bytes_to_binary_image 完全对齐
 *
 * @param {Buffer} data
 * @param {number} [width=512]
 * @returns {Promise<Buffer>}  PNG buffer
 */
async function bytesToBinaryImage(data, width = 512) {
  const pixelCount = Math.ceil(data.length / 3);
  const height     = Math.ceil(pixelCount / width);
  const totalBytes = width * height * 3;
  const padded     = Buffer.alloc(totalBytes); // 不足补 0
  data.copy(padded);
  return sharp(padded, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 }) // 无损，不压缩原始字节
    .toBuffer();
}

/**
 * 从 binpng 还原原始二进制数据（剥离尾部零填充）
 * 与 Python binpng_bytes_to_mp4_bytes 对应
 *
 * @param {Buffer} pngBuffer  binpng 格式的 PNG buffer
 * @returns {Promise<Buffer>}
 */
async function binaryImageToBytes(pngBuffer) {
  const { data: rawPixels } = await sharp(pngBuffer)
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 去掉尾部零填充
  let end = rawPixels.length;
  while (end > 0 && rawPixels[end - 1] === 0) end--;
  return Buffer.from(rawPixels.slice(0, end));
}

// ─── 主导出函数 ───────────────────────────────────────────────────────────────

/**
 * 完整的鸭子图编码流程（对应 Python export_duck_payload）
 *
 * @param {object}  opts
 * @param {Buffer}  opts.rawBytes      原始载荷字节
 * @param {string}  opts.password      加密密码（空字符串 = 不加密）
 * @param {string}  opts.ext           扩展名，如 "png" / "txt" / "mp4.binpng"
 * @param {number}  opts.compress      压缩模式：2 / 6 / 8（对应 LSB 位数）
 * @param {string}  [opts.title]       鸭子图标题
 * @param {number}  [opts.fixedSize]   固定画布尺寸（可选，用于批量保持一致）
 * @returns {Promise<{ imageBuffer: Buffer }>}
 */
async function exportDuckPayload({ rawBytes, password, ext, compress, title = '', fixedSize = null }) {
  const fileHeader = buildFileHeader(rawBytes, password, ext);
  const lsbBits    = compress >= 8 ? 8 : compress >= 6 ? 6 : 2;

  let requiredSize = requiredCanvasSize((fileHeader.length + 4) * 8, lsbBits);
  if (fixedSize !== null) {
    requiredSize = fixedSize >= requiredSize ? fixedSize : requiredSize;
  }

  const duckPng     = await buildDuckImageBuffer(requiredSize, title);
  const resultPng   = await embedPayloadLSB(duckPng, fileHeader, lsbBits);

  return { imageBuffer: resultPng };
}

// ─── 导出 ─────────────────────────────────────────────────────────────────────

module.exports = {
  // 常量
  WATERMARK_SKIP_W_RATIO,
  WATERMARK_SKIP_H_RATIO,
  DUCK_CHANNELS,

  // 位工具
  bytesToBits,
  bitsToBytes,

  // 加密
  generateKeyStream,
  encryptWithPassword,

  // 文件头
  buildFileHeader,
  parseHeader,

  // 画布尺寸
  requiredCanvasSize,

  // 图片生成
  buildDuckImageSVG,
  buildDuckImageBuffer,

  // LSB
  embedPayloadLSB,
  extractPayloadWithK,

  // 二进制 ↔ PNG
  bytesToBinaryImage,
  binaryImageToBytes,

  // 顶层封装
  exportDuckPayload,
};
