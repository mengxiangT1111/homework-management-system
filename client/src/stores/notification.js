import { defineStore } from 'pinia'
import { notificationApi } from '@/api'

export const useNotificationStore = defineStore('notification', {
  state: () => ({
    unreadCount: 0,
    list: []
  }),
  actions: {
    async fetchUnreadCount() {
      try {
        const res = await notificationApi.unreadCount()
        this.unreadCount = res.data.count
      } catch (e) {
        // 静默
      }
    },
    async fetchList(params) {
      const res = await notificationApi.list(params)
      return res.data
    },
    async markRead(id) {
      await notificationApi.markRead(id)
      if (this.unreadCount > 0) this.unreadCount--
    },
    async markAllRead() {
      await notificationApi.markAllRead()
      this.unreadCount = 0
    },
    async remove(id) {
      await notificationApi.remove(id)
    }
  }
})
