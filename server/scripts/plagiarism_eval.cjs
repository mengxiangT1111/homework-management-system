/**
 * plagiarism_eval.cjs — P2 查重实验批量评测（plagiarism_set_1000 × 真实检测服务）
 *
 * 配对设计（固定种子可复现）：
 *   每个 gXXX_t1 作为 source，candidates =
 *     组内 t2/t3/t4/t5（4 个正对，有抄袭关系）
 *   + 跨组 8 张 t1（4 张同族 + 4 张异族，负对/独立作答对照）
 * 共 200 次 detect 调用 → 800 正对 + 1600 负对，逐对落盘 JSONL。
 *
 * 输出：docs/experiment_data/glm45air/plagiarism_pairs.jsonl
 * 断点续跑：已完成的 source 跳过（按输出文件里出现过的 source 判断）。
 * 用法（server 目录下）：
 *   node scripts/plagiarism_eval.cjs                          # 全量
 *   node scripts/plagiarism_eval.cjs --tiers=3,5 --out=xx.jsonl  # 只比对指定档位（负对仍采，供同批对照）
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');

const BASE_URL = 'http://localhost:8000/api/detect';
const TOKEN = process.env.DETECTION_API_TOKEN;
// 检测服务按 Node 生产链路约定收绝对路径（ensureLocalFile 的返回形式）；
// 相对路径在该服务实测不解析，勿改回相对形式
const ABS_DIR = path.resolve(__dirname, '../uploads/202610_exp');
const GT_CSV = path.resolve(__dirname, '../../docs/experiment_data/plagiarism_set_1000/ground_truth.csv');
const OUT = path.resolve(__dirname, '../../docs/experiment_data/glm45air/plagiarism_pairs.jsonl');

// 与 python random 一致的可复现采样：用简单 LCG，种子固定
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function loadGroundTruth() {
  const lines = fs.readFileSync(GT_CSV, 'utf-8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  return lines.slice(1).map(l => {
    const cells = l.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

async function callDetect(sourcePath, candidates, attempt = 1) {
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Token': TOKEN },
    body: JSON.stringify({ source_path: sourcePath, candidate_paths: candidates })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 3000 * attempt));
      return callDetect(sourcePath, candidates, attempt + 1);
    }
    throw new Error(`detect HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

(async () => {
  if (!TOKEN) throw new Error('缺少 DETECTION_API_TOKEN');
  // --tiers=3,5 只比对指定档位；--out= 覆盖输出文件
  const tierArg = (process.argv.find(a => a.startsWith('--tiers=')) || '').replace('--tiers=', '');
  const tiers = tierArg ? tierArg.split(',').map(Number) : null;
  const outArg = process.argv.find(a => a.startsWith('--out='));
  const OUT_FILE = outArg ? path.resolve(outArg.replace('--out=', '')) : OUT;

  const gt = loadGroundTruth();
  const t1s = gt.filter(r => r.tier === '1');
  if (t1s.length !== 200) throw new Error(`t1 基准图应为 200 张，实际 ${t1s.length}`);

  // 断点续跑：收集已完成的 source（取自候选侧出现过的组号）
  let doneSrc = new Set();
  if (fs.existsSync(OUT_FILE)) {
    for (const line of fs.readFileSync(OUT_FILE, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try { doneSrc.add(JSON.parse(line).source); } catch { }
    }
  }
  const out = fs.createWriteStream(OUT_FILE, { flags: 'a' });

  const rng = makeRng(20261001);
  const t0 = Date.now();
  let pairCount = 0;

  for (let gi = 0; gi < t1s.length; gi++) {
    const src = t1s[gi];
    const group = src.group;
    if (doneSrc.has(src.file)) { console.log(`[跳过] ${src.file} 已完成`); continue; }

    // 正对：组内 t2-t5（--tiers 指定时只取指定档位）
    const positives = gt.filter(r => r.group === group && r.tier !== '1'
      && (!tiers || tiers.includes(Number(r.tier))));

    // 负对：跨组 t1，同族 4 + 异族 4
    const sameFamily = t1s.filter(r => r.group !== group && r.family === src.family);
    const diffFamily = t1s.filter(r => r.group !== group && r.family !== src.family);
    const pick = (arr, n) => {
      const out = [];
      const pool = [...arr];
      while (out.length < n && pool.length) {
        out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      }
      return out;
    };
    const negatives = [...pick(sameFamily, 4), ...pick(diffFamily, 4)];

    const candidates = [
      ...positives.map(r => ({ rel: `${ABS_DIR}/${r.file}`, row: r, label: 1 })),
      ...negatives.map(r => ({ rel: `${ABS_DIR}/${r.file}`, row: r, label: 0 }))
    ];

    const resp = await callDetect(`${ABS_DIR}/${src.file}`, candidates.map(c => c.rel));
    const byCand = new Map((resp.results || []).map(r => [r.candidate, r]));

    for (const c of candidates) {
      const r = byCand.get(c.rel) || {};
      const rec = {
        source: src.file, source_family: src.family,
        candidate: c.row.file, cand_family: c.row.family,
        tier: Number(c.row.tier), group: Number(c.row.group),
        label: c.label, // 1=有抄袭关系（组内变体） 0=独立作答（跨组）
        same_family: c.label === 0 && c.row.family === src.family ? 1 : 0,
        similarity_score: r.similarity_score ?? null,
        image_hash_score: r.image_hash_score ?? null,
        orb_match_count: r.orb_match_count ?? null,
        text_similarity: r.text_similarity ?? null,
        graph_similarity: r.graph_similarity ?? null,
        is_isomorphic: r.is_isomorphic ?? null,
        is_suspicious: r.is_suspicious ?? null
      };
      out.write(JSON.stringify(rec) + '\n');
      pairCount++;
    }

    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(`[${gi + 1}/200] ${src.file}（${src.family}）完成，累计 ${pairCount} 对，耗时 ${elapsed}s`);
  }

  out.end();
  console.log(`\n✓ 全部完成：新增 ${pairCount} 对，输出 ${OUT_FILE}`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
