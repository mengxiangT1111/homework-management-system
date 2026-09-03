<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑待办' : '发布待办'"
    width="560px"
    @closed="resetForm"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item v-if="!isEdit && !fixedClassId" label="目标班级" prop="class_id">
        <el-select v-model="form.class_id" placeholder="选择班级" style="width:100%">
          <el-option v-for="c in classes" :key="c.id" :label="`${c.name}（${c.grade}）`" :value="c.id" />
        </el-select>
      </el-form-item>
      <el-form-item v-else-if="!isEdit" label="目标班级">
        <el-input :model-value="fixedClassName" disabled />
      </el-form-item>

      <el-form-item label="待办标题" prop="title">
        <el-input v-model="form.title" maxlength="100" show-word-limit placeholder="如：周五前交实验报告" />
      </el-form-item>

      <el-form-item label="截止时间">
        <el-date-picker
          v-model="form.due_date"
          type="datetime"
          value-format="YYYY-MM-DD HH:mm:ss"
          format="YYYY-MM-DD HH:mm"
          placeholder="可选，不填则无截止"
          style="width:100%"
        />
      </el-form-item>

      <el-form-item label="详细说明">
        <el-input
          v-model="form.content"
          type="textarea" :rows="4" maxlength="2000" show-word-limit
          placeholder="补充说明任务内容、要求等（可选）"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">{{ isEdit ? '保存' : '发布' }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { todoApi } from '@/api'
import { toPickerValue, localToISO } from '@/utils/format'

const props = defineProps({
  modelValue: Boolean,
  // 编辑时传入待办对象；null = 发布
  todo: { type: Object, default: null },
  // 可选班级列表（发布时选择）
  classes: { type: Array, default: () => [] },
  // 学委固定本班发布时传入，隐藏班级选择
  fixedClassId: { type: Number, default: null },
  fixedClassName: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

const isEdit = computed(() => !!props.todo)

const formRef = ref(null)
const saving = ref(false)
const form = ref({ class_id: null, title: '', due_date: '', content: '' })

const rules = {
  title: [
    { required: true, message: '请输入待办标题', trigger: 'blur' },
    { max: 100, message: '标题不能超过 100 字', trigger: 'blur' }
  ],
  class_id: [{ required: true, message: '请选择班级', trigger: 'change' }]
}

watch(() => props.modelValue, (v) => {
  if (!v) return
  if (props.todo) {
    form.value = {
      class_id: props.todo.class_id,
      title: props.todo.title,
      due_date: toPickerValue(props.todo.due_date),
      content: props.todo.content || ''
    }
  } else {
    form.value = { class_id: props.fixedClassId, title: '', due_date: '', content: '' }
  }
})

function resetForm() {
  formRef.value?.resetFields?.()
}

async function handleSave() {
  try { await formRef.value.validate() } catch (e) { return }
  saving.value = true
  try {
    if (isEdit.value) {
      await todoApi.update(props.todo.id, {
        title: form.value.title,
        content: form.value.content,
        due_date: form.value.due_date ? localToISO(form.value.due_date) : null
      })
      ElMessage.success('待办已更新')
    } else {
      await todoApi.create({
        class_id: form.value.class_id,
        title: form.value.title,
        content: form.value.content,
        due_date: form.value.due_date ? localToISO(form.value.due_date) : null
      })
      ElMessage.success('待办发布成功，已通知本班同学')
    }
    visible.value = false
    emit('saved')
  } finally {
    saving.value = false
  }
}
</script>
