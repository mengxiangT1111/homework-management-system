// 校验数据库表结构与 Sequelize 模型定义是否一致（只比列的存在性，不比类型细节）
// 本地：  cd server && node scripts/check-schema.js
// 服务器：sudo docker compose -f docker-compose.prod.yml exec backend node scripts/check-schema.js
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
const { sequelize } = require('../src/app')

async function main() {
  await sequelize.authenticate()
  console.log('✓ 数据库连接成功，开始比对模型与表结构...\n')

  const models = sequelize.modelManager.models
  let missingTables = 0
  let missingCols = 0

  for (const model of models) {
    const table = model.getTableName()
    const name = typeof table === 'string' ? table : table.tableName

    let actualCols
    try {
      actualCols = await sequelize.getQueryInterface().describeTable(table)
    } catch (e) {
      console.log(`❌ 表缺失：${name}（重启 backend 容器时 sync 会自动创建）`)
      missingTables++
      continue
    }

    const expected = model.rawAttributes
    for (const col of Object.keys(expected)) {
      if (!actualCols[col]) {
        console.log(`❌ 字段缺失：${name}.${col}（模型有、库里没有，需手动 ALTER TABLE 补齐）`)
        missingCols++
      }
    }
    for (const col of Object.keys(actualCols)) {
      if (!expected[col]) {
        console.log(`⚠️  多余字段：${name}.${col}（库里多余、代码未使用，一般无害）`)
      }
    }
  }

  console.log('')
  if (missingTables === 0 && missingCols === 0) {
    console.log(`✅ 已检查 ${models.length} 个模型，表结构与模型定义一致`)
    process.exit(0)
  }
  console.log(`总结（共 ${models.length} 个模型）：缺 ${missingTables} 张表、缺 ${missingCols} 个字段`)
  process.exit(1)
}

main().catch(err => {
  console.error('检查失败：', err.message)
  process.exit(1)
})
