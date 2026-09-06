/**
 * officeConverter 单元验证（用 mock-soffice 模拟 LibreOffice CLI）：
 * 1. SOFFICE_PATH 指向 mock 时完成"转换"并产出合法 PDF
 * 2. 同一文件二次转换命中落盘缓存（产物未被重写）
 * 3. 不同文件各自缓存
 * 4. 未配置转换服务时返回带友好提示的 415
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-'));
let pass = 0, failCount = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main() {
  // --- 场景 1：mock 转换 + 缓存 ---
  process.env.SOFFICE_PATH = path.join(__dirname, 'mock-soffice.js');
  delete require.cache[require.resolve('../src/utils/officeConverter')];
  const officeConverter = require('../src/utils/officeConverter');

  const docPath = path.join(TMP, 'report.doc');
  fs.writeFileSync(docPath, Buffer.from([0xD0, 0xCF, 0x11, 0xE0, ...Buffer.from('fake legacy doc')])); // OLE2 魔数开头

  const pdf1 = await officeConverter.convertToPdf(docPath, 'uploads/x/report.doc');
  check('转换产出 PDF 文件', fs.existsSync(pdf1) && pdf1.endsWith('.pdf'), pdf1);
  const head1 = fs.readFileSync(pdf1).subarray(0, 5).toString();
  check('PDF 头合法', head1 === '%PDF-', head1);

  const mtime1 = fs.statSync(pdf1).mtimeMs;
  const pdf2 = await officeConverter.convertToPdf(docPath, 'uploads/x/report.doc');
  check('同文件命中缓存（同一路径）', pdf2 === pdf1);
  check('缓存命中未重写产物', fs.statSync(pdf2).mtimeMs === mtime1);

  // --- 场景 2：不同存储路径各自缓存 ---
  const pdf3 = await officeConverter.convertToPdf(docPath, 'uploads/y/report.doc');
  check('不同路径独立缓存', pdf3 !== pdf1 && fs.existsSync(pdf3));

  // --- 场景 3：未配置转换服务 → 415 友好提示 ---
  process.env.SOFFICE_PATH = path.join(TMP, 'no-such-soffice.exe');
  delete require.cache[require.resolve('../src/utils/officeConverter')];
  const converterNoSoffice = require('../src/utils/officeConverter');
  const doc2 = path.join(TMP, 'deck.pptx');
  fs.writeFileSync(doc2, 'fake pptx');
  let caught = null;
  try { await converterNoSoffice.convertToPdf(doc2, 'uploads/z/deck.pptx'); } catch (e) { caught = e; }
  check('未安装转换服务返回 415', caught && caught.status === 415, caught && caught.message);
  check('提示语可引导下载', caught && caught.message.includes('下载查看'));

  console.log(`\n结果: ${pass} 通过, ${failCount} 失败`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failCount ? 1 : 0);
}

main().catch(e => { console.error('测试执行失败:', e); process.exit(1); });
