import { get } from './request'

const BADGE_INDEX = 2 // tabBar 第 3 位是"消息"

/** 刷新消息角标（失败静默，不影响页面） */
export async function refreshBadge() {
  try {
    const data = await get('/api/notifications/unread/count', null, { silent: true })
    const n = (data && Number(data.count)) || 0
    if (n > 0) {
      // 微信角标 text 上限 3 个字符，超限会 fail；≥1000 封顶显示 999+
      const text = n > 999 ? '999+' : String(n)
      uni.setTabBarBadge({ index: BADGE_INDEX, text, fail: () => {} })
    } else {
      uni.removeTabBarBadge({ index: BADGE_INDEX, fail: () => {} })
    }
    return n
  } catch (e) {
    return 0
  }
}
