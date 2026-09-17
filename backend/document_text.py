"""Local document extraction for import previews; never send binary files to a model."""
import io
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

EXTENSIONS = {'.txt', '.md', '.markdown', '.docx', '.doc', '.wps', '.pdf', '.rtf', '.odt'}
MAX_BYTES = 20 * 1024 * 1024
MAX_CHARS = 120000


def decode_text(data):
    encodings = ['utf-16'] if data.startswith((b'\xff\xfe', b'\xfe\xff')) else ['utf-8-sig', 'gb18030']
    for encoding in encodings:
        try:
            text = data.decode(encoding)
            if '\x00' not in text:
                return text
        except UnicodeError:
            pass
    raise ValueError('无法识别文字编码，请另存为 UTF-8 TXT 或 DOCX 后导入')


def xml_text(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        name = 'word/document.xml' if 'word/document.xml' in names else 'content.xml'
        info = archive.getinfo(name)
        if info.file_size > MAX_BYTES:
            raise ValueError('文档解压后的正文过大，请分文件导入')
        xml = archive.read(name)
        if b'<!DOCTYPE' in xml or b'<!ENTITY' in xml:
            raise ValueError('不支持包含自定义 XML 实体的文档')
        root = ET.fromstring(xml)
        if name.startswith('word/'):
            ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
            return '\n'.join(''.join((node.text or '') if node.tag == ns+'t' else '\n' if node.tag in (ns+'br', ns+'cr') else '\t' if node.tag == ns+'tab' else '' for node in paragraph.iter()) for paragraph in root.iter(ns+'p'))
        ns = '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}'
        return '\n'.join(''.join(paragraph.itertext()) for paragraph in root.iter() if paragraph.tag in (ns+'p', ns+'h'))


def office_text(data, suffix):
    candidates = [os.environ.get('MVC_SOFFICE', ''), shutil.which('soffice') or '']
    for base in (os.environ.get('PROGRAMFILES'), os.environ.get('PROGRAMFILES(X86)')):
        if base:
            candidates.append(str(Path(base)/'LibreOffice/program/soffice.exe'))
    executable = next((path for path in candidates if path and Path(path).is_file()), None)
    if not executable:
        raise ValueError('此旧版 DOC/WPS 文件需要服务端安装 LibreOffice（或设置 MVC_SOFFICE）；也可在 Word/WPS 中另存为 DOCX 后导入')
    with tempfile.TemporaryDirectory(prefix='anying-document-') as directory:
        root = Path(directory)
        source = root / ('source'+suffix)
        source.write_bytes(data)
        # Separate profile: no interaction with a user's open office documents.
        profile = root/'profile'
        profile.mkdir()
        (profile/'user').mkdir()
        (profile/'user/registrymodifications.xcu').write_text('''<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>''', encoding='utf-8')
        subprocess.run([executable, '-env:UserInstallation='+profile.as_uri(), '--headless', '--norestore', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', directory, str(source)], timeout=60, capture_output=True, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        target = root/'source.txt'
        if not target.is_file() or target.stat().st_size > MAX_BYTES:
            raise ValueError('无法转换此版本 DOC/WPS，请在原软件中另存为 DOCX 后导入')
        return decode_text(target.read_bytes())


def extract_document(filename, data):
    suffix = Path(filename).suffix.lower()
    if suffix not in EXTENSIONS:
        raise ValueError('支持 TXT、Markdown、Word（DOCX/DOC）、WPS、PDF、RTF、ODT')
    if not data or len(data) > MAX_BYTES:
        raise ValueError('文件为空或超过 20 MB，请分文件导入')
    try:
        if suffix in {'.txt', '.md', '.markdown'}:
            text = decode_text(data)
        elif suffix == '.pdf':
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted and not reader.decrypt(''):
                raise ValueError('PDF 已加密，请解除密码保护后导入')
            if len(reader.pages) > 500:
                raise ValueError('PDF 超过 500 页，请分文件导入')
            pages = []
            for index, page in enumerate(reader.pages, 1):
                content = page.extract_text() or ''
                if not content.strip():
                    raise ValueError(f'PDF 第 {index} 页没有可提取文字，可能是扫描页或空白页；请先 OCR 或移除空白页后导入，避免遗漏正文')
                pages.append(content)
                if sum(map(len, pages)) > MAX_CHARS:
                    raise ValueError('正文超过 12 万字符，请分文件导入')
            text = '\n'.join(pages)
        elif zipfile.is_zipfile(io.BytesIO(data)):
            text = xml_text(data)
        elif suffix == '.rtf' or data.lstrip().startswith(b'{\\rtf'):
            from striprtf.striprtf import rtf_to_text
            text = rtf_to_text(data.decode('latin-1'))
        elif suffix in {'.doc', '.wps'}:
            text = office_text(data, suffix)
        else:
            raise ValueError('文档格式与扩展名不符，或文件已损坏；请重新另存为 DOCX 后导入')
    except ValueError:
        raise
    except ImportError as error:
        raise ValueError('服务端缺少文档读取依赖，请安装最新 requirements.txt 后重启') from error
    except Exception as error:
        raise ValueError('文档读取失败：文件损坏、加密或格式不支持，请另存为 DOCX/TXT 后重试') from error
    text = text.replace('\x00', '').strip()
    if not text:
        raise ValueError('文档没有可提取的文字；图片或扫描件请先进行 OCR')
    if len(text) > MAX_CHARS:
        raise ValueError('正文超过 12 万字符，请分文件导入')
    return text
