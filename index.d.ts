/**
 * SS_tools Duck 隐写工具库 — TypeScript 类型声明
 */

// ─── 公共选项类型 ─────────────────────────────────────────────────────────────

/** 压缩比（影响每像素隐藏的 bit 数）：2 = 最低信息量，8 = 最高 */
export type CompressLevel = 2 | 6 | 8;

/** 编码共有选项 */
export interface EncodeOptions {
  /** 加密密码；留空或省略则不加密 */
  password?: string;
  /** 显示在鸭子图右下角的标题 */
  title?: string;
  /** 压缩比，默认 2 */
  compress?: CompressLevel;
  /** 输出文件路径；省略则返回 Buffer 不写文件 */
  outputPath?: string;
}

/** 编码结果 */
export interface EncodeResult {
  /** 生成的鸭子图 PNG 字节 */
  imageBuffer: Buffer;
  /** 写出的文件路径（仅当传入 outputPath 时存在） */
  filePath?: string;
}

// ─── 解码相关 ─────────────────────────────────────────────────────────────────

/** 解码结果 */
export interface DecodeResult {
  /** 还原的原始字节（文本为 UTF-8 编码的 bytes） */
  data: Buffer;
  /** 文件扩展名，如 "txt" / "png" / "mp4" / "bin" */
  ext: string;
  /** 若 ext === "txt"，已解码为字符串 */
  text?: string;
  /** 若 ext === "png"，PNG 图片 Buffer */
  imageBuffer?: Buffer;
  /** 若 ext === "mp4" 或 "mp4.binpng"，MP4 视频 Buffer */
  mp4Buffer?: Buffer;
  /** 若传入 outputDir，还原文件的输出路径 */
  filePath?: string;
}

// ─── 编码 API ─────────────────────────────────────────────────────────────────

/** 单张图片 → 鸭子图 */
export function encodeImage(opts: EncodeOptions & { image: Buffer }): Promise<EncodeResult>;

/** 文本字符串 → 鸭子图 */
export function encodeText(opts: EncodeOptions & { text: string }): Promise<EncodeResult>;

/**
 * 任意二进制数据 → 鸭子图（通用接口）
 * @param opts.rawBytes  原始字节
 * @param opts.ext       扩展名（如 "pdf"、"zip"）
 */
export function encodeBytes(opts: EncodeOptions & { rawBytes: Buffer; ext: string }): Promise<EncodeResult>;

/**
 * 多帧图片序列 → 独立鸭子图序列（每帧一个文件）
 * @param opts.outputDir  输出目录；文件命名为 duck_000.png, duck_001.png …
 */
export function encodeImageSequence(opts: EncodeOptions & {
  images: Buffer[];
  outputDir?: string;
}): Promise<{ imageBuffers: Buffer[]; filePaths?: string[] }>;

/**
 * MP4 视频（Buffer 或文件路径）→ 鸭子图（binpng 格式）
 * @param opts.mp4Input  MP4 字节 Buffer 或文件路径字符串
 */
export function encodeMp4(opts: EncodeOptions & { mp4Input: Buffer | string }): Promise<EncodeResult>;

// ─── 解码 API ─────────────────────────────────────────────────────────────────

/** 从鸭子图 Buffer 或文件路径中还原隐藏数据 */
export function decodeDuckImage(opts: {
  duckImage: Buffer | string;
  /** 解密密码（无密码可省略） */
  password?: string;
  /** 还原文件的输出目录 */
  outputDir?: string;
}): Promise<DecodeResult>;

/** 便捷接口：从文件路径解码 */
export function decodeFromFile(
  duckFilePath: string,
  password?: string,
  outputDir?: string
): Promise<DecodeResult>;

/** 便捷接口：从 Buffer 解码 */
export function decodeFromBuffer(
  duckBuffer: Buffer,
  password?: string,
  outputDir?: string
): Promise<DecodeResult>;

// ─── 视频合成 API ─────────────────────────────────────────────────────────────

/** 检查系统 ffmpeg 是否可用 */
export function checkFfmpegAvailable(): Promise<boolean>;

/**
 * 图片帧数组 → MP4 Buffer
 * @param opts.frames      PNG/JPEG Buffer 数组（按顺序）
 * @param opts.fps         帧率
 * @param opts.audioPath   混音文件路径（WAV/MP3/AAC，可选）
 * @param opts.outputPath  若提供则同时写出文件
 */
export function imagesToMp4(opts: {
  frames: Buffer[];
  fps: number;
  audioPath?: string | null;
  outputPath?: string | null;
}): Promise<Buffer>;

/**
 * MP4 解帧为 PNG Buffer 数组
 * @param opts.mp4Input  MP4 Buffer 或文件路径
 * @param opts.fps       抽帧帧率（省略则按原始帧率全提取）
 */
export function mp4ToFrames(opts: {
  mp4Input: Buffer | string;
  fps?: number | null;
}): Promise<{ frames: Buffer[]; fps: number }>;

/**
 * 帧序列 → 合成 MP4 → 编码为鸭子图（一步封装）
 */
export function encodeVideoFrames(opts: EncodeOptions & {
  frames: Buffer[];
  fps: number;
  audioPath?: string | null;
}): Promise<EncodeResult>;

// ─── 底层工具 API ─────────────────────────────────────────────────────────────

/** 计算指定 payload 长度所需的画布像素尺寸 */
export function requiredCanvasSize(payloadBits: number, compress?: CompressLevel): number;

/**
 * 将字节数组转为二进制图 PNG（3 bytes = 1 pixel，用于存储 MP4 原始字节）
 * @param bytes   原始字节
 * @param size    目标图像尺寸（正方形，默认 512）
 */
export function bytesToBinaryImage(bytes: Buffer, size?: number): Promise<Buffer>;

/** 从二进制图 PNG 中还原字节（去除末尾零填充） */
export function binaryImageToBytes(pngBuffer: Buffer): Promise<Buffer>;

/** 构造文件头二进制数据 */
export function buildFileHeader(opts: {
  ext: string;
  dataLength: number;
  password?: string;
}): Buffer;

/** 解析文件头 */
export function parseHeader(buf: Buffer, password?: string): {
  ext: string;
  dataStart: number;
  dataLength: number;
};

/** 将 payload 隐写到 PNG 图像中，返回新的 PNG Buffer */
export function embedPayloadLSB(
  pngBuffer: Buffer,
  payloadBits: number[],
  compress?: CompressLevel
): Promise<Buffer>;

/** 从 PNG 图像中提取隐写数据（尝试指定的 k 值） */
export function extractPayloadWithK(
  pngBuffer: Buffer,
  k: CompressLevel
): Promise<{ bits: number[]; bytesFromBits: (bits: number[]) => Buffer }>;

/** 完整流程：构造 header → embed → 返回鸭子图 Buffer */
export function exportDuckPayload(opts: {
  rawBytes: Buffer;
  ext: string;
  password?: string;
  title?: string;
  compress?: CompressLevel;
}): Promise<Buffer>;

/** 用 SVG 生成鸭子图底图（返回 PNG Buffer） */
export function buildDuckImageBuffer(size: number, title?: string): Promise<Buffer>;

/** 生成鸭子 SVG 字符串 */
export function buildDuckImageSVG(size: number, title?: string): string;
