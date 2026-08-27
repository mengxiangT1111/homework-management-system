#!/bin/bash
B=http://localhost:3000/api
PASS=0; FAIL=0
chk() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1";
  else FAIL=$((FAIL+1)); echo "FAIL: $1 (expect=$2 got=$3)"; fi
}

# 1. health
chk "health" "200" "$(curl -s -o /dev/null -w '%{http_code}' $B/health)"

# 2. admin login (no school)
ADMIN_TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
[ -n "$ADMIN_TOKEN" ] && chk "admin_login" "ok" "ok" || chk "admin_login" "ok" "empty"

# 3. create school
SCHOOL_ID=$(curl -s -X POST $B/schools -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"name":"测试大学","code":"TU"}' | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
[ -n "$SCHOOL_ID" ] && chk "create_school" "ok" "ok" || chk "create_school" "ok" "empty"

# 4. create teacher & student accounts under the school
T_CREATE=$(curl -s -X POST $B/users/teacher -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"username\":\"t1\",\"password\":\"teacher123\",\"real_name\":\"王老师\",\"school_id\":$SCHOOL_ID}")
chk "create_teacher" "ok" "$(echo $T_CREATE | python -c "import sys,json;print('ok' if json.load(sys.stdin)['success'] else 'fail')")"
S_CREATE=$(curl -s -X POST $B/users/student -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"username\":\"s1\",\"password\":\"student123\",\"real_name\":\"张三\",\"school_id\":$SCHOOL_ID}")
chk "create_student" "ok" "$(echo $S_CREATE | python -c "import sys,json;print('ok' if json.load(sys.stdin)['success'] else 'fail')")"

# 5. teacher & student login with school
T_TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"t1\",\"password\":\"teacher123\",\"school_id\":$SCHOOL_ID}" | python -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
S_TOKEN=$(curl -s -X POST $B/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"s1\",\"password\":\"student123\",\"school_id\":$SCHOOL_ID}" | python -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
[ -n "$T_TOKEN" ] && chk "teacher_login" "ok" "ok" || chk "teacher_login" "ok" "empty"
[ -n "$S_TOKEN" ] && chk "student_login" "ok" "ok" || chk "student_login" "ok" "empty"

# 6. create class
CLASS_ID=$(curl -s -X POST $B/classes -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"计科2201\",\"grade\":\"2022级\",\"school_id\":$SCHOOL_ID}" | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
[ -n "$CLASS_ID" ] && chk "create_class" "ok" "ok" || chk "create_class" "ok" "empty"

# 7. student self-joins the class
ADD=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/classes/$CLASS_ID/join -H "Authorization: Bearer $S_TOKEN")
chk "join_class" "200" "$ADD"

# 8. teacher creates course
COURSE_ID=$(curl -s -X POST $B/courses -H "Authorization: Bearer $T_TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"数据结构\",\"class_id\":$CLASS_ID}" | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
[ -n "$COURSE_ID" ] && chk "create_course" "ok" "ok" || chk "create_course" "ok" "empty"

# 9. teacher creates assignment
DEADLINE=$(python -c "import datetime;print((datetime.datetime.now()+datetime.timedelta(days=7)).isoformat())")
ASSIGN_ID=$(curl -s -X POST $B/assignments -H "Authorization: Bearer $T_TOKEN" -H 'Content-Type: application/json' -d "{\"title\":\"第一次作业\",\"description\":\"测试\",\"course_id\":$COURSE_ID,\"deadline\":\"$DEADLINE\",\"allowed_formats\":[\"txt\",\"docx\"],\"max_files\":3,\"max_size_mb\":10}" | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
[ -n "$ASSIGN_ID" ] && chk "create_assignment" "ok" "ok" || chk "create_assignment" "ok" "empty"

# 10. upload a txt file via simple upload
UP=$(curl -s -X POST $B/upload/simple -H "Authorization: Bearer $S_TOKEN" -F "file=@/tmp/test-homework.txt")
FILE_PATH=$(echo "$UP" | python -c "import sys,json;print(json.load(sys.stdin)['data']['file_path'])")
[ -n "$FILE_PATH" ] && chk "simple_upload" "ok" "ok" || chk "simple_upload" "ok" "empty"

# 11. student submits
SUBMIT=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/submissions/assignment/$ASSIGN_ID -H "Authorization: Bearer $S_TOKEN" -H 'Content-Type: application/json' -d "{\"files\":[{\"original_name\":\"test-homework.txt\",\"file_path\":\"$FILE_PATH\",\"file_size\":100,\"mime_type\":\"text/plain\"}],\"remark\":\"测试提交\"}")
if [ "$SUBMIT" = "200" ] || [ "$SUBMIT" = "201" ]; then chk "submit" "ok" "ok"; else chk "submit" "200/201" "$SUBMIT"; fi

# 12. F7: teacher grades then student resubmit must be rejected
SUB_ID=$(curl -s "$B/assignments/$ASSIGN_ID/submissions" -H "Authorization: Bearer $T_TOKEN" | python -c "
import sys,json
d=json.load(sys.stdin)['data']['students']
print(next(s['submission']['id'] for s in d if s['submitted']))")
GRADE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT $B/submissions/$SUB_ID/grade -H "Authorization: Bearer $T_TOKEN" -H 'Content-Type: application/json' -d '{"score":85,"comment":"good","status":"graded"}')
chk "teacher_grade" "200" "$GRADE"
RESUB=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/submissions/assignment/$ASSIGN_ID -H "Authorization: Bearer $S_TOKEN" -H 'Content-Type: application/json' -d "{\"files\":[{\"original_name\":\"test-homework.txt\",\"file_path\":\"$FILE_PATH\",\"file_size\":100,\"mime_type\":\"text/plain\"}]}")
chk "F7_resubmit_blocked" "422" "$RESUB"

# 13. F6: closed assignment submission rejected
A2=$(curl -s -X POST $B/assignments -H "Authorization: Bearer $T_TOKEN" -H 'Content-Type: application/json' -d "{\"title\":\"关闭的作业\",\"course_id\":$COURSE_ID,\"deadline\":\"$DEADLINE\",\"allowed_formats\":[\"txt\"],\"max_files\":1,\"max_size_mb\":10}" | python -c "import sys,json;print(json.load(sys.stdin)['data']['id'])")
CLOSE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT $B/assignments/$A2 -H "Authorization: Bearer $T_TOKEN" -H 'Content-Type: application/json' -d '{"status":"closed"}')
chk "close_assignment" "200" "$CLOSE"
SUBCLOSED=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/submissions/assignment/$A2 -H "Authorization: Bearer $S_TOKEN" -H 'Content-Type: application/json' -d "{\"files\":[{\"original_name\":\"test-homework.txt\",\"file_path\":\"$FILE_PATH\",\"file_size\":100,\"mime_type\":\"text/plain\"}]}")
chk "F6_closed_blocked" "422" "$SUBCLOSED"

# 14. S2: /uploads static route removed; /api/files/download authz
OLD=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/uploads/$(echo $FILE_PATH | sed 's|^uploads/||')")
chk "S2_old_uploads_route_gone" "404" "$OLD"
ENC=$(python -c "import urllib.parse;print(urllib.parse.quote('$FILE_PATH'))")
OWN=$(curl -s -o /dev/null -w '%{http_code}' "$B/files/download?path=$ENC&token=$S_TOKEN")
chk "S2_owner_download" "200" "$OWN"
TEA=$(curl -s -o /dev/null -w '%{http_code}' "$B/files/download?path=$ENC&token=$T_TOKEN")
chk "S2_teacher_download" "200" "$TEA"

# 15. F8: remind notification type
REM=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/submissions/assignment/$A2/remind -H "Authorization: Bearer $T_TOKEN")
chk "F8_remind" "200" "$REM"
NTYPE=$(curl -s "$B/notifications?page=1&pageSize=10" -H "Authorization: Bearer $S_TOKEN" | python -c "
import sys,json
d=json.load(sys.stdin)['data']['list']
rem=[n for n in d if '催交' in n['title']]
print(rem[0]['type'] if rem else 'none')")
chk "F8_remind_type_assignment" "assignment" "$NTYPE"

# 16. S5: reset password validation
RP=$(curl -s -o /dev/null -w '%{http_code}' -X PUT $B/users/3/password -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{}')
chk "S5_no_default_pwd" "422" "$RP"
RP2=$(curl -s -o /dev/null -w '%{http_code}' -X PUT $B/users/3/password -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"new_password":"123456"}')
chk "S5_pure_digits_rejected" "422" "$RP2"

echo ""
echo "RESULT: PASS=$PASS FAIL=$FAIL"
