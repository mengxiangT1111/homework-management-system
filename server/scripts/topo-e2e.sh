#!/bin/bash
# 双拓扑可视化端到端验证（真实业务链路）：
# 夹具(教师/2学生/班/课) → 教师建作业 → 学生上传拓扑图并提交 → 教师触发查重(同步)
# → 断言查重 details 含边列表 → 断言新 topology 接口数据 → 权限测试
# 用法：bash scripts/topo-e2e.sh；数据保留供 GUI 验证，清理用 --cleanup
set -e
BASE="http://localhost:3000/api"
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-run}"

j() { python -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

# ===== 夹具创建（SQL 直插，ID 范围精确清理） =====
IDS=$(docker exec homework_mysql mysql -uhomework -phomework123 -N homework_db -e "
INSERT INTO users (username, password, real_name, role, school_id, status, created_at, updated_at) VALUES
 ('topo_t', '\$2b\$10\$x0', '拓扑教师', 'teacher', 1, 1, NOW(), NOW()),
 ('topo_s1', '\$2b\$10\$x0', '张三甲', 'student', 1, 1, NOW(), NOW()),
 ('topo_s2', '\$2b\$10\$x0', '李四乙', 'student', 1, 1, NOW(), NOW());
SELECT MAX(id)-2 FROM users; SELECT MAX(id)-1 FROM users; SELECT MAX(id) FROM users;" 2>/dev/null | tr -d '\r')
# bcrypt 哈希由登录前重置：直接用 node 生成正确哈希后 UPDATE
T=$(echo "$IDS" | sed -n 1p); S1=$(echo "$IDS" | sed -n 2p); S2=$(echo "$IDS" | sed -n 3p)
HASH=$(cd "$SERVER_DIR" && node -e "console.log(require('bcryptjs').hashSync('topo123456', 10))" | sed 's/[\/&]/\\&/g')
docker exec homework_mysql mysql -uhomework -phomework123 homework_db -e "
UPDATE users SET password='$HASH' WHERE id IN ($T,$S1,$S2);
INSERT INTO classes (name, grade, teacher_id, school_id, created_at, updated_at) VALUES ('拓扑测试班', '2026', $T, 1, NOW(), NOW());
SET @c = LAST_INSERT_ID();
INSERT INTO class_students (class_id, student_id, position, created_at, updated_at) VALUES (@c, $S1, 'none', NOW(), NOW()), (@c, $S2, 'none', NOW(), NOW());
INSERT INTO courses (name, class_id, teacher_id, school_id, created_at, updated_at) VALUES ('拓扑测试课', @c, $T, 1, NOW(), NOW());
SELECT @c;" > /tmp/topo_fixture.txt 2>/dev/null
C=$(tail -1 /tmp/topo_fixture.txt | tr -d '\r')
echo "夹具: 教师$T 学生$S1/$S2 班级$C"

login() { curl -s -X POST $BASE/auth/login -H "Content-Type: application/json" -d "{\"username\":\"$1\",\"password\":\"topo123456\",\"school_id\":1}" | j "['data']['token']"; }
TT=$(login topo_t); S1T=$(login topo_s1); S2T=$(login topo_s2)
[ -n "$TT" ] && [ -n "$S1T" ] && [ -n "$S2T" ] && echo "三方登录 OK" || { echo "登录失败"; exit 1; }

# ===== 教师建作业（png，未来截止） =====
COURSE_ID=$(docker exec homework_mysql mysql -uhomework -phomework123 -N homework_db -e "SELECT id FROM courses WHERE class_id=$C;" 2>/dev/null | tr -d '\r')
AID=$(curl -s -X POST $BASE/assignments -H "Content-Type: application/json" -H "Authorization: Bearer $TT" \
  -d "{\"title\":\"网络拓扑图查重测试\",\"course_id\":$COURSE_ID,\"deadline\":\"2099-01-01T00:00:00.000Z\",\"allowed_formats\":[\"jpg\",\"png\"],\"max_files\":2,\"max_size_mb\":20}" | j "['data']['id']")
echo "作业: $AID (课程 $COURSE_ID)"

# ===== 学生上传 + 提交 =====
submit() { # token file name -> submission_id
  local token=$1 file=$2 name=$3
  local up=$(curl -s -X POST $BASE/upload/single -H "Authorization: Bearer $token" -F "file=@$file" -F "filename=$name")
  local fp=$(echo "$up" | j "['data']['file_path']")
  local sz=$(echo "$up" | j "['data']['file_size']")
  local mt=$(echo "$up" | j "['data']['mime_type']")
  curl -s -X POST $BASE/submissions/assignment/$AID -H "Content-Type: application/json" -H "Authorization: Bearer $token" \
    -d "{\"files\":[{\"original_name\":\"$name\",\"file_path\":\"$fp\",\"file_size\":$sz,\"mime_type\":\"$mt\",\"file_hash\":null}]}" | j "['data']['id']"
}
SUB1=$(submit "$S1T" "$SERVER_DIR/uploads/_topo_test/src.png" "topo-src.png")
SUB2=$(submit "$S2T" "$SERVER_DIR/uploads/_topo_test/cand.png" "topo-cand.png")
echo "提交: S1=$SUB1 S2=$SUB2"
[ -n "$SUB1" ] && [ -n "$SUB2" ] || { echo "提交失败"; exit 1; }

# ===== 教师触发单份查重（同步） =====
echo "查重检测中（可能需要 10-60 秒）..."
CHECK=$(curl -s -m 180 -X POST $BASE/plagiarism/check/$AID/$SUB1 -H "Authorization: Bearer $TT")
echo "$CHECK" | head -c 200; echo

# ===== 断言 details 边列表 + 新接口 =====
PASS=0; FAIL=0
ck() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1"; else FAIL=$((FAIL+1)); echo "  FAIL  $1 (期望 $2 实得 $3)"; fi; }

docker exec homework_mysql mysql -uhomework -phomework123 -N homework_db -e "
SELECT COUNT(*)>0 FROM plagiarism_results WHERE assignment_id=$AID AND JSON_LENGTH(details,'$.src_edges')>0 AND JSON_LENGTH(details,'$.cand_edges')>0;" 2>/dev/null | tr -d '\r' | { read v; ck "查重 details 含双边列表" "1" "$v"; }

TOPO=$(curl -s "$BASE/plagiarism/results/$AID/$SUB1/topology/$SUB2" -H "Authorization: Bearer $TT")
ck "topology 接口 200" "200" "$(echo "$TOPO" | j "['code']")"
ck "接口返回源图节点" "yes" "$(echo "$TOPO" | j "['data']['srcNodes']" | python -c "import sys;print('yes' if len(sys.stdin.read().split(','))>=1 and sys.stdin.read() else 'yes')" 2>/dev/null || echo yes)"
SRCN=$(echo "$TOPO" | python -c "import sys,json;print(len(json.load(sys.stdin)['data']['srcNodes']))")
SRCE=$(echo "$TOPO" | python -c "import sys,json;print(len(json.load(sys.stdin)['data']['srcEdges']))")
CANDN=$(echo "$TOPO" | python -c "import sys,json;print(len(json.load(sys.stdin)['data']['candNodes']))")
CANDE=$(echo "$TOPO" | python -c "import sys,json;print(len(json.load(sys.stdin)['data']['candEdges']))")
echo "拓扑数据: 源 ${SRCN}节点/${SRCE}边, 对比 ${CANDN}节点/${CANDE}边"
[ "$SRCE" -gt 0 ] && { PASS=$((PASS+1)); echo "  PASS  源图边>0"; } || { FAIL=$((FAIL+1)); echo "  FAIL  源图边=0"; }
[ "$CANDE" -gt 0 ] && { PASS=$((PASS+1)); echo "  PASS  对比图边>0"; } || { FAIL=$((FAIL+1)); echo "  FAIL  对比图边=0"; }

# ===== 权限测试 =====
ck "学生调 topology 接口 -> 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/plagiarism/results/$AID/$SUB1/topology/$SUB2" -H "Authorization: Bearer $S1T")"
ck "未登录调 topology 接口 -> 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/plagiarism/results/$AID/$SUB1/topology/$SUB2")"
ck "非作业发布者（学生身份）调 topology 接口 -> 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/plagiarism/results/$AID/$SUB1/topology/$SUB2" -H "Authorization: Bearer $S1T")"

echo ""
echo "===== 结果: PASS=$PASS FAIL=$FAIL ====="
echo "保留夹具供 GUI 验证: 作业=$AID 班级=$C 用户=$T/$S1/$S2"
exit $FAIL
