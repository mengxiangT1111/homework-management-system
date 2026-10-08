/**
 * 微信订阅消息通道（骨架，未激活）
 * =========================================
 * 激活前置条件（当前均未满足，配齐后本文件直接可用）：
 *   1. .env 配置 WX_APPID / WX_APPSECRET（mp 后台「开发设置」获取；AppSecret 不入库不进日志）
 *   2. 小程序端落地「授权登录 + 订阅消息授权」，把 openid 存到用户表（升级路线第 3 期）
 *   3. mp 后台申请订阅消息模板，模板 ID 配置到 WX_SUBSCRIBE_TEMPLATES
 *      （JSON，如 {"gradePublished":"AbC...","deadline":"xYz..."}）
 *
 * access_token 获取与缓存：稳定 token 有效期 7200s，提前 5 分钟刷新；
 * 并发下竞态无害（微信侧多次获取只是多一次调用，取到即覆盖缓存）。
 */
const WX_APPID = process.env.WX_APPID || '';
const WX_APPSECRET = process.env.WX_APPSECRET || '';

const configured = Boolean(WX_APPID && WX_APPSECRET);

let tokenCache = { token: '', expiresAt: 0 };

async function getAccessToken(force = false) {
  if (!configured) throw new Error('微信通道未配置（WX_APPID/WX_APPSECRET）');
  if (!force && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WX_APPID}&secret=${WX_APPSECRET}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`获取 access_token 失败: ${data.errcode} ${data.errmsg}`);
  }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 300) * 1000 };
  return data.access_token;
}

/**
 * 发送订阅消息
 * @param {string} openid 用户 openid（须已授权订阅该模板）
 * @param {string} templateId 模板 ID
 * @param {Object} data 模板字段，如 { thing1: { value: '作业已批改' }, number2: { value: 95 } }
 * @param {string} [page] 点击跳转的小程序页面，如 pages/assignments/detail?id=1
 */
async function sendSubscribeMessage(openid, templateId, data, page) {
  if (!configured) return { ok: false, error: '微信通道未配置' };
  try {
    const token = await getAccessToken();
    const res = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: openid,
        template_id: templateId,
        page: page || undefined,
        data,
        miniprogram_state: process.env.WX_MINIPROGRAM_STATE || 'formal'
      })
    });
    const json = await res.json();
    // 40001: token 失效 → 强刷一次重试
    if (json.errcode === 40001) {
      const t2 = await getAccessToken(true);
      const res2 = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${t2}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ touser: openid, template_id: templateId, page: page || undefined, data })
      });
      const json2 = await res2.json();
      return json2.errcode === 0 ? { ok: true } : { ok: false, error: `${json2.errcode} ${json2.errmsg}` };
    }
    return json.errcode === 0 ? { ok: true } : { ok: false, error: `${json.errcode} ${json.errmsg}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getTemplateId(name) {
  try {
    const map = JSON.parse(process.env.WX_SUBSCRIBE_TEMPLATES || '{}');
    return map[name] || null;
  } catch (e) {
    return null;
  }
}

module.exports = { configured, getAccessToken, sendSubscribeMessage, getTemplateId };
