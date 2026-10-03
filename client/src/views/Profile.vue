<template>
  <div class="page-container">
    <div class="page-title">个人中心</div>
    <div class="page-desc">{{ isStudent ? '账号信息、密码安全与你的学情画像' : '管理账号信息与密码安全' }}</div>

    <!-- 人物 Hero 卡：深色渐变底，无负边距层叠 -->
    <div class="hero card-section">
      <div class="hero-avatar">{{ authStore.realName.charAt(0) }}</div>
      <div class="hero-info">
        <div class="hero-name-row">
          <span class="hero-name">{{ authStore.realName }}</span>
          <span class="hero-role">{{ roleText }}</span>
        </div>
        <div class="hero-meta">
          {{ isStudent ? '学号' : '工号' }} {{ authStore.user?.username }}<span class="hero-sep">·</span>注册于 {{ joinDate }}
        </div>
      </div>
      <div v-if="isStudent && myStudy && myStudy.overall.course_count > 0" class="hero-risk" :class="`lv-${myStudy.overall.risk_level}`">
        <span class="dot"></span>{{ studyTagText }}
      </div>
    </div>

    <!-- 中部：基本信息 / 修改密码 双栏等宽 -->
    <el-row :gutter="20" style="margin-top:20px">
      <el-col :xs="24" :md="12">
        <div class="card-section full-h">
          <h3 style="margin-bottom:20px">基本信息</h3>
          <el-form :model="form" label-width="72px" class="narrow-form">
            <el-form-item label="姓名">
              <el-input v-model="form.real_name" />
            </el-form-item>
            <el-form-item label="邮箱">
              <el-input v-model="form.email" placeholder="选填，可用于找回账号" />
            </el-form-item>
            <el-form-item label="手机">
              <el-input v-model="form.phone" placeholder="选填，便于老师联系" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveProfile">保存修改</el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-col>
      <el-col :xs="24" :md="12">
        <div class="card-section full-h">
          <h3 style="margin-bottom:20px">修改密码</h3>
          <el-form :model="pwdForm" label-width="72px" class="narrow-form">
            <el-form-item label="原密码">
              <el-input v-model="pwdForm.old_password" type="password" show-password placeholder="当前登录密码" />
            </el-form-item>
            <el-form-item label="新密码">
              <el-input v-model="pwdForm.new_password" type="password" show-password placeholder="至少 6 位，建议字母 + 数字" />
            </el-form-item>
            <el-form-item>
              <el-button :loading="changingPwd" @click="changePwd">修改密码</el-button>
            </el-form-item>
          </el-form>
          <div class="pwd-tip">
            <el-icon><InfoFilled /></el-icon>
            修改成功后需使用新密码重新登录，其他设备的登录状态将自动失效。
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 我的学情（仅学生：提交行为 + 成绩 + 查重的个人画像） -->
    <div v-if="isStudent && myStudy && myStudy.overall.course_count > 0" class="card-section" style="margin-top:20px">
      <div class="study-header">
        <h3><el-icon><DataAnalysis /></el-icon>我的学情</h3>
        <span class="study-scope">{{ myStudy.overall.course_count }} 门课程 · {{ myStudy.overall.total }} 次作业</span>
      </div>

      <div class="study-grid">
        <div class="study-tile">
          <div class="study-tile-head">
            <span class="study-tile-label">作业提交率</span>
            <span class="study-tile-icon"><el-icon><UploadFilled /></el-icon></span>
          </div>
          <div class="study-tile-value">{{ myStudy.overall.submit_rate }}<span class="study-unit">%</span></div>
          <div class="study-tile-sub">{{ myStudy.overall.submitted }}/{{ myStudy.overall.total }} 次已提交</div>
          <div class="study-tile-foot">
            <el-progress :percentage="myStudy.overall.submit_rate" :color="rateColor(myStudy.overall.submit_rate)"
              :stroke-width="6" :show-text="false" />
          </div>
        </div>

        <div class="study-tile">
          <div class="study-tile-head">
            <span class="study-tile-label">平均分</span>
            <span class="study-tile-icon"><el-icon><TrendCharts /></el-icon></span>
          </div>
          <div class="study-tile-value">{{ myStudy.overall.avg_score != null ? myStudy.overall.avg_score : '—' }}</div>
          <div class="study-tile-sub">百分制</div>
          <div class="study-tile-foot">
            <SparkLine v-if="myStudy.overall.score_trend.length >= 2"
              :values="myStudy.overall.score_trend.map(p => p.v)" :width="132" />
            <span v-else class="study-hint">{{ myStudy.overall.avg_score != null ? '成绩样本不足，暂无走势' : '暂无已批改成绩' }}</span>
          </div>
        </div>

        <div class="study-tile">
          <div class="study-tile-head">
            <span class="study-tile-label">逾期未交</span>
            <span class="study-tile-icon" :class="{ 'is-danger': myStudy.overall.missing_overdue.length > 0 }">
              <el-icon><AlarmClock /></el-icon>
            </span>
          </div>
          <div class="study-tile-value" :class="{ 'is-danger': myStudy.overall.missing_overdue.length > 0 }">
            {{ myStudy.overall.missing_overdue.length }}
          </div>
          <div class="study-tile-sub">
            <template v-if="myStudy.overall.missing_overdue.length > 0">
              {{ truncate(myStudy.overall.missing_overdue[0], 10) }}{{ myStudy.overall.missing_overdue.length > 1 ? ' 等' : '' }}
            </template>
            <template v-else>按时完成</template>
          </div>
          <div class="study-tile-foot">
            <span class="study-hint" :class="{ 'is-danger': myStudy.overall.missing_overdue.length > 0 }">
              {{ myStudy.overall.missing_overdue.length > 0 ? '已过截止时间' : '无逾期记录' }}
            </span>
          </div>
        </div>

        <div class="study-tile">
          <div class="study-tile-head">
            <span class="study-tile-label">查重相似度</span>
            <span class="study-tile-icon" :class="{ 'is-danger': plagHot }"><el-icon><CopyDocument /></el-icon></span>
          </div>
          <div class="study-tile-value" :class="{ 'is-danger': plagHot }">
            {{ myStudy.overall.plagiarism_max != null ? `${myStudy.overall.plagiarism_max}%` : '—' }}
          </div>
          <div class="study-tile-sub">历史最高</div>
          <div class="study-tile-foot">
            <span class="study-hint" :class="{ 'is-danger': plagHot }">
              {{ myStudy.overall.plagiarism_max == null ? '暂无查重记录' : (myStudy.overall.plagiarism_flagged ? '存在可疑标记' : '处于正常范围') }}
            </span>
          </div>
        </div>
      </div>

      <!-- 风险提示条 -->
      <div v-if="myStudy.overall.risk_reasons.length > 0" class="risk-banner">
        <el-icon class="risk-icon"><WarningFilled /></el-icon>
        <div>
          <div class="risk-title">学习预警</div>
          <div class="risk-text">{{ myStudy.overall.risk_reasons.join('；') }}。请尽快补交缺漏作业并复盘扣分点，有困难可与老师沟通。</div>
        </div>
      </div>

      <!-- 分课程明细 -->
      <el-table v-if="myStudy.courses.length > 1" :data="myStudy.courses" size="small" class="study-table">
        <el-table-column label="课程" prop="name" min-width="140" />
        <el-table-column label="提交情况" width="150">
          <template #default="{ row }">{{ row.submitted }}/{{ row.total }}（{{ row.submit_rate }}%）</template>
        </el-table-column>
        <el-table-column label="平均分" width="90">
          <template #default="{ row }">
            <span v-if="row.avg_score != null" :style="{ color: scoreColor(row.avg_score) }">{{ row.avg_score }}</span>
            <span v-else class="study-hint">—</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  DataAnalysis, TrendCharts, AlarmClock, CopyDocument, WarningFilled, UploadFilled, InfoFilled
} from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { authApi, analyticsApi } from '@/api'
import { rateColor } from '@/utils/format'
import SparkLine from '@/components/SparkLine.vue'
import { ROLE, statusOf } from '@/utils/statusMaps'

const authStore = useAuthStore()

const form = reactive({ real_name: '', email: '', phone: '' })
const pwdForm = reactive({ old_password: '', new_password: '' })
const saving = ref(false)
const changingPwd = ref(false)

const roleText = computed(() => statusOf(ROLE, authStore.role).text)
const joinDate = computed(() => {
  const d = new Date(authStore.user?.created_at)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN')
})

// ===== 我的学情（仅学生；教师/管理员个人中心不展示） =====
const isStudent = computed(() => authStore.role === 'student')
const myStudy = ref(null)
const studyTagText = computed(() =>
  ({ high: '学习风险较高', medium: '需关注', low: '状态良好' }[myStudy.value?.overall?.risk_level] || '学情'))
const plagHot = computed(() =>
  myStudy.value?.overall?.plagiarism_flagged || (myStudy.value?.overall?.plagiarism_max ?? 0) >= 60)

function scoreColor(v) {
  if (v < 60) return 'var(--color-danger)'
  if (v < 70) return 'var(--color-warning)'
  return 'var(--ink-800)'
}
function truncate(s, n) {
  return String(s).length > n ? `${String(s).slice(0, n)}…` : String(s)
}

onMounted(async () => {
  const u = authStore.user
  if (u) {
    form.real_name = u.real_name
    form.email = u.email || ''
    form.phone = u.phone || ''
  }
  // 学情卡片加载失败不阻塞个人中心，静默降级
  if (isStudent.value) {
    try {
      const res = await analyticsApi.myProfile()
      myStudy.value = res.data
    } catch (e) {}
  }
})

async function saveProfile() {
  saving.value = true
  try {
    await authApi.updateProfile(form)
    await authStore.fetchProfile()
    ElMessage.success('保存成功')
  } catch (e) {} finally { saving.value = false }
}

async function changePwd() {
  if (!pwdForm.old_password || !pwdForm.new_password) {
    ElMessage.warning('请填写完整'); return
  }
  changingPwd.value = true
  try {
    await authApi.changePassword(pwdForm)
    ElMessage.success('密码修改成功')
    pwdForm.old_password = ''
    pwdForm.new_password = ''
  } catch (e) {} finally { changingPwd.value = false }
}
</script>

<style scoped>
.full-h { height: 100%; box-sizing: border-box; }

/* ===== 人物 Hero 卡 ===== */
.hero {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 24px; flex-wrap: wrap;
  background: linear-gradient(120deg, var(--brand-700), var(--brand-900));
  color: #fff; padding: 26px 32px;
}
/* 装饰圆（纯背景，pointer-events 不可点也不遮内容） */
.hero::before {
  content: ''; position: absolute; width: 260px; height: 260px; border-radius: 50%;
  right: -70px; top: -120px; background: rgba(255, 255, 255, 0.06); pointer-events: none;
}
.hero::after {
  content: ''; position: absolute; width: 160px; height: 160px; border-radius: 50%;
  right: 130px; bottom: -90px; background: rgba(255, 255, 255, 0.05); pointer-events: none;
}
.hero-avatar {
  width: 84px; height: 84px; border-radius: 50%; flex-shrink: 0;
  background: rgba(255, 255, 255, 0.14); border: 3px solid rgba(255, 255, 255, 0.55);
  display: flex; align-items: center; justify-content: center;
  font-size: 34px; font-weight: 600; letter-spacing: 0.02em; user-select: none;
  position: relative;
}
.hero-info { min-width: 0; position: relative; }
.hero-name-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.hero-name { font-size: 22px; font-weight: 700; line-height: 1.3; }
.hero-role {
  font-size: 12px; font-weight: 500; padding: 2px 10px; border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.16); border: 1px solid rgba(255, 255, 255, 0.28);
}
.hero-meta { font-size: 13px; opacity: 0.78; margin-top: 6px; }
.hero-sep { margin: 0 8px; opacity: 0.6; }

/* 学情风险徽章（Hero 右侧） */
.hero-risk {
  position: relative; margin-left: auto;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 16px; border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.22);
  font-size: 13px; font-weight: 500; white-space: nowrap;
}
.hero-risk .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-info); }
.hero-risk.lv-high .dot { background: #ff9d96; box-shadow: 0 0 0 4px rgba(255, 157, 150, 0.25); }
.hero-risk.lv-medium .dot { background: #ffd27a; box-shadow: 0 0 0 4px rgba(255, 210, 122, 0.25); }
.hero-risk.lv-low .dot { background: #8ce8c5; box-shadow: 0 0 0 4px rgba(140, 232, 197, 0.25); }

/* ===== 表单卡 ===== */
.narrow-form :deep(.el-input) { max-width: 420px; }
.pwd-tip {
  display: flex; gap: 6px; align-items: flex-start;
  font-size: 12px; color: var(--ink-500); line-height: 1.6;
  border-top: 1px dashed var(--ink-200); padding-top: 12px; margin-top: 4px;
  max-width: 420px;
}
.pwd-tip .el-icon { margin-top: 1px; flex-shrink: 0; }

/* ===== 我的学情 ===== */
.study-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 16px; gap: 12px; flex-wrap: wrap;
}
.study-scope { font-size: 12px; color: var(--ink-500); }

.study-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px;
}
.study-tile {
  display: flex; flex-direction: column;
  border: 1px solid var(--ink-100); border-radius: var(--radius-lg);
  padding: 14px 16px;
  background: var(--bg-card, #fff);
}
.study-tile-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 8px; min-height: 30px;
}
.study-tile-label { font-size: 13px; color: var(--ink-600); }
.study-tile-icon {
  width: 30px; height: 30px; border-radius: 9px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--brand-50); color: var(--brand-600); font-size: 15px;
}
.study-tile-icon.is-danger { background: #fef0f0; color: var(--color-danger); }
.study-tile-value {
  font-size: 28px; font-weight: 700; color: var(--ink-800);
  font-variant-numeric: tabular-nums; line-height: 1.2;
}
.study-tile-value.is-danger { color: var(--color-danger); }
.study-unit { font-size: 14px; font-weight: 600; color: var(--ink-500); margin-left: 1px; }
.study-tile-sub { font-size: 12px; color: var(--ink-500); margin-top: 2px; }
.study-tile-foot { margin-top: auto; padding-top: 10px; min-height: 28px; }
.study-hint { font-size: 12px; color: var(--ink-500); }
.study-hint.is-danger { color: var(--color-danger); }

/* 风险提示条 */
.risk-banner {
  display: flex; gap: 10px; align-items: flex-start;
  margin-top: 16px; padding: 12px 14px;
  background: rgba(230, 162, 60, 0.09);
  border: 1px solid rgba(230, 162, 60, 0.35);
  border-radius: var(--radius-md);
}
.risk-icon { color: var(--color-warning); font-size: 17px; margin-top: 1px; flex-shrink: 0; }
.risk-title { font-size: 13px; font-weight: 600; color: var(--color-warning); margin-bottom: 2px; }
.risk-text { font-size: 13px; color: var(--ink-700); line-height: 1.6; }

.study-table { margin-top: 16px; }

@media (max-width: 768px) {
  .hero { padding: 20px; gap: 16px; }
  .hero-risk { margin-left: 0; }
}
</style>
