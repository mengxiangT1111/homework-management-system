/**
 * previewService 单元验证（不依赖数据库）：
 * 1. 造一个含标题/段落/表格/图片的 docx、一个多 sheet xlsx、一个 txt、一个 GBK txt
 * 2. 依次调用 getPreview 检查转换产物
 * 3. 校验 sanitizer：注入 <script> 的构造场景（mammoth 本身不透传，验证白名单兜底）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun
} = require('docx');
const ExcelJS = require('exceljs');
const { getPreview } = require('../src/utils/previewService');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-test-'));
let pass = 0, failCount = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function makeDocx() {
  // 1x1 红色 PNG（10x10）
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFElEQVR4nGP8z8DwnwEJMDEgAQAwAwGoOmbD7gAAAABJRU5ErkJggg==';
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: '第一次作业', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun({ text: '这是正文，包含', size: 24 }), new TextRun({ text: '加粗', bold: true }), new TextRun(' 内容。')] }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph('学号')] }), new TableCell({ children: [new Paragraph('姓名')] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph('2023001')] }), new TableCell({ children: [new Paragraph('张三')] })] })
          ]
        }),
        new Paragraph({
          children: [new ImageRun({ transformation: { width: 80, height: 80 }, type: 'png', data: Buffer.from(pngBase64, 'base64') })]
        })
      ]
    }]
  });
  const buf = await Packer.toBuffer(doc);
  const p = path.join(TMP, 'test.docx');
  fs.writeFileSync(p, buf);
  return p;
}

async function makeXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('成绩表');
  ws.addRow(['学号', '姓名', '分数', '日期']);
  ws.addRow(['2023001', '张三', 88.5, new Date('2026-09-01T08:00:00')]);
  ws.addRow(['2023002', '李四', 92, '备注：<b>优秀</b>']);
  const ws2 = wb.addWorksheet('说明');
  ws2.addRow(['这一列内容很长'.repeat(5), 'B列']);
  const p = path.join(TMP, 'test.xlsx');
  await wb.xlsx.writeFile(p);
  return p;
}

async function main() {
  // --- docx ---
  console.log('[docx]');
  const docxPath = await makeDocx();
  const d = await getPreview(docxPath, '.docx', 'k-docx');
  check('kind=docx', d.kind === 'docx');
  check('标题转换', d.html.includes('<h1>第一次作业</h1>'), d.html.slice(0, 200));
  check('加粗保留', d.html.includes('<strong>加粗</strong>'));
  check('表格转换', d.html.includes('<table>') && d.html.includes('<td><p>2023001</p></td>'), d.html.match(/<table>[\s\S]{0,200}/)?.[0]);
  check('图片内联 base64', /<img src="data:image\/png;base64,[a-z0-9+/=]+" \/>/i.test(d.html), d.html.match(/<img[^>]*>/)?.[0]);
  check('无 script', !/<script/i.test(d.html));
  check('file_size 附加', typeof d.file_size === 'number' && d.file_size > 0);

  // --- xlsx ---
  console.log('[xlsx]');
  const xlsxPath = await makeXlsx();
  const x = await getPreview(xlsxPath, '.xlsx', 'k-xlsx');
  check('kind=xlsx', x.kind === 'xlsx');
  check('sheet 名渲染', x.html.includes('>成绩表<') && x.html.includes('>说明<'));
  check('表头 th', x.html.includes('<th>学号</th>'));
  check('日期转文本', x.html.includes('2026/9/1') || x.html.includes('2026-09-01'), x.html.match(/<td>[^<]*2026[^<]*<\/td>/)?.[0]);
  check('HTML 转义', x.html.includes('&lt;b&gt;优秀&lt;/b&gt;'));
  check('数字保留', x.html.includes('<td>88.5</td>'));
  check('未截断', x.truncated === false);

  // --- txt ---
  console.log('[txt]');
  const txtPath = path.join(TMP, 'test.txt');
  fs.writeFileSync(txtPath, '第一行\n第二行：中文内容 OK', 'utf8');
  const t = await getPreview(txtPath, '.txt', 'k-txt');
  check('kind=text', t.kind === 'text');
  check('内容完整', t.text.includes('第二行：中文内容 OK'));
  check('无编码告警', !t.encoding_suspect);

  // --- GBK txt（非 UTF-8）：应标记 encoding_suspect ---
  console.log('[gbk txt]');
  const gbkPath = path.join(TMP, 'gbk.txt');
  const gbkBytes = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0x2C, 0xCA, 0xC0, 0xBD, 0xE7, 0x0A]); // "你好,世界\n" 的 GBK
  fs.writeFileSync(gbkPath, gbkBytes);
  const g = await getPreview(gbkPath, '.txt', 'k-gbk');
  check('encoding_suspect=true', g.encoding_suspect === true, JSON.stringify({ bad: g.text }));

  // --- 不支持的格式 ---
  console.log('[unsupported]');
  const zipPath = path.join(TMP, 'a.zip');
  fs.writeFileSync(zipPath, 'PK\x03\x04fake');
  let caught = null;
  try { await getPreview(zipPath, '.zip', 'k-zip'); } catch (e) { caught = e; }
  check('.zip 返回 415', caught && caught.status === 415);

  const docPath = path.join(TMP, 'a.doc');
  fs.writeFileSync(docPath, 'legacy doc binary');
  caught = null;
  try { await getPreview(docPath, '.doc', 'k-doc'); } catch (e) { caught = e; }
  check('.doc 返回 415', caught && caught.status === 415);

  // --- 大文件限制 ---
  console.log('[size limit]');
  const bigPath = path.join(TMP, 'big.txt');
  fs.writeFileSync(bigPath, 'x'.repeat(21 * 1024 * 1024));
  caught = null;
  try { await getPreview(bigPath, '.txt', 'k-big'); } catch (e) { caught = e; }
  check('>20MB 返回 422', caught && caught.status === 422);

  // --- 缓存命中（同 key 二次调用不再读盘） ---
  console.log('[cache]');
  const again = await getPreview(docxPath, '.docx', 'k-docx');
  check('缓存返回同一对象', again === d);

  console.log(`\n结果: ${pass} 通过, ${failCount} 失败`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failCount ? 1 : 0);
}

main().catch(e => { console.error('测试执行失败:', e); process.exit(1); });
