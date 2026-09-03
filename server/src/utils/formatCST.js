/**
 * 面向用户的北京时间格式化（YYYY-MM-DD HH:mm:ss）
 *
 * 背景：项目 Windows（+08:00）开发、Docker/Linux（默认 UTC）部署。
 * `new Date(x).toLocaleString('zh-CN')` 用的是进程本地时区，部署到 UTC 容器后
 * 所有给用户看的截止时间会早 8 小时。这里显式固定 Asia/Shanghai，
 * 与数据库连接的 timezone: '+08:00' 口径一致，不依赖进程 TZ。
 */
const cstFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function formatCST(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  // zh-CN 数字格式默认带 24 小时制下 00:00 的例外（hourCycle），统一补零输出
  return cstFormatter.format(d).replace(/\//g, '-');
}

module.exports = { formatCST };
