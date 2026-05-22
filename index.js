/**
 * index.js — SS_tools Duck 隐写工具库（Node.js 版）
 *
 * 公开 API：
 *
 *   编码（隐藏数据）
 *   ─────────────────────────────────────────────
 *   encodeImage({ image, password, title, compress, outputPath })
 *     单张图片 → 鸭子图
 *
 *   encodeText({ text, password, title, compress, outputPath })
 *     文本字符串 → 鸭子图
 *
 *   encodeBytes({ rawBytes, ext, password, title, compress, outputPath })
 *     任意二进制数据 → 鸭子图（通用接口）
 *
 *   encodeImageSequence({ images, password, title, compress, outputDir })
 *     多帧图片 → 独立鸭子图序列
 *
 *   encodeMp4({ mp4Input, password, title, compress, outputPath })
 *     MP4 文件 → 鸭子图
 *
 *   解码（还原数据）
 *   ─────────────────────────────────────────────
 *   decodeDuckImage({ duckImage, password, outputDir })
 *     鸭子图（Buffer 或路径） → { data, ext, text?, imageBuffer?, mp4Buffer?, filePath? }
 *
 *   decodeFromFile(duckFilePath, password?, outputDir?)
 *     便捷：文件路径解码
 *
 *   decodeFromBuffer(duckBuffer, password?, outputDir?)
 *     便捷：Buffer 解码
 *
 *   视频合成（来自 duck_video，需系统安装 ffmpeg）
 *   ─────────────────────────────────────────────
 *   imagesToMp4({ frames, fps, audioPath, outputPath })
 *     图片帧 Buffer 数组 → MP4 Buffer
 *
 *   mp4ToFrames({ mp4Input, fps })
 *     MP4 → 帧 Buffer 数组
 *
 *   encodeVideoFrames({ frames, fps, audioPath, password, title, compress, outputPath })
 *     帧序列 → 鸭子图（一步封装）
 *
 *   checkFfmpegAvailable()
 *     检查系统 ffmpeg 是否可用
 *
 *   底层工具（来自 duck_payload_exporter）
 *   ─────────────────────────────────────────────
 *   buildFileHeader / parseHeader
 *   requiredCanvasSize
 *   embedPayloadLSB / extractPayloadWithK
 *   bytesToBinaryImage / binaryImageToBytes
 *   exportDuckPayload
 */

'use strict';

const encode   = require('./duck_encode');
const decode   = require('./duck_decode');
const exporter = require('./duck_payload_exporter');
const video    = require('./duck_video');

module.exports = {
  // ── 编码 ──────────────────────────────────────────────────────────────────
  ...encode,

  // ── 解码 ──────────────────────────────────────────────────────────────────
  ...decode,

  // ── 视频合成 ───────────────────────────────────────────────────────────────
  checkFfmpegAvailable: video.checkFfmpegAvailable,
  imagesToMp4:          video.imagesToMp4,
  mp4ToFrames:          video.mp4ToFrames,
  encodeVideoFrames:    video.encodeVideoFrames,

  // ── 底层工具（按需使用） ───────────────────────────────────────────────────
  buildFileHeader:      exporter.buildFileHeader,
  parseHeader:          exporter.parseHeader,
  requiredCanvasSize:   exporter.requiredCanvasSize,
  embedPayloadLSB:      exporter.embedPayloadLSB,
  extractPayloadWithK:  exporter.extractPayloadWithK,
  bytesToBinaryImage:   exporter.bytesToBinaryImage,
  binaryImageToBytes:   exporter.binaryImageToBytes,
  exportDuckPayload:    exporter.exportDuckPayload,
  buildDuckImageBuffer: exporter.buildDuckImageBuffer,
  buildDuckImageSVG:    exporter.buildDuckImageSVG,
};
