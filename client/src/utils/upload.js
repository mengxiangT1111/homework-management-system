import SparkMD5 from 'spark-md5'
import { uploadApi } from '@/api'
import { ElMessage } from 'element-plus'

// 默认分片大小 2MB
const CHUNK_SIZE = 2 * 1024 * 1024

/**
 * 计算文件 MD5
 */
function calcFileHash(file) {
  return new Promise((resolve, reject) => {
    const blobSlice = File.prototype.slice || File.prototype.mozSlice || File.prototype.webkitSlice
    const chunks = Math.ceil(file.size / CHUNK_SIZE)
    const spark = new SparkMD5.ArrayBuffer()
    const reader = new FileReader()
    let current = 0

    reader.onload = (e) => {
      spark.append(e.target.result)
      current++
      if (current < chunks) {
        loadNext()
      } else {
        resolve({ hash: spark.end(), chunks })
      }
    }
    reader.onerror = (e) => reject(e)

    function loadNext() {
      const start = current * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      reader.readAsArrayBuffer(blobSlice.call(file, start, end))
    }
    loadNext()
  })
}

/**
 * 分片上传（支持秒传 + 断点续传）
 * @param {File} file 文件对象
 * @param {(percent:number)=>void} onProgress 进度回调
 * @returns {Promise<Object>} 上传结果 {original_name, file_path, file_size, mime_type, file_hash}
 */
export async function uploadFileChunked(file, onProgress) {
  // 1. 计算hash
  const { hash, chunks } = await calcFileHash(file)

  // 2. 检查已上传分片
  const checkRes = await uploadApi.check(hash)
  const uploadedSet = new Set(checkRes.data.uploaded_chunks)

  // 3. 逐片上传（跳过已传）
  let uploadedCount = uploadedSet.size
  for (let i = 0; i < chunks; i++) {
    if (uploadedSet.has(i)) continue
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const chunk = file.slice(start, end)

    const formData = new FormData()
    formData.append('chunk', chunk)

    await uploadApi.uploadChunk(formData, hash, i)
    uploadedCount++
    if (onProgress) {
      // 上传进度占整体 90%（剩 10% 给合并）
      onProgress(Math.round((uploadedCount / chunks) * 90))
    }
  }

  if (onProgress) onProgress(95)

  // 4. 合并
  const mergeRes = await uploadApi.merge({
    hash,
    filename: file.name,
    total: chunks,
    mime_type: file.type,
    size: file.size
  })

  if (onProgress) onProgress(100)
  return mergeRes.data
}

/**
 * 批量上传多个文件
 */
export async function uploadMultipleFiles(files, onProgress) {
  const results = []
  for (let i = 0; i < files.length; i++) {
    const fileResult = await uploadFileChunked(files[i], (percent) => {
      if (onProgress) {
        // 每个文件的整体进度
        const overall = Math.round(((i + percent / 100) / files.length) * 100)
        onProgress(overall)
      }
    })
    results.push(fileResult)
  }
  return results
}
