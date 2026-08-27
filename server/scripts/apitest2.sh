#!/bin/bash
# 第二轮：越权负向用例 + COS 链路验证（前置：apitest.sh 已跑过一轮的干净库不适用，
# 本脚本自建全部数据；需 server 运行于 :3000）
B=http://localhost:3000/api
PASS=0; FAIL=0
chk() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1";
  else FAIL=$((FAIL+1)); echo "FAIL: $1 (expect=$2 got=$3)"; fi
}
jget() { python -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }

ADMIN_TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | jget "['data']['token']")
SCHOOL_ID=$(curl -s -X POST $B/schools -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"name":"越权测试大学","code":"SEC"}' | jget "['data']['id']")

# 用户：教师T、班级内学生A、班级外学生B
curl -s -X POST $B/users/teacher -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"username\":\"sec_t\",\"password\":\"teacher123\",\"real_name\":\"安全教师\",\"school_id\":$SCHOOL_ID}" >/dev/null
curl -s -X POST $B/users/student -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"username\":\"sec_a\",\"password\":\"student123\",\"real_name\":\"班内学生\",\"school_id\":$SCHOOL_ID}" >/dev/null
curl -s -X POST $B/users/student -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"username\":\"sec_b\",\"password\":\"student123\",\"real_name\":\"班外学生\",\"school_id\":$SCHOOL_ID}" >/dev/null
T=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"sec_t\",\"password\":\"teacher123\",\"school_id\":$SCHOOL_ID}" | jget "['data']['token']")
A=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"sec_a\",\"password\":\"student123\",\"school_id\":$SCHOOL_ID}" | jget "['data']['token']")
BT=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"sec_b\",\"password\":\"student123\",\"school_id\":$SCHOOL_ID}" | jget "['data']['token']")

CLS=$(curl -s -X POST $B/classes -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"安全班\",\"grade\":\"2024级\",\"school_id\":$SCHOOL_ID}" | jget "['data']['id']")
curl -s -X POST $B/classes/$CLS/join -H "Authorization: Bearer $A" >/dev/null
CRS=$(curl -s -X POST $B/courses -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "{\"name\":\"安全课\",\"class_id\":$CLS}" | jget "['data']['id']")
DL=$(python -c "import datetime;print((datetime.datetime.now()+datetime.timedelta(days=3)).isoformat())")
ASG=$(curl -s -X POST $B/assignments -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "{\"title\":\"安全作业\",\"course_id\":$CRS,\"deadline\":\"$DL\",\"allowed_formats\":[\"txt\"],\"max_files\":1,\"max_size_mb\":5}" | jget "['data']['id']")

# === S3：班外学生查看作业详情应 403 ===
R=$(curl -s -o /dev/null -w '%{http_code}' $B/assignments/$ASG -H "Authorization: Bearer $BT")
chk "S3_outsider_assignment_403" "403" "$R"
R=$(curl -s -o /dev/null -w '%{http_code}' $B/assignments/$ASG -H "Authorization: Bearer $A")
chk "S3_inclass_assignment_200" "200" "$R"
# 学生视角教师 email 应被剥离
HAS_EMAIL=$(curl -s $B/assignments/$ASG -H "Authorization: Bearer $A" | python -c "import sys,json;d=json.load(sys.stdin)['data'];print('yes' if 'email' in (d.get('teacher') or {}) else 'no')")
chk "S3_teacher_email_stripped" "no" "$HAS_EMAIL"

# === S4：班外学生看班级学生名单应 404；班内学生看不到手机号邮箱 ===
R=$(curl -s -o /dev/null -w '%{http_code}' $B/classes/$CLS/students -H "Authorization: Bearer $BT")
chk "S4_outsider_roster_404" "404" "$R"
LEAK=$(curl -s $B/classes/$CLS/students -H "Authorization: Bearer $A" | python -c "
import sys,json
sts=json.load(sys.stdin)['data']['students']
leak=any('phone' in s or 'email' in s for s in sts)
print('yes' if leak else 'no')")
chk "S4_member_no_phone_email" "no" "$LEAK"

# === S2 负向：班外学生下载班内学生文件应 403 ===
# 注意用 Windows 可见路径：Git Bash 的 /tmp 对原生 Windows python 不可见
WINTMP=$(python -c "import tempfile;print(tempfile.gettempdir())")
HWFILE="$WINTMP\\sec-hw.txt"
printf 'my secret homework content\n' > "$HWFILE"
FP=$(curl -s -X POST $B/upload/simple -H "Authorization: Bearer $A" -F "file=@$HWFILE" | jget "['data']['file_path']")
curl -s -X POST $B/submissions/assignment/$ASG -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"files\":[{\"original_name\":\"sec-hw.txt\",\"file_path\":\"$FP\",\"file_size\":26,\"mime_type\":\"text/plain\"}]}" >/dev/null
ENC=$(python -c "import urllib.parse;print(urllib.parse.quote('$FP'))")
R=$(curl -s -o /dev/null -w '%{http_code}' "$B/files/download?path=$ENC&token=$BT")
chk "S2_outsider_download_403" "403" "$R"
R=$(curl -s -o /dev/null -w '%{http_code}' "$B/files/download?path=$(python -c "import urllib.parse;print(urllib.parse.quote('/etc/passwd'))")&token=$BT")
chk "S2_traversal_403" "403" "$R"

# === S2b：作业样例文件授权下载（回归：JSON 列 LIKE 必须走 CAST，否则样例永远 403）===
SA_ASG=$(curl -s -X POST $B/assignments -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "{\"title\":\"样例作业\",\"course_id\":$CRS,\"deadline\":\"$DL\",\"allowed_formats\":[\"txt\"],\"max_files\":1,\"max_size_mb\":5,\"sample_files\":[{\"name\":\"s.txt\",\"type\":\"text/plain\",\"url\":\"$FP\"}]}" | jget "['data']['id']")
R=$(curl -s -o /dev/null -w '%{http_code}' "$B/files/download?path=$ENC&token=$A")
chk "S2b_member_sample_download" "200" "$R"
R=$(curl -s -o /dev/null -w '%{http_code}' "$B/files/download?path=$ENC&token=$BT")
chk "S2b_outsider_sample_403" "403" "$R"

# === F1：分片上传走 COS，返回 cos:// 路径；下载接口能物化（302 到签名URL） ===
HASH=$(python -c "import hashlib;print(hashlib.md5(open(r'$HWFILE','rb').read()).hexdigest())")
curl -s -X POST "$B/upload/chunk?hash=$HASH&index=0" -H "Authorization: Bearer $A" -F "chunk=@$HWFILE" >/dev/null
MERGE=$(curl -s -X POST $B/upload/merge -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"hash\":\"$HASH\",\"filename\":\"cos-test.txt\",\"total\":1,\"size\":26,\"mime_type\":\"text/plain\"}")
COSPATH=$(echo "$MERGE" | jget "['data']['file_path']")
echo "chunked upload path: $COSPATH"
case "$COSPATH" in
  cos://*) chk "F1_cos_path" "cos" "cos" ;;
  uploads/*) chk "F1_cos_path" "cos" "local-fallback( COS 未配置或上传失败降级 )" ;;
  *) chk "F1_cos_path" "cos" "$COSPATH" ;;
esac
if [ "${COSPATH#cos://}" != "$COSPATH" ]; then
  # 绑定到提交记录（授权下载要求文件归属于某条提交或样例）
  curl -s -X POST $B/submissions/assignment/$ASG -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"files\":[{\"original_name\":\"cos-test.txt\",\"file_path\":\"$COSPATH\",\"file_size\":26,\"mime_type\":\"text/plain\"}]}" >/dev/null
  CENC=$(python -c "import urllib.parse;print(urllib.parse.quote('$COSPATH'))")
  HTTP=$(curl -s -o /dev/null -w '%{http_code}%{redirect_url}' "$B/files/download?path=$CENC&token=$A")
  CODE=${HTTP%%http*}
  REDIR=${HTTP#"$CODE"}
  case "$REDIR" in
    https://*.myqcloud.com/*q-sign*) chk "F1_cos_signed_redirect" "signed" "signed" ;;
    *) chk "F1_cos_signed_redirect" "signed" "code=$CODE redir=${REDIR:0:60}" ;;
  esac
fi

# === F9：另一教师访问他人作业查重摘要应 403 ===
curl -s -X POST $B/users/teacher -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"username\":\"sec_t2\",\"password\":\"teacher123\",\"real_name\":\"另一个教师\",\"school_id\":$SCHOOL_ID}" >/dev/null
T2=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"sec_t2\",\"password\":\"teacher123\",\"school_id\":$SCHOOL_ID}" | jget "['data']['token']")
R=$(curl -s -o /dev/null -w '%{http_code}' $B/plagiarism/assignment-summary/$ASG -H "Authorization: Bearer $T2")
chk "F9_other_teacher_summary_403" "403" "$R"

# === S1：课代表退班后权限回收 ===
A_ID=$(curl -s "$B/users?keyword=sec_a" -H "Authorization: Bearer $ADMIN_TOKEN" | python -c "
import sys,json
us=json.load(sys.stdin)['data']['list']
print(next(u['id'] for u in us if u['username']=='sec_a'))")
ADD_ASST=$(curl -s -X POST $B/courses/$CRS/assistants -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "{\"student_id\":$A_ID}")
echo "add assistant resp: $(echo $ADD_ASST | head -c 120)"
R_BEFORE=$(curl -s -o /dev/null -w '%{http_code}' "$B/courses/assistant/assignments?course_id=$CRS" -H "Authorization: Bearer $A")
curl -s -X DELETE $B/classes/$CLS/students/$A_ID -H "Authorization: Bearer $ADMIN_TOKEN" >/dev/null
R_AFTER=$(curl -s -o /dev/null -w '%{http_code}' "$B/courses/assistant/assignments?course_id=$CRS" -H "Authorization: Bearer $A")
echo "assistant before-leave=$R_BEFORE after-leave=$R_AFTER"
if [ "$R_BEFORE" = "200" ] && [ "$R_AFTER" = "403" ]; then chk "S1_assistant_revoked_after_leave" "403" "403"; else chk "S1_assistant_revoked_after_leave" "before=200,after=403" "before=$R_BEFORE,after=$R_AFTER"; fi

echo ""
echo "RESULT: PASS=$PASS FAIL=$FAIL"
