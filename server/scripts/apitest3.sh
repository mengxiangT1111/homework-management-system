#!/bin/bash
# 第三轮：覆盖前两轮未触达的修复点（F5/resolveUrls/zip下载/F14/合法重置密码/分片上限）
B=http://localhost:3000/api
PASS=0; FAIL=0
chk() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1";
  else FAIL=$((FAIL+1)); echo "FAIL: $1 (expect=$2 got=$3)"; fi
}
jget() { python -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }

ADMIN_TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | jget "['data']['token']")
S1=$(curl -s -X POST $B/schools -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"name":"甲大学","code":"A1"}' | jget "['data']['id']")
S2=$(curl -s -X POST $B/schools -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"name":"乙大学","code":"B2"}' | jget "['data']['id']")
curl -s -X POST $B/users/teacher -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"username\":\"t3\",\"password\":\"teacher123\",\"real_name\":\"丙教师\",\"school_id\":$S1}" >/dev/null
curl -s -X POST $B/users/student -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"username\":\"s3\",\"password\":\"student123\",\"real_name\":\"李四\",\"school_id\":$S1}" >/dev/null
T=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"t3\",\"password\":\"teacher123\",\"school_id\":$S1}" | jget "['data']['token']")
ST=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"s3\",\"password\":\"student123\",\"school_id\":$S1}" | jget "['data']['token']")
CLS=$(curl -s -X POST $B/classes -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"三班\",\"grade\":\"2025级\",\"school_id\":$S1}" | jget "['data']['id']")
curl -s -X POST $B/classes/$CLS/join -H "Authorization: Bearer $ST" >/dev/null
CRS=$(curl -s -X POST $B/courses -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "{\"name\":\"丙课\",\"class_id\":$CLS}" | jget "['data']['id']")
DL=$(python -c "import datetime;print((datetime.datetime.now()+datetime.timedelta(days=5)).isoformat())")
ASG=$(curl -s -X POST $B/assignments -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d "{\"title\":\"三轮作业\",\"course_id\":$CRS,\"deadline\":\"$DL\",\"allowed_formats\":[\"txt\"],\"max_files\":1,\"max_size_mb\":5,\"need_grading\":true}" | jget "['data']['id']")

# --- F5：教师上传 Word 参考答案（自动生成真 docx，仓库的 example.docx 是改名的文本文件）---
node -e "
const { Document, Packer, Paragraph } = require('docx');
const fs = require('fs');
const doc = new Document({ sections: [{ children: [new Paragraph('数据结构参考答案：栈是后进先出的线性表。')] }] });
Packer.toBuffer(doc).then(b => fs.writeFileSync('uploads/test-ref.docx', b));
" && sleep 1
UPREF=$(curl -s -X POST $B/ai/upload-reference -H "Authorization: Bearer $T" -F "file=@uploads/test-ref.docx")
TEXTLEN=$(echo "$UPREF" | python -c "import sys,json;print(len(json.load(sys.stdin)['data']['text']))" 2>/dev/null)
if [ -n "$TEXTLEN" ] && [ "$TEXTLEN" -gt "0" ] 2>/dev/null; then chk "F5_upload_reference" "ok" "ok"; else chk "F5_upload_reference" "ok" "textlen=$TEXTLEN"; fi
TMPCNT=$(ls uploads/tmp 2>/dev/null | wc -l | tr -d ' ')
chk "F5_tmp_cleaned" "0" "$TMPCNT"
rm -f uploads/test-ref.docx

# --- 本地文件提交 + zip 打包下载 ---
printf 'zip download verification\n' > uploads/example-zip-test.txt
FP=$(curl -s -X POST $B/upload/simple -H "Authorization: Bearer $ST" -F "file=@uploads/example-zip-test.txt" | jget "['data']['file_path']")
curl -s -X POST $B/submissions/assignment/$ASG -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' -d "{\"files\":[{\"original_name\":\"example-zip-test.txt\",\"file_path\":\"$FP\",\"file_size\":26,\"mime_type\":\"text/plain\"}]}" >/dev/null
ZIP=$(curl -s -o /tmp/test-download.zip -w '%{http_code}' "$B/submissions/assignment/$ASG/download" -H "Authorization: Bearer $T")
ZIPPED=$(python -c "import zipfile;z=zipfile.ZipFile(r'C:/tmp/test-download.zip' if __import__('os').path.exists('C:/tmp/test-download.zip') else '/tmp/test-download.zip');print(len(z.namelist()))" 2>/dev/null || python -c "
import zipfile, tempfile, os
# Git Bash /tmp 与 Windows python 路径差异，尝试常见位置
for p in [os.path.join(tempfile.gettempdir(),'test-download.zip')]:
    if os.path.exists(p):
        print(len(zipfile.ZipFile(p).namelist())); break
else:
    print('nofile')")
if [ "$ZIP" = "200" ] && [ "$ZIPPED" -gt "0" ] 2>/dev/null; then chk "zip_download" "ok" "ok"; else chk "zip_download" "ok" "code=$ZIP entries=$ZIPPED"; fi

# --- resolveUrls：本人路径有值，伪造路径 null ---
RU=$(curl -s -X POST $B/files/urls -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' -d "{\"paths\":[\"$FP\",\"uploads/202608/notmine.txt\"]}")
OWN_URL=$(echo "$RU" | jget "['data']['$FP']")
FORGED=$(echo "$RU" | python -c "import sys,json;print(json.load(sys.stdin)['data']['uploads/202608/notmine.txt'])")
[ -n "$OWN_URL" ] && chk "resolveUrls_own" "ok" "ok" || chk "resolveUrls_own" "ok" "empty"
chk "resolveUrls_forged_null" "None" "$FORGED"

# --- F14：班级转校后课程 school_id 同步 ---
curl -s -X PUT $B/classes/$CLS -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"school_id\":$S2}" >/dev/null
COURSE_SCHOOL=$(docker exec homework_mysql mysql -uhomework -phomework123 homework_db -N -e "SELECT school_id FROM courses WHERE id=$CRS;" 2>/dev/null | tr -d '[:space:]')
chk "F14_course_school_synced" "$S2" "$COURSE_SCHOOL"

# --- 合法重置密码应成功 ---
RP=$(curl -s -o /dev/null -w '%{http_code}' -X PUT $B/users/$(docker exec homework_mysql mysql -uhomework -phomework123 homework_db -N -e "SELECT id FROM users WHERE username='s3';" 2>/dev/null | tr -d '[:space:]')/password -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"new_password":"newpass123"}')
chk "S5_valid_reset_200" "200" "$RP"

# --- 分片总数超上限应 422 ---
MERGE_BAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/upload/merge -H "Authorization: Bearer $ST" -H 'Content-Type: application/json' -d '{"hash":"0123456789abcdef0123456789abcdef","filename":"a.txt","total":9999}')
chk "F10_chunk_total_limit" "422" "$MERGE_BAD"

echo ""
echo "RESULT: PASS=$PASS FAIL=$FAIL"
