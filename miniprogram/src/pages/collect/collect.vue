<template>
  <view class="page">
    <view class="pt">
      <view class="pt-bar"></view>
      <text class="pt-text">作业收集</text>
    </view>
    <text class="pt-desc">班委 / 课代表的催交工作台</text>

    <template v-if="sections.length">
      <view class="card" v-for="sec in sections" :key="sec.key">
        <view class="sec-head">
          <view class="row" style="gap: 14rpx; justify-content: flex-start;">
            <text class="tag tag-primary">{{ sec.roleText }}</text>
            <text class="sec-title" style="margin-bottom: 0;">{{ sec.title }}</text>
          </view>
          <text class="meta" v-if="sec.classSize">全班 {{ sec.classSize }} 人</text>
        </view>

        <template v-if="sec.assignments.length">
          <view class="col-item" v-for="a in sec.assignments" :key="a.id">
            <view class="row" hover-class="hv" @click="toggle(sec, a)">
              <view class="cell-main">
                <text class="cell-title ellipsis">{{ a.title }}</text>
                <text class="cell-sub">
                  {{ sec.type === 'leader' ? a.course_name : sec.courseName }} · 截止 {{ formatDateTime(a.deadline) }}
                </text>
              </view>
              <view class="col-right">
                <text class="col-rate" :style="{ color: rateColor(a.submit_rate) }">{{ a.submit_rate }}%</text>
                <text class="meta">{{ a.submitted_count }}/{{ a.total_students }}</text>
              </view>
            </view>
            <view class="prog-track col-prog">
              <view class="prog-fill" :style="{ width: a.submit_rate + '%', backgroundColor: rateColor(a.submit_rate) }"></view>
            </view>

            <!-- 展开未交名单 -->
            <view class="col-expand" v-if="expandedKey === sec.key + ':' + a.id">
              <view v-if="loadingUnsub" class="loading-more">加载中…</view>
              <template v-else-if="unsub">
                <view class="row" style="margin: 8rpx 0 14rpx;">
                  <text class="cell-sub" style="margin-top: 0;">已交 {{ unsub.submitted_count }} 人</text>
                  <text class="cell-sub danger-text" style="margin-top: 0;">未交 {{ unsub.unsubmitted_count }} 人</text>
                </view>
                <view class="unsub-chips" v-if="unsub.list.length">
                  <text class="unsub-chip" v-for="s in unsub.list" :key="s.id">
                    {{ s.real_name }}<template v-if="s.position !== 'none'">（{{ posText(s.position) }}）</template>
                  </text>
                </view>
                <empty-state v-else icon="🎉" text="全部交齐了" />
                <button
                  v-if="unsub.list.length"
                  class="btn-primary remind-btn"
                  hover-class="hv"
                  :disabled="reminding"
                  @click="remind(sec, a)"
                >
                  {{ reminding ? '催交中…' : '📣 一键催交（' + unsub.unsubmitted_count + ' 人）' }}
                </button>
              </template>
            </view>
          </view>
        </template>
        <empty-state v-else icon="🍃" :text="'该' + (sec.type === 'leader' ? '班级' : '课程') + '暂无作业'" />
      </view>
    </template>

    <empty-state v-else-if="!loading" icon="🏅" text="暂无班委或课代表职务" sub="被任命后这里会显示收集工作台" />
    <view class="loading-more" v-if="loading && !sections.length">加载中…</view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { get, post } from '../../utils/request'
import { useAuthStore } from '../../stores/auth'
import { formatDateTime } from '../../utils/format'

const auth = useAuthStore()

// sections: { key, type: 'leader'|'assistant', roleText, title, classSize, courseName?, classId/courseId, assignments }
const sections = ref([])
const loading = ref(true)
const expandedKey = ref('')
const unsub = ref(null)
const loadingUnsub = ref(false)
const reminding = ref(false)

onShow(() => {
  if (auth.isLoggedIn) loadAll()
})

async function loadAll() {
  loading.value = true
  expandedKey.value = ''
  unsub.value = null
  try {
    const [positions, ships] = await Promise.all([
      get('/api/classes/my/positions', null, { silent: true }).catch(() => []),
      get('/api/courses/my/assistantships', null, { silent: true }).catch(() => [])
    ])
    const secs = []
    for (const p of positions || []) {
      secs.push({
        key: 'L' + p.class_id,
        type: 'leader',
        classId: p.class_id,
        roleText: p.position_text || '班委',
        title: [p.class && p.class.grade, p.class && p.class.name].filter(Boolean).join(' '),
        classSize: 0,
        assignments: []
      })
    }
    for (const s of ships || []) {
      secs.push({
        key: 'A' + s.course_id,
        type: 'assistant',
        courseId: s.course_id,
        roleText: '课代表',
        title: s.course ? s.course.name : '',
        courseName: s.course ? s.course.name : '',
        classSize: 0,
        assignments: []
      })
    }
    sections.value = secs
    await Promise.all(sections.value.map((_, i) => loadSection(i)))
  } finally {
    loading.value = false
  }
}

async function loadSection(i) {
  const sec = sections.value[i]
  try {
    const data =
      sec.type === 'leader'
        ? await get('/api/classes/leader/assignments', { class_id: sec.classId }, { silent: true })
        : await get('/api/courses/assistant/assignments', { course_id: sec.courseId }, { silent: true })
    if (data) {
      sec.assignments = data.assignments || []
      sec.classSize = data.class_size || 0
      if (sec.type === 'assistant' && data.course_name) sec.courseName = data.course_name
    }
  } catch (e) {
    sec.assignments = []
  }
}

async function toggle(sec, a) {
  const key = sec.key + ':' + a.id
  if (expandedKey.value === key) {
    expandedKey.value = ''
    unsub.value = null
    return
  }
  expandedKey.value = key
  unsub.value = null
  loadingUnsub.value = true
  try {
    unsub.value =
      sec.type === 'leader'
        ? await get(`/api/classes/leader/assignment/${a.id}/unsubmitted`, { class_id: sec.classId })
        : await get(`/api/courses/assistant/assignment/${a.id}/unsubmitted`, { course_id: sec.courseId })
  } catch (e) {
    unsub.value = null
  } finally {
    loadingUnsub.value = false
  }
}

function posText(p) {
  return p === 'monitor' ? '班长' : p === 'commissary' ? '学委' : ''
}

// 对齐网页端进度条语义色
function rateColor(pct) {
  if (pct >= 90) return '#52c4a0'
  if (pct >= 50) return '#e6a23c'
  return '#f56c6c'
}

async function remind(sec, a) {
  const n = unsub.value ? unsub.value.unsubmitted_count : 0
  if (!n || reminding.value) return
  uni.showModal({
    title: '催交提醒',
    content: `将向 ${n} 位未交同学发送站内通知（1 小时内不重复发送）`,
    success: async (r) => {
      if (!r.confirm) return
      reminding.value = true
      try {
        const data =
          sec.type === 'leader'
            ? await post(`/api/classes/leader/assignment/${a.id}/remind`, { class_id: sec.classId })
            : await post(`/api/courses/assistant/assignment/${a.id}/remind`, { course_id: sec.courseId })
        uni.showToast({ title: `已提醒 ${data.reminded} 人`, icon: 'none' })
      } catch (e) {
        // 错误已提示
      } finally {
        reminding.value = false
      }
    }
  })
}
</script>

<style scoped>
.col-item {
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f5f2;
}
.col-item:last-child { border-bottom: none; }
.col-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
  flex-shrink: 0;
  margin-left: 16rpx;
}
.col-rate {
  font-size: 32rpx;
  font-weight: 700;
}
.col-prog {
  height: 12rpx;
  margin-top: 14rpx;
}
.col-expand {
  margin-top: 18rpx;
  background: #f7faf8;
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
}
.unsub-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.unsub-chip {
  background: #fef0f0;
  color: #c45656;
  border-radius: 999rpx;
  padding: 8rpx 24rpx;
  font-size: 24rpx;
}
.remind-btn {
  margin-top: 20rpx;
}
</style>
