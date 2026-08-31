import { post } from './request'
import { BASE_URL } from './config'

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
// uni.openDocument 支持且需显式传 fileType 的格式
const DOC_TYPES = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'docx',
  xls: 'xls',
  xlsx: 'xlsx',
  ppt: 'ppt',
  pptx: 'pptx'
}

export function getExt(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

/**
 * 通过 /api/files/urls 解析文件访问 URL：
 * - COS 文件 → 签名 URL（1 小时时效），必须即用即取，禁止缓存
 * - 本地文件 → 相对路径 /api/files/download?...，必须拼 BASE_URL
 */
async function resolveUrl(filePath) {
  const map = await post('/api/files/urls', { paths: [filePath] })
  const url = map && map[filePath]
  if (!url) return null
  return url.startsWith('/') ? BASE_URL + url : url
}

/**
 * 统一文件预览：
 * 图片 → previewImage；pdf/word/excel/ppt → downloadFile + openDocument；
 * zip 等其他格式 → 提示网页端查看。下载失败自动重取一次签名 URL。
 */
export async function previewFile(filePath, displayName) {
  if (!filePath) return
  const name = displayName || filePath
  const ext = getExt(name) || getExt(filePath)
  try {
    if (!ext) {
      return uni.showToast({ title: '无法识别文件格式', icon: 'none' })
    }
    const url = await resolveUrl(filePath)
    if (!url) {
      return uni.showToast({ title: '无法获取文件或无权访问', icon: 'none' })
    }

    if (IMAGE_EXTS.includes(ext)) {
      return uni.previewImage({ urls: [url] })
    }
    if (!DOC_TYPES[ext]) {
      return uni.showToast({ title: '该格式请在网页端查看', icon: 'none' })
    }

    const openDoc = (tempPath) =>
      uni.openDocument({
        filePath: tempPath,
        fileType: DOC_TYPES[ext],
        showMenu: true,
        fail: () => uni.showToast({ title: '该格式暂不支持预览', icon: 'none' })
      })

    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200) {
          return uni.showToast({ title: '下载失败，请稍后重试', icon: 'none' })
        }
        openDoc(res.tempFilePath)
      },
      fail: async () => {
        // 签名 URL 失效兜底：重取一次再试
        try {
          const retry = await resolveUrl(filePath)
          if (!retry) throw new Error('no url')
          uni.downloadFile({
            url: retry,
            success: (res2) => {
              if (res2.statusCode !== 200) {
                return uni.showToast({ title: '下载失败，请稍后重试', icon: 'none' })
              }
              openDoc(res2.tempFilePath)
            },
            fail: () => uni.showToast({ title: '预览失败，请稍后重试', icon: 'none' })
          })
        } catch (e) {
          uni.showToast({ title: '预览失败，请稍后重试', icon: 'none' })
        }
      }
    })
  } catch (e) {
    uni.showToast({ title: (e && e.message) || '预览失败', icon: 'none' })
  }
}
