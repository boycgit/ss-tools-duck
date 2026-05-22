/**
 * test.js — 端到端测试：编码 → 解码，验证数据完整性
 *
 * 运行：
 *   npm install
 *   node test.js
 */

'use strict';

const { encodeImage, encodeText, encodeBytes, decodeDuckImage } = require('./index');
const sharp  = require('sharp');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function makeTestPng(width = 64, height = 64) {
  // 生成一张随机颜色的测试 PNG
  const pixels = crypto.randomBytes(width * height * 3);
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

// ─── 测试 1：文本编解码（无密码） ────────────────────────────────────────────
async function testTextNoPwd() {
  console.log('\n[Test 1] 文本编解码（无密码）');
  const original = 'Hello, 鸭鸭图 Node.js！🦆 ' + crypto.randomBytes(16).toString('hex');

  const { imageBuffer } = await encodeText({ text: original, compress: 2 });
  const result = await decodeDuckImage({ duckImage: imageBuffer });

  assert(result.ext === 'txt', `ext 应为 txt，实际：${result.ext}`);
  assert(result.text === original, `文本内容应一致`);
}

// ─── 测试 2：文本编解码（有密码） ────────────────────────────────────────────
async function testTextWithPwd() {
  console.log('\n[Test 2] 文本编解码（有密码）');
  const original = '这是一段加密文本 ' + Date.now();
  const pwd      = 'SecurePass123!';

  const { imageBuffer } = await encodeText({ text: original, password: pwd, compress: 2 });
  const result = await decodeDuckImage({ duckImage: imageBuffer, password: pwd });

  assert(result.text === original, '加密文本应正确还原');

  // 错误密码应抛错
  let thrown = false;
  try {
    await decodeDuckImage({ duckImage: imageBuffer, password: 'wrongpwd' });
  } catch {
    thrown = true;
  }
  assert(thrown, '错误密码应抛出异常');
}

// ─── 测试 3：图片编解码（compress=2） ─────────────────────────────────────────
async function testImageCompress2() {
  console.log('\n[Test 3] 图片编解码（compress=2）');
  const original = await makeTestPng(32, 32);

  const { imageBuffer } = await encodeImage({ image: original, compress: 2 });
  const result = await decodeDuckImage({ duckImage: imageBuffer });

  assert(result.ext === 'png', `ext 应为 png，实际：${result.ext}`);
  assert(result.data.equals(original), '图片字节应完全一致');
}

// ─── 测试 4：图片编解码（compress=6） ─────────────────────────────────────────
async function testImageCompress6() {
  console.log('\n[Test 4] 图片编解码（compress=6）');
  const original = await makeTestPng(48, 48);

  const { imageBuffer } = await encodeImage({ image: original, compress: 6 });
  const result = await decodeDuckImage({ duckImage: imageBuffer });

  assert(result.ext === 'png', `ext 应为 png`);
  assert(result.data.equals(original), '图片字节应完全一致（compress=6）');
}

// ─── 测试 5：图片编解码（compress=8） ─────────────────────────────────────────
async function testImageCompress8() {
  console.log('\n[Test 5] 图片编解码（compress=8）');
  const original = await makeTestPng(48, 48);

  const { imageBuffer } = await encodeImage({ image: original, compress: 8 });
  const result = await decodeDuckImage({ duckImage: imageBuffer });

  assert(result.ext === 'png', `ext 应为 png`);
  assert(result.data.equals(original), '图片字节应完全一致（compress=8）');
}

// ─── 测试 6：任意二进制数据 ────────────────────────────────────────────────────
async function testBinaryData() {
  console.log('\n[Test 6] 任意二进制数据编解码');
  const original = crypto.randomBytes(512); // 512 字节随机数据
  const { imageBuffer } = await encodeBytes({ rawBytes: original, ext: 'bin', compress: 2 });
  const result = await decodeDuckImage({ duckImage: imageBuffer });

  assert(result.ext === 'bin', `ext 应为 bin，实际：${result.ext}`);
  assert(result.data.equals(original), '二进制数据应完全一致');
}

// ─── 测试 7：带标题的鸭子图 ───────────────────────────────────────────────────
async function testTitleRendering() {
  console.log('\n[Test 7] 带标题的鸭子图（验证可生成不报错）');
  const text = 'test with title';
  const { imageBuffer } = await encodeText({ text, title: '测试标题 Hello', compress: 2 });
  const result = await decodeDuckImage({ duckImage: imageBuffer });

  assert(result.text === text, '带标题图片解码应正常');
  assert(imageBuffer.length > 0, '输出 PNG Buffer 不为空');
}

// ─── 测试 8：密码为空字符串时不加密 ──────────────────────────────────────────
async function testEmptyPasswordNoEncrypt() {
  console.log('\n[Test 8] 空密码 = 不加密，任意密码可解码');
  const text = 'no encryption test';
  const { imageBuffer } = await encodeText({ text, password: '', compress: 2 });

  // 无论传什么密码（包括随机字符串）都应该能解码，因为 has_pwd=0
  const result = await decodeDuckImage({ duckImage: imageBuffer, password: 'any_password' });
  assert(result.text === text, '无加密图片不应受密码影响');
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  SS_tools Duck Node.js — 功能测试');
  console.log('═══════════════════════════════════════════');

  try {
    await testTextNoPwd();
    await testTextWithPwd();
    await testImageCompress2();
    await testImageCompress6();
    await testImageCompress8();
    await testBinaryData();
    await testTitleRendering();
    await testEmptyPasswordNoEncrypt();
  } catch (err) {
    console.error('\n❌ 测试运行时异常：', err);
    failed++;
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(`  结果：${passed} 通过 / ${failed} 失败`);
  console.log('═══════════════════════════════════════════');
  process.exit(failed > 0 ? 1 : 0);
}

main();
