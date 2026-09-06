# -*- coding: utf-8 -*-
"""git 提交前保密扫描：PDF/DOCX 提取文本 + 源码/文档敏感模式扫描"""
import re
import sys
import zipfile
import os

ROOT = r"C:\Users\13523\Desktop\网站"
ISSUES = []

# 敏感模式（对提取的全文与源码均适用）
PATTERNS = [
    ("手机号", re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")),
    ("身份证", re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")),
    ("邮箱-个人", re.compile(r"(?i)[a-z0-9._%+-]+@(?:qq|163|126|gmail|outlook|foxmail)\.(?:com|net)")),
    ("IPv4", re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")),
    ("API密钥形态", re.compile(r"(?i)(?:sk-[a-z0-9]{16,}|AKID[A-Za-z0-9]{13,})")),
    ("私钥块", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("密钥赋值", re.compile(r"(?i)(?:secret_?key|secret_?id|api_?key|access_?key)\s*[:=]\s*['\"][A-Za-z0-9+/]{12,}['\"]")),
    ("JWT硬编码", re.compile(r"(?i)jwt_?secret\s*[:=]\s*['\"][^'\"]{8,}['\"]")),
    ("密码赋值", re.compile(r"(?i)(?:password|passwd|pwd)\s*[:=]\s*['\"][^'\"]{6,}['\"]")),
]

# 白名单：演示数据/示例中允许出现的假值
ALLOW = {
    "homework123", "admin123", "teacher123", "student123", "ChangeMe",
    "change_this_secret_in_production", "homework_system_secret_key_2024",
    "127.0.0.1", "0.0.0.0", "192.168.", "10.0.", "localhost",
    "123.45.67.89",  # DEPLOY.md 文档示例 IP
    "0.0", "1.0", "3.04", "2.0", "1.16", "0.25", "1.09",  # 版本号/小数
}

def allowed(match_text):
    return any(a.lower() in match_text.lower() for a in ALLOW)

def scan_text(text, label):
    for name, pat in PATTERNS:
        for m in pat.finditer(text):
            s = m.group(0)
            if allowed(s):
                continue
            ctx = text[max(0, m.start() - 40):m.end() + 40].replace("\n", " ")
            ISSUES.append(f"[{label}] {name}: {s}  上下文: …{ctx}…")

def scan_pdf(path):
    label = os.path.basename(path)
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader
        r = PdfReader(path)
        text = "".join((p.extract_text() or "") for p in r.pages)
        scan_text(text, f"PDF:{label}")
        return len(text)
    except Exception as e:
        ISSUES.append(f"[PDF:{label}] 提取失败: {e}")
        return 0

def scan_docx(path):
    label = os.path.basename(path)
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
        text = re.sub(r"<[^>]+>", " ", xml)
        scan_text(text, f"DOCX:{label}")
        return len(text)
    except Exception as e:
        ISSUES.append(f"[DOCX:{label}] 提取失败: {e}")
        return 0

def scan_file(path):
    label = os.path.relpath(path, ROOT)
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            scan_text(f.read(), label)
    except Exception as e:
        ISSUES.append(f"[{label}] 读取失败: {e}")

# ===== 1. 二进制文档 =====
total = 0
for f in [
    r"docs\信衡网站新手指引.pdf",
    r"docs\信衡网站新手指引-图解版.pdf",
    r"docs\信衡网站新手指引-学生版.pdf",
    r"docs\大创项目申报与结题全景分析报告.docx",
]:
    p = os.path.join(ROOT, f)
    if os.path.exists(p):
        if f.endswith(".pdf"):
            total += scan_pdf(p)
        else:
            total += scan_docx(p)
print(f"文档文本提取总量: {total} 字符")

# ===== 2. 待提交的文本文件（源码 + md + js + vue） =====
import subprocess
out = subprocess.run(
    ["git", "-c", "core.quotepath=false", "status", "--short"], cwd=ROOT, capture_output=True
).stdout.decode("utf-8", "ignore")
files = []
for line in out.splitlines():
    line = line.strip()
    if not line:
        continue
    status, path = line[:2], line[2:].strip().strip('"')
    if "~$" in path:  # Word 锁文件单独处理
        continue
    if path.endswith((".pdf", ".docx")):
        continue
    p = os.path.join(ROOT, path)
    if os.path.isdir(p):
        continue
    files.append(path)
print(f"待扫描文本文件: {len(files)} 个")
for rel in files:
    scan_file(os.path.join(ROOT, rel))

# ===== 2b. 全仓库已跟踪文本文件（不只本次变更） =====
tracked = subprocess.run(
    ["git", "-c", "core.quotepath=false", "ls-files"], cwd=ROOT, capture_output=True
).stdout.decode("utf-8", "ignore").splitlines()
tracked_text = [
    f for f in tracked
    if not f.endswith((".pdf", ".docx", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2"))
    and "~$" not in f
]
print(f"全仓库跟踪文本文件: {len(tracked_text)} 个")
for rel in tracked_text:
    scan_file(os.path.join(ROOT, rel))

# ===== 3. 真实密钥值检查（从 server/.env 读取，全树搜索，不打印密钥本身） =====
env_path = os.path.join(ROOT, "server", ".env")
if os.path.exists(env_path):
    with open(env_path, encoding="utf-8", errors="ignore") as f:
        env = f.read()
    secrets = []
    for m in re.finditer(r"(?m)^(COS_SECRET_ID|COS_SECRET_KEY|JWT_SECRET|AI_API_KEY|DB_PASSWORD)=(\S{8,})", env):
        val = m.group(2)
        if "ChangeMe" in val or "在这里填" in val:
            continue
        secrets.append((m.group(1), val))
    leaked = []
    for name, val in secrets:
        # 在所有 git 跟踪文件与待提交新文件中搜该值
        r = subprocess.run(
            ["git", "grep", "-l", "-F", val, "--", "."], cwd=ROOT, capture_output=True
        )
        hits = r.stdout.decode("utf-8", "ignore").strip()
        # git grep 只搜跟踪文件，再补搜待提交的新文件
        for rel in files:
            p = os.path.join(ROOT, rel)
            if os.path.isfile(p):
                try:
                    with open(p, encoding="utf-8", errors="ignore") as f2:
                        if val in f2.read():
                            hits += f"\n{rel}"
                except Exception:
                    pass
        if hits.strip():
            leaked.append(f"{name} 泄露于: {hits}")
    if secrets:
        print(f".env 中强密钥 {len(secrets)} 个，跟踪/新增文件中出现: {len(leaked)} 处")
    for l in leaked:
        ISSUES.append("[密钥泄露] " + l)

# ===== 结果 =====
print("\n" + "=" * 60)
if ISSUES:
    print(f"发现 {len(ISSUES)} 个疑似问题：")
    for i in ISSUES:
        print("  •", i[:300])
else:
    print("✓ 未发现敏感信息")
