/**
 * 密码找回验证码（无表 HMAC 方案）单元测试
 * 覆盖：生成/校验、时间窗宽限、防重放（密码哈希指纹）
 */
const { test } = require('node:test');
const assert = require('node:assert');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';
const resetCode = require('../utils/resetCode');

test('验证码：6 位数字，当前窗可校验', () => {
  const code = resetCode.generate(42, 'hash-abc', 1700000000000);
  assert.match(code, /^\d{6}$/);
  assert.ok(resetCode.verify(42, 'hash-abc', code, 1700000000000));
});

test('验证码：跨窗边界宽限上一窗（10 分钟窗）', () => {
  const t0 = 1700000000000;
  const code = resetCode.generate(42, 'hash-abc', t0);
  // 同窗晚些时候
  assert.ok(resetCode.verify(42, 'hash-abc', code, t0 + 9 * 60 * 1000));
  // 进入下一窗（上一窗仍放行）
  assert.ok(resetCode.verify(42, 'hash-abc', code, t0 + 11 * 60 * 1000));
  // 两个窗之后失效
  assert.ok(!resetCode.verify(42, 'hash-abc', code, t0 + 25 * 60 * 1000));
});

test('验证码：密码变更后旧码失效（防重放的核心）', () => {
  const t0 = 1700000000000;
  const code = resetCode.generate(42, 'old-hash', t0);
  assert.ok(resetCode.verify(42, 'old-hash', code, t0));
  // 密码已改 → 同一验证码不再有效
  assert.ok(!resetCode.verify(42, 'new-hash', code, t0));
});

test('验证码：格式非法直接拒绝', () => {
  assert.ok(!resetCode.verify(42, 'h', 'abc12'));
  assert.ok(!resetCode.verify(42, 'h', ''));
  assert.ok(!resetCode.verify(42, 'h', null));
  assert.ok(!resetCode.verify(42, 'h', '1234567'));
});
