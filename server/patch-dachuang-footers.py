# -*- coding: utf-8 -*-
"""页脚页码格式补丁：罗马节 PAGE -> PAGE \\* ROMAN, 其余 -> PAGE \\* arabic；移除空 pgNumType。
罗马页脚的标记：docx 生成时给罗马页脚的 TextRun 设置了 italics（<w:i/>）。"""
import re, shutil, sys, zipfile, os

path = sys.argv[1]
tmp = path + ".tmp"
zin = zipfile.ZipFile(path, "r")
zout = zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    data = zin.read(item.filename)
    name = item.filename
    if re.match(r"word/footer\d+\.xml", name):
        xml = data.decode("utf-8")
        if "PAGE" in xml:
            fmt = "ROMAN" if "<w:i/>" in xml else "arabic"
            xml = re.sub(r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
                         r"\g<1> PAGE \\* " + fmt + r" \\* MERGEFORMAT \g<2>", xml)
            data = xml.encode("utf-8")
    elif name == "word/document.xml":
        xml = data.decode("utf-8")
        xml = xml.replace("<w:pgNumType/>", "")
        data = xml.encode("utf-8")
    zout.writestr(item, data)
zin.close()
zout.close()
shutil.move(tmp, path)
print("FOOTER_PATCH_OK")
