// 统一 API 响应封装
function success(res, data = null, message = '操作成功', code = 200) {
  return res.json({
    code,
    success: true,
    message,
    data
  });
}

function fail(res, message = '操作失败', code = 400, extra = {}) {
  return res.status(code >= 100 && code < 600 ? code : 400).json({
    code,
    success: false,
    message,
    data: null,
    ...extra
  });
}

// 分页响应
function paginate(res, rows, count, page, pageSize) {
  return res.json({
    code: 200,
    success: true,
    message: '查询成功',
    data: {
      list: rows,
      total: count,
      page: Number(page),
      pageSize: Number(pageSize),
      totalPages: Math.ceil(count / pageSize)
    }
  });
}

// 统一规范化分页参数：page>=1，1<=pageSize<=100，
// 防止 pageSize=abc（NaN 崩溃）、pageSize=100000（一次拉全表）、page=0/负数（非法 offset）
function normalizePage(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 10));
  return { page, pageSize };
}

module.exports = { success, fail, paginate, normalizePage };
