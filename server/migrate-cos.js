/**
 * COS 换桶迁移脚本：把旧桶的全部对象复制到新桶（对象 key 保持不变）
 *
 * 前提：
 *   1. server/.env 已配置新桶的 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION
 *   2. 新旧桶属于同一个腾讯云账号（跨账号不支持直接复制）
 *   3. 新旧桶同地域时复制走内网免流量费；跨地域会产生流量费
 *
 * 用法（在 server 目录下）：
 *   node migrate-cos.js <旧桶名> [旧桶地域，默认 ap-beijing]
 * 示例：
 *   node migrate-cos.js mengxiang-1405756754 ap-beijing
 *
 * 说明：
 *   - 只复制不删除，旧桶文件原样保留，验证无误后可自行清空/删除旧桶
 *   - 可重复执行：已存在的对象会跳过（按大小校验），断点可续跑
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const COS = require('cos-nodejs-sdk-v5');

const [oldBucket, oldRegionArg] = process.argv.slice(2);
if (!oldBucket) {
  console.error('用法: node migrate-cos.js <旧桶名> [旧桶地域，默认 ap-beijing]');
  process.exit(1);
}
const oldRegion = oldRegionArg || 'ap-beijing';

const newBucket = process.env.COS_BUCKET;
const newRegion = process.env.COS_REGION || 'ap-beijing';
const SecretId = process.env.COS_SECRET_ID;
const SecretKey = process.env.COS_SECRET_KEY;

if (!newBucket || !SecretId || !SecretKey) {
  console.error('请先在 server/.env 配置 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET');
  process.exit(1);
}
if (oldBucket === newBucket && oldRegion === newRegion) {
  console.error('旧桶与新桶相同，无需迁移');
  process.exit(1);
}

const cos = new COS({ SecretId, SecretKey });

function listAll(bucket, region) {
  return new Promise((resolve, reject) => {
    const keys = [];
    const step = () => {
      cos.getBucket({
        Bucket: bucket, Region: region,
        Marker: keys.length ? keys[keys.length - 1].key : '',
        MaxKeys: 1000
      }, (err, data) => {
        if (err) return reject(err);
        for (const item of data.Contents || []) {
          keys.push({ key: item.Key, size: Number(item.Size) });
        }
        if (data.IsTruncated === 'true') step();
        else resolve(keys);
      });
    };
    step();
  });
}

function headObject(bucket, region, key) {
  return new Promise((resolve) => {
    cos.headObject({ Bucket: bucket, Region: region, Key: key }, (err, data) => {
      resolve(err ? null : Number(data.headers['content-length']));
    });
  });
}

function copyObject(fromBucket, fromRegion, key) {
  return new Promise((resolve, reject) => {
    cos.putObjectCopy({
      Bucket: newBucket, Region: newRegion, Key: key,
      CopySource: encodeURIComponent(`${fromBucket}.cos.${fromRegion}.myqcloud.com/${key}`)
    }, (err) => err ? reject(err) : resolve());
  });
}

(async () => {
  console.log(`旧桶: ${oldBucket} (${oldRegion})`);
  console.log(`新桶: ${newBucket} (${newRegion})\n`);

  console.log('正在列出旧桶对象...');
  const objects = await listAll(oldBucket, oldRegion);
  const totalSize = objects.reduce((s, o) => s + o.size, 0);
  console.log(`共 ${objects.length} 个对象，合计 ${(totalSize / 1024 / 1024).toFixed(2)} MB\n`);

  let copied = 0, skipped = 0, failed = 0;
  for (let i = 0; i < objects.length; i++) {
    const { key, size } = objects[i];
    try {
      const existingSize = await headObject(newBucket, newRegion, key);
      if (existingSize === size) {
        skipped++;
      } else {
        await copyObject(oldBucket, oldRegion, key);
        copied++;
      }
    } catch (e) {
      failed++;
      console.error(`  ❌ 失败: ${key} —— ${e.message || e.code || e}`);
    }
    process.stdout.write(`进度: ${i + 1}/${objects.length}（复制 ${copied}，跳过 ${skipped}，失败 ${failed}）\r`);
  }
  console.log(`\n\n完成：复制 ${copied}，跳过（已存在）${skipped}，失败 ${failed}`);
  if (failed > 0) {
    console.log('有失败项，可直接重新运行本脚本续跑（已复制的会自动跳过）');
    process.exit(1);
  }
})().catch(e => {
  console.error('迁移失败:', e.message || e);
  process.exit(1);
});
