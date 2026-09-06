/**
 * soffice（LibreOffice）CLI 的测试替身：
 * 与真实命令行参数对齐（--convert-to pdf --outdir DIR INPUT），在 outdir 生成
 * 一个带合法 xref 的最小 PDF，用于在没有安装 LibreOffice 的开发机上端到端测试
 * officeConverter 的定位、调用、缓存与控制器流式下发全链路。
 * 用法：SOFFICE_PATH=<本文件路径> node src/server.js（.js 路径自动经 node 执行）
 */
const fs = require('fs');
const path = require('path');

function buildMinimalPdf(text) {
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>';
  const stream = `BT /F1 16 Tf 20 70 Td (${text}) Tj ET`;
  objects[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const args = process.argv.slice(2);
const outdir = args[args.indexOf('--outdir') + 1];
const input = args[args.length - 1]; // soffice CLI 约定：输入文件在末尾
const base = path.basename(input).replace(/\.[^.]+$/, '');
const out = path.join(outdir, `${base}.pdf`);
fs.writeFileSync(out, buildMinimalPdf('MOCK CONVERTED PDF'));
console.log(`mock convert: ${input} -> ${out}`);
