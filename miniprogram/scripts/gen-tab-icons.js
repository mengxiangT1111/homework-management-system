// 程序化绘制 tabBar 图标（无第三方依赖，zlib 为 Node 内置）
// 输出：src/static/tab/{home,task,bell,me}.png 各两态（灰 / 品牌绿）
// 96x96 RGBA，3x3 超采样抗锯齿
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const SIZE = 96
const GRAY = [154, 166, 160, 255]
const ACTIVE = [82, 196, 160, 255]

function crc32(buf) {
  if (!crc32.table) {
    crc32.table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crc32.table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = crc32.table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function savePng(file, rgba) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0))
    ])
  )
}

// ===== 形状谓词 =====
const inCircle = (cx, cy, r) => (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r
const inRect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1
const inRoundRect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const dx = Math.max(x0 + r - x, x - (x1 - r), 0)
  const dy = Math.max(y0 + r - y, y - (y1 - r), 0)
  return dx * dx + dy * dy <= r * r
}
const inTriangle = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const s = (ax - cx) * (y - cy) - (ay - cy) * (x - cx)
  const t = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
  const u = (cx - bx) * (y - by) - (cy - by) * (x - bx)
  return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0)
}
const union = (...fns) => (x, y) => fns.some((f) => f(x, y))

// ===== 四个图标的形状层（后层覆盖前层，cut 打孔）=====
const ICONS = {
  // 首页：屋顶 + 房身 + 门洞
  home: [
    { inside: inTriangle(48, 10, 6, 46, 90, 46) },
    { inside: inRoundRect(18, 42, 78, 88, 8) },
    { inside: inRoundRect(40, 60, 56, 88, 4), cut: true }
  ],
  // 作业：纸张 + 三条打孔横线
  task: [
    { inside: inRoundRect(20, 8, 76, 88, 10) },
    { inside: inRoundRect(30, 26, 66, 33, 3.5), cut: true },
    { inside: inRoundRect(30, 43, 66, 50, 3.5), cut: true },
    { inside: inRoundRect(30, 60, 54, 67, 3.5), cut: true }
  ],
  // 消息：铃身 + 提梁 + 下摆 + 铃锤
  bell: [
    { inside: union(inCircle(48, 42, 25), inRect(23, 42, 73, 58)) },
    { inside: inCircle(48, 13, 5) },
    { inside: inRoundRect(17, 58, 79, 69, 5.5) },
    { inside: inCircle(48, 78, 7) }
  ],
  // 我的：头 + 半身
  me: [{ inside: union(inCircle(48, 29, 16), inCircle(48, 86, 30)) }]
}

function render(shapes, color) {
  const buf = Buffer.alloc(SIZE * SIZE * 4)
  for (let py = 0; py < SIZE; py++) {
    for (let pxi = 0; pxi < SIZE; pxi++) {
      let final = null // 最后命中的形状层
      for (let l = 0; l < shapes.length; l++) {
        const s = shapes[l]
        let cov = 0
        for (let k = 0; k < 9; k++) {
          const sx = pxi + 0.17 + (k % 3) * 0.33
          const sy = py + 0.17 + Math.floor(k / 3) * 0.33
          cov += s.inside(sx, sy) ? 1 : 0
        }
        if (cov > 0) final = { cut: s.cut, cov }
      }
      const i = (py * SIZE + pxi) * 4
      if (final && !final.cut) {
        const a = Math.round((final.cov / 9) * 255)
        buf[i] = color[0]
        buf[i + 1] = color[1]
        buf[i + 2] = color[2]
        buf[i + 3] = a
      }
    }
  }
  return buf
}

const outDir = path.join(__dirname, '../src/static/tab')
fs.mkdirSync(outDir, { recursive: true })
for (const [name, shapes] of Object.entries(ICONS)) {
  savePng(path.join(outDir, `${name}.png`), render(shapes, GRAY))
  savePng(path.join(outDir, `${name}-active.png`), render(shapes, ACTIVE))
  console.log('generated', name)
}
console.log('done ->', outDir)
