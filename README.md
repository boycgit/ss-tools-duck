# SS_tools Duck — Node.js 隐写工具库

将任意数据（文本、图片、视频、文件）隐藏在一张可爱的鸭子图片中，或从鸭子图中还原数据。

完全对应 ComfyUI 插件 [SS_tools](../) 的 Python 实现，编码格式互相兼容。

---

## 目录

- [快速开始](#快速开始)
- [安装依赖](#安装依赖)
- [命令行 CLI](#命令行-cli)
- [编程 API](#编程-api)
  - [encode — 编码](#encode--编码)
  - [decode — 解码](#decode--解码)
  - [video — 视频合成](#video--视频合成需-ffmpeg)
  - [底层工具](#底层工具)
- [与 Python 版互通](#与-python-版互通)
- [参数说明](#参数说明)

---

## 快速开始

```bash
# 隐藏文字
node duck-cli.js encode text secret.png --text="你好，世界" --password=mypass

# 还原文字
node duck-cli.js decode secret.png --password=mypass
```

---

## 安装依赖

```bash
cd nodejs
npm install
```

**依赖项：**

| 包 | 用途 |
|---|---|
| `sharp` | PNG 像素读写 |
| `fluent-ffmpeg` | 视频合成 / 解帧（需系统 ffmpeg） |
| `glob` | CLI frames 命令路径展开 |

> **视频功能**需要在系统中安装 [ffmpeg](https://ffmpeg.org/download.html) 并加入 `PATH`。
> 运行 `node duck-cli.js check-ffmpeg` 验证是否可用。

---

## 命令行 CLI

### encode text — 隐藏文本

```bash
node duck-cli.js encode text <输出.png> --text="内容" [--password=密码] [--title=标题] [--compress=2|6|8]

# 从文件读取文本
node duck-cli.js encode text out.png --text-file=secret.txt --password=abc
```

### encode image — 隐藏图片

```bash
node duck-cli.js encode image <输出.png> --input=<图片路径> [--password=密码] [--title=标题] [--compress=2|6|8]
```

### encode bytes — 隐藏任意文件

```bash
node duck-cli.js encode bytes <输出.png> --input=<文件路径> [--ext=扩展名] [--password=密码]

# 隐藏 PDF
node duck-cli.js encode bytes out.png --input=report.pdf
```

### encode video — 隐藏 MP4

```bash
node duck-cli.js encode video <输出.png> --input=<视频.mp4> [--password=密码] [--title=标题]
```

### encode frames — 帧序列 → 视频 → 鸭子图（需 ffmpeg）

```bash
node duck-cli.js encode frames <输出.png> --frames="./frames/*.png" --fps=30 [--audio=bgm.mp3]
```

### decode — 解码还原

```bash
node duck-cli.js decode <输入.png> [--password=密码] [--output=输出目录] [--json]

# --json 只输出元数据，不写文件
node duck-cli.js decode secret.png --password=abc --json
```

输出示例：
```json
{
  "ext": "txt",
  "filePath": "/path/to/duck_recovered.txt",
  "text": "你好，世界",
  "dataBytes": 15
}
```

### check-ffmpeg — 检查 ffmpeg

```bash
node duck-cli.js check-ffmpeg
```

---

## 编程 API

```js
const duck = require('./index');  // 或 require('./index.js')
```

### encode — 编码

#### `encodeText(opts)` → `Promise<{ imageBuffer, filePath? }>`

```js
const { imageBuffer } = await duck.encodeText({
  text:       '要隐藏的文字',
  password:   'my_password',   // 省略 = 不加密
  title:      '鸭子标题',      // 显示在图片右下角
  compress:   2,               // 2 / 6 / 8，默认 2
  outputPath: 'out.png',       // 省略 = 不写文件，只返回 Buffer
});
```

#### `encodeImage(opts)` → `Promise<EncodeResult>`

```js
const imageData = fs.readFileSync('photo.jpg');
const { filePath } = await duck.encodeImage({
  image:      imageData,
  compress:   6,
  outputPath: 'duck_out.png',
});
```

#### `encodeBytes(opts)` → `Promise<EncodeResult>`

```js
const pdfBytes = fs.readFileSync('report.pdf');
await duck.encodeBytes({
  rawBytes:   pdfBytes,
  ext:        'pdf',
  outputPath: 'duck_pdf.png',
});
```

#### `encodeMp4(opts)` → `Promise<EncodeResult>`

```js
const mp4Buffer = fs.readFileSync('video.mp4');
await duck.encodeMp4({
  mp4Input:   mp4Buffer,          // Buffer 或文件路径字符串
  password:   'secret',
  outputPath: 'duck_video.png',
});
```

#### `encodeImageSequence(opts)` → `Promise<{ imageBuffers, filePaths? }>`

```js
const frames = [buf1, buf2, buf3];  // 每帧一个 PNG/JPEG Buffer
const { filePaths } = await duck.encodeImageSequence({
  images:    frames,
  outputDir: './output',
});
// → output/duck_000.png, duck_001.png, duck_002.png
```

---

### decode — 解码

#### `decodeDuckImage(opts)` → `Promise<DecodeResult>`

```js
const result = await duck.decodeDuckImage({
  duckImage: fs.readFileSync('secret.png'),  // Buffer 或文件路径
  password:  'my_password',
  outputDir: './recovered',
});

console.log(result.ext);          // "txt" | "png" | "mp4" | "pdf" …
console.log(result.text);         // 若是文本则已解码为字符串
console.log(result.imageBuffer);  // 若是图片
console.log(result.mp4Buffer);    // 若是视频
console.log(result.filePath);     // 还原文件的路径
```

#### 便捷接口

```js
// 从文件路径
const result = await duck.decodeFromFile('secret.png', 'password', './out');

// 从 Buffer
const result = await duck.decodeFromBuffer(pngBuffer, 'password', './out');
```

---

### video — 视频合成（需 ffmpeg）

#### `imagesToMp4(opts)` → `Promise<Buffer>`

```js
const frames = pngBuffers;  // PNG Buffer 数组
const mp4Buf = await duck.imagesToMp4({
  frames,
  fps:        30,
  audioPath:  'bgm.mp3',     // 可选
  outputPath: 'output.mp4',  // 可选
});
```

#### `mp4ToFrames(opts)` → `Promise<{ frames, fps }>`

```js
const { frames, fps } = await duck.mp4ToFrames({
  mp4Input: fs.readFileSync('video.mp4'),
  fps:      null,  // null = 原始帧率
});
```

#### `encodeVideoFrames(opts)` → `Promise<EncodeResult>`

帧序列一步编码为鸭子图：

```js
await duck.encodeVideoFrames({
  frames:     pngBuffers,
  fps:        24,
  audioPath:  'bgm.wav',
  password:   'secret',
  outputPath: 'duck_video.png',
});
```

---

### 底层工具

```js
const {
  buildFileHeader,
  parseHeader,
  exportDuckPayload,
  embedPayloadLSB,
  extractPayloadWithK,
  bytesToBinaryImage,
  binaryImageToBytes,
  buildDuckImageBuffer,
  requiredCanvasSize,
} = require('./duck_payload_exporter');
```

详见 [index.d.ts](./index.d.ts) 获取完整类型定义。

---

## 与 Python 版互通

Node.js 和 Python 版本使用**完全相同的二进制格式**，可以互相编解码：

| Python（ComfyUI 节点）编码 → Node.js 解码 | ✅ 支持 |
|---|---|
| Node.js 编码 → Python（ComfyUI 节点）解码 | ✅ 支持 |

对齐细节：

| 常量 / 算法 | 值 |
|---|---|
| 水印跳过区域 | 左上角 `40% 宽 × 8% 高` |
| bit 顺序 | 大端（高位优先）—— 对应 `np.unpackbits(bitorder="big")` |
| 文件头格式 | `[has_pwd:1][pwdHash:32][salt:16][extLen:1][ext][dataLen:4 BE][data]` |
| 长度前缀 | 4 字节大端整数，存储在图像 LSB 前 |
| XOR 密钥流 | `SHA-256(password + counter)` 迭代生成 |

---

## 参数说明

### `compress` 参数

| 值 | 每通道隐藏 bit 数 | 视觉失真 | 最大容量（512×512 图） |
|---|---|---|---|
| `2` | 2 bit | 极低，肉眼不可见 | ~65 KB |
| `6` | 6 bit | 低 | ~196 KB |
| `8` | 8 bit | 中（颜色偏差明显） | ~262 KB |

### `password` 参数

- 空字符串 `""` 或省略：**不加密**，任何人可解码
- 非空字符串：使用 SHA-256 + 随机 salt 的 XOR 流加密

### 文件大小限制

实际可隐藏的数据量取决于鸭子图的分辨率和 `compress` 值：

$$容量(bytes) = \frac{(宽 × 高 - 水印区像素数) × 3 × k}{8} - 文件头长度$$

其中 $k$ = compress 值（2/6/8），水印区为左上 40%×8% 区域。
