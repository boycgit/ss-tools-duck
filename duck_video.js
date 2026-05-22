/**
 * duck_video.js
 *
 * 视频合成 + 解帧工具（对应 Python _images_to_video 功能）
 * 依赖：fluent-ffmpeg（需要系统安装 ffmpeg）
 *
 * 提供：
 *   imagesToMp4({ frames, fps, audioPath, outputPath }) → Promise<Buffer>
 *   mp4ToFrames({ mp4Input, outputDir }) → Promise<Buffer[]>
 *   encodeVideoFrames({ frames, fps, audioPath, password, title, compress, outputPath })
 *     帧序列 → 鸭子图（一步封装）
 */

'use strict';

const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const crypto     = require('crypto');
const ffmpeg     = require('fluent-ffmpeg');
const sharp      = require('sharp');
const { encodeMp4 } = require('./duck_encode');

// ─── 工具：创建临时目录 ───────────────────────────────────────────────────────

function makeTempDir() {
  const dir = path.join(os.tmpdir(), 'duck_ffmpeg_' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function removeTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ─── 判断 ffmpeg 是否可用 ─────────────────────────────────────────────────────

async function checkFfmpegAvailable() {
  return new Promise((resolve) => {
    ffmpeg.getAvailableFormats((err) => resolve(!err));
  });
}

// ─── 图片帧 → MP4 Buffer ──────────────────────────────────────────────────────

/**
 * 将图片帧数组合成 MP4（H.264, yuv420p，与 Python MoviePy 输出兼容）
 *
 * @param {object}          opts
 * @param {Buffer[]}        opts.frames       PNG / JPEG Buffer 数组
 * @param {number}          opts.fps          帧率
 * @param {string}          [opts.audioPath]  音频文件路径（WAV/MP3/AAC）
 * @param {string}          [opts.outputPath] 若提供则同时写文件
 * @returns {Promise<Buffer>}  MP4 字节
 */
async function imagesToMp4({ frames, fps, audioPath = null, outputPath = null }) {
  if (!frames || frames.length === 0) throw new Error('frames 数组不能为空');

  const tmpDir    = makeTempDir();
  const frameDir  = path.join(tmpDir, 'frames');
  fs.mkdirSync(frameDir);

  try {
    // ── 写出帧图片 ──────────────────────────────────────────────────────────
    for (let i = 0; i < frames.length; i++) {
      const framePath = path.join(frameDir, `frame_${String(i).padStart(6, '0')}.png`);
      // 确保是 PNG 格式（sharp 自动转换）
      const pngBuf = await sharp(frames[i]).png().toBuffer();
      fs.writeFileSync(framePath, pngBuf);
    }

    // ── 合成 MP4 ────────────────────────────────────────────────────────────
    const tmpMp4 = path.join(tmpDir, 'output.mp4');

    await new Promise((resolve, reject) => {
      let cmd = ffmpeg()
        .input(path.join(frameDir, 'frame_%06d.png'))
        .inputFPS(fps)
        .videoCodec('libx264')
        .outputOptions([
          '-pix_fmt yuv420p',
          '-crf 16',
          '-preset medium',
          '-profile:v high',
          '-movflags +faststart',
        ]);

      if (audioPath && fs.existsSync(audioPath)) {
        cmd = cmd
          .input(audioPath)
          .audioCodec('aac')
          .outputOptions(['-shortest']); // 音频/视频取最短
      }

      cmd
        .output(tmpMp4)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const mp4Buffer = fs.readFileSync(tmpMp4);

    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, mp4Buffer);
    }

    return mp4Buffer;

  } finally {
    removeTempDir(tmpDir);
  }
}

// ─── MP4 → 帧数组 ─────────────────────────────────────────────────────────────

/**
 * 将 MP4 解帧为 PNG Buffer 数组
 *
 * @param {object}        opts
 * @param {Buffer|string} opts.mp4Input   MP4 Buffer 或文件路径
 * @param {number}        [opts.fps]      抽帧帧率（默认：原始帧率全提取）
 * @returns {Promise<{ frames: Buffer[], fps: number }>}
 */
async function mp4ToFrames({ mp4Input, fps = null }) {
  const tmpDir = makeTempDir();
  let   tmpMp4 = null;

  try {
    // 若是 Buffer，先写临时文件
    if (Buffer.isBuffer(mp4Input)) {
      tmpMp4 = path.join(tmpDir, 'input.mp4');
      fs.writeFileSync(tmpMp4, mp4Input);
    } else {
      tmpMp4 = mp4Input;
    }

    const frameDir = path.join(tmpDir, 'frames');
    fs.mkdirSync(frameDir);

    // 读取原始帧率
    const meta = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(tmpMp4, (err, data) => err ? reject(err) : resolve(data));
    });
    const videoStream = meta.streams.find(s => s.codec_type === 'video');
    const srcFps      = videoStream
      ? eval(videoStream.r_frame_rate) // "30/1" → 30
      : 30;
    const outFps      = fps || srcFps;

    // 提取帧
    await new Promise((resolve, reject) => {
      ffmpeg(tmpMp4)
        .outputOptions([`-vf fps=${outFps}`])
        .output(path.join(frameDir, 'frame_%06d.png'))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const frameFiles = fs.readdirSync(frameDir)
      .filter(f => f.endsWith('.png'))
      .sort();
    const frames = frameFiles.map(f => fs.readFileSync(path.join(frameDir, f)));

    return { frames, fps: outFps };

  } finally {
    removeTempDir(tmpDir);
  }
}

// ─── 一步封装：帧序列 → 鸭子图 ──────────────────────────────────────────────

/**
 * 视频帧序列 → 先合成 MP4 → 再编码为鸭子图
 *
 * @param {object}         opts
 * @param {Buffer[]}       opts.frames      图片帧 Buffer 数组
 * @param {number}         opts.fps         帧率
 * @param {string}         [opts.audioPath] 音频文件路径
 * @param {string}         [opts.password]
 * @param {string}         [opts.title]
 * @param {number}         [opts.compress]
 * @param {string}         [opts.outputPath]
 * @returns {Promise<{ imageBuffer: Buffer, filePath?: string }>}
 */
async function encodeVideoFrames({ frames, fps, audioPath = null, password = '', title = '', compress = 2, outputPath = null }) {
  const mp4Buffer = await imagesToMp4({ frames, fps, audioPath });
  return encodeMp4({ mp4Input: mp4Buffer, password, title, compress, outputPath });
}

module.exports = {
  checkFfmpegAvailable,
  imagesToMp4,
  mp4ToFrames,
  encodeVideoFrames,
};
