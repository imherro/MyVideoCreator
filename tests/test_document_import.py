import copy
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from backend.app import app
from backend import store as s
from backend.document_text import extract_document, MAX_BYTES
from backend.script_import import rule_manifest, source_lines, extract, validate_manifest


def docx(text='第一集：相逢'):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        z.writestr('word/document.xml',f'''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>小林说：你好。</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>''')
    return out.getvalue()


def pdf(text=True, encrypted=False):
    writer=PdfWriter();page=writer.add_blank_page(300,300)
    if text:
        font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 10 250 Td (Chapter one. A visitor arrives.) Tj ET')
        page[NameObject('/Contents')]=writer._add_object(stream)
    if encrypted:writer.encrypt('test-password')
    out=io.BytesIO();writer.write(out);return out.getvalue()


def test_extract_common_documents_including_tables_and_wps_docx():
    assert extract_document('故事.docx',docx())=='第一集：相逢\n小林说：你好。'
    assert extract_document('故事.wps',docx())=='第一集：相逢\n小林说：你好。'
    assert extract_document('故事.txt','第一章：初遇'.encode('gb18030'))=='第一章：初遇'
    assert extract_document('故事.md','第一章：初遇'.encode('utf-16'))=='第一章：初遇'
    assert 'visitor arrives' in extract_document('故事.pdf',pdf())
    assert extract_document('故事.rtf',b'{\\rtf1\\ansi Hello \\u20320?\\u22909?}')=='Hello 你好'
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        z.writestr('content.xml','<root xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><text:h>第一章</text:h><text:p>他来了。</text:p></root>')
    assert extract_document('故事.odt',out.getvalue())=='第一章\n他来了。'


def test_reject_unsupported_empty_encrypted_scanned_or_corrupt_documents():
    for name,data,message in [
        ('a.exe',b'x','支持'),('a.txt',b'','为空'),('a.txt',b'x'*(MAX_BYTES+1),'20 MB'),
        ('a.docx',b'not a zip','格式'),('a.pdf',pdf(False),'没有可提取文字'),
        ('a.pdf',pdf(encrypted=True),'加密'),
    ]:
        with pytest.raises(ValueError,match=message):extract_document(name,data)


def test_long_paragraph_ranges_preserve_every_character_and_chapter_headings():
    content=('少年踏上山路，听见远处钟声。'*30)+'\r\n他回头望去。'
    lines=source_lines(content)
    assert len(lines)>20 and ''.join(lines)==content
    rules=rule_manifest(content,'故事.txt')
    rows=[]
    for n,(start,end) in enumerate([(1,15),(16,len(lines))],1):
        rows.append(dict(episodeNo=n,title=f'旅程{n}',startLine=start,endLine=end,durationSeconds=0,characters=[],scenes=[],incomplete=False,warnings=[]))
    value=dict(title='旅程',declaredEpisodes=0,episodes=rows,warnings=['根据15秒目标分为两集'])
    result=validate_manifest(content,value,rules)
    assert ''.join(extract(content,ep['startLine'],ep['endLine']) for ep in result['episodes'])==content
    bad=copy.deepcopy(value);bad['episodes'][0]['startLine']=2
    with pytest.raises(ValueError,match='首行'):validate_manifest(content,bad,rules)
    for content in ['第一章山门\n风起。\n第二章出发\n下山。','第1集：山门\n风起。\n第2集：出发\n下山。']:
        assert [ep['episodeNo'] for ep in rule_manifest(content,'test.txt')['episodes']]==[1,2]


@pytest.fixture(scope='module')
def client():
    with TestClient(app) as client:
        app.state.worker.stop()
        action='login' if client.get('/api/auth/status').json()['configured'] else 'setup'
        assert client.post('/api/auth/'+action,json={'password':'integration-test-only'}).status_code==200
        yield client


def new_project(client):
    return client.post('/api/projects',json={'name':'文档导入测试','duration':15}).json()


def test_upload_confirm_source_is_idempotent_and_never_overwrites_scripts(client):
    p=new_project(client);base=f'/api/productions/{p["production_id"]}'
    uploaded=client.post(base+'/script-imports/upload',files={'file':('test.docx',docx(),'application/octet-stream')})
    assert uploaded.status_code==200,uploaded.text
    draft=uploaded.json();path=base+'/script-imports/'+draft['id']
    with s.db() as c:c.execute('UPDATE episode_scripts SET body=? WHERE project_id=?',('现有剧本',p['id']))
    result=client.post(path+'/confirm-source',json={'episode_nos':[1]})
    assert result.status_code==200,result.text
    assert client.post(path+'/confirm-source',json={'episode_nos':[1]}).json()==result.json()
    assert client.post(path+'/confirm',json={'episode_nos':[1]}).status_code==400
    assert len(client.get(base+'/episodes').json())==1
    sources=client.get(base+'/sources').json()
    assert len(sources)==1 and sources[0]['chapter_count']==1
    with s.db() as c:
        assert c.execute('SELECT body FROM episode_scripts WHERE project_id=?',(p['id'],)).fetchone()['body']=='现有剧本'
        chapter=c.execute('SELECT content FROM source_chapters WHERE source_id=?',(sources[0]['id'],)).fetchone()
        assert chapter['content']==draft['manifest']['episodes'][0]['body']
    # Append to existing source, preserving earlier chapters and scripts.
    d=client.post(base+'/script-imports/upload',files={'file':('next.txt','第二集：夜行\n他连夜赶路。'.encode())}).json()
    append=client.post(base+'/script-imports/'+d['id']+'/confirm-source',json={'source_id':sources[0]['id'],'episode_nos':[2]})
    assert append.status_code==200,append.text
    assert client.get(base+'/sources').json()[0]['chapter_count']==2


def test_analysis_uses_project_duration_and_upload_is_isolated(client):
    p=new_project(client);other=new_project(client);base=f'/api/productions/{p["production_id"]}'
    with s.db() as c:
        row=c.execute('SELECT shared_context FROM productions WHERE id=?',(p['production_id'],)).fetchone()
        context=json.loads(row['shared_context']);context['generationPolicy']['text']={'providerId':'local','modelId':''}
        c.execute('UPDATE productions SET shared_context=? WHERE id=?',(s.dumps(context),p['production_id']))
    content=('少年沿着山路走去。'*40).encode()
    d=client.post(base+'/script-imports/upload',files={'file':('story.txt',content)}).json()
    assert d['manifest']['episodes']==[]
    path=base+'/script-imports/'+d['id']
    job=client.post(path+'/analyze',json={'project_id':p['id'],'submission_id':'unstructured-story-analysis'})
    assert job.status_code==200,job.text
    data=job.json()['jobs'][0]['input']
    assert data['script_import_analysis']['targetDurationSeconds']==15
    assert '15 秒' in data['prompt'] and '过长' in data['system_prompt']
    assert data['schema_version']=='script-import/v2'
    assert client.post(path+'/confirm-source',json={'original_only':True}).status_code==400
    assert client.post(f'/api/productions/{other["production_id"]}/script-imports/{d["id"]}/confirm-source',json={'original_only':True}).status_code==400


def test_original_only_and_invalid_append_are_atomic(client):
    p=new_project(client);base=f'/api/productions/{p["production_id"]}'
    d=client.post(base+'/script-imports/upload',files={'file':('story.txt','无章节的短故事。'.encode())}).json()
    path=base+'/script-imports/'+d['id']+'/confirm-source'
    assert client.post(path,json={'source_id':'missing','original_only':True}).status_code==400
    assert client.get(base+'/sources').json()==[]
    result=client.post(path,json={'original_only':True})
    assert result.status_code==200,result.text
    assert result.json()['imported_count']==1


def test_legacy_preview_keeps_its_original_line_number_semantics(client):
    p=new_project(client);base=f'/api/productions/{p["production_id"]}'
    content='第一集：漫长归途\n'+('他沿着山路走去。'*40)+'\n第二集：重逢\n他终于回来了。'
    draft=client.post(base+'/script-imports',json={'filename':'legacy.txt','content':content}).json()
    with s.db() as c:
        c.execute('UPDATE script_imports SET manifest=? WHERE id=?',(s.dumps(rule_manifest(content,'legacy.txt',logical=False)),draft['id']))
    path=base+'/script-imports/'+draft['id']
    rows=client.get(path).json()['manifest']['episodes']
    assert ''.join(ep['body'] for ep in rows)==content
    result=client.post(path+'/confirm-source',json={'episode_nos':[1,2]})
    assert result.status_code==200,result.text
    with s.db() as c:
        chapters=c.execute('SELECT content FROM source_chapters WHERE source_id=? ORDER BY chapter_no',(result.json()['sourceId'],)).fetchall()
        assert ''.join(row['content'] for row in chapters)==content
