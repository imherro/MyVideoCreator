"""Parse Chat Completions SSE / JSON without interpreting reasoning as content."""
import json
import re


class ChatResponseError(ValueError):
    pass


def redact(value, secret=''):
    text=str(value)
    if secret:text=text.replace(secret,'[redacted]')
    text=re.sub(r'(?i)Bearer\s+[^\s\"\'<>]+','Bearer [redacted]',text)
    text=re.sub(r'''(?i)((?:api[_-]?key|authorization|token|password|secret)["'\s]*[:=]\s*)(["'])(.*?)\2''',r'\1"[redacted]"',text)
    text=re.sub(r'(?i)((?:api[_-]?key|authorization|token|password|secret)[\"\s]*[:=][\"\s]*)([^\s,}\"]+)',r'\1[redacted]',text)
    return text[:500]


class ChatResponse:
    def __init__(self, diagnostic, secret=''):
        self.d=diagnostic;self.secret=secret;self.parts=[];self.raw=[];self.pending='';self.sse=False;self.valid=False;self.error_event=False
        self.d.update(event_count=0,packet_count=0,response_format='unknown')

    def fail(self, category, message):
        self.d.update(category=category,error=redact(message,self.secret))
        raise ChatResponseError(self.d['error'])

    def packet(self, packet, streaming):
        self.d['packet_count']+=1
        if not isinstance(packet,dict):self.fail('unsupported_format','响应格式不支持：JSON 顶层不是对象')
        self.d['response_keys']=[redact(k,self.secret)[:60] for k in list(packet)[:15]]
        if isinstance(packet.get('usage'),dict):
            self.d['usage']={k:v for k,v in packet['usage'].items() if k in ('prompt_tokens','completion_tokens','total_tokens') and isinstance(v,(int,float))}
        if packet.get('error') or self.error_event:
            self.fail('upstream_error','上游文本服务报错：'+redact(packet.get('error') or packet,self.secret))
        choices=packet.get('choices')
        if not isinstance(choices,list):self.fail('unsupported_format','响应格式不支持：缺少 Chat Completions choices 数组')
        if not choices:
            self.valid=True
            return
        choice=choices[0]
        if not isinstance(choice,dict):self.fail('unsupported_format','响应格式不支持：choice 不是对象')
        if choice.get('finish_reason'):self.d['finish_reason']=redact(choice['finish_reason'],self.secret)
        field='delta' if streaming else 'message'
        content=choice.get(field)
        if not isinstance(content,dict):self.fail('unsupported_format',f'响应格式不支持：缺少 {field} 对象')
        self.valid=True
        part=content.get('content')
        if part is not None and not isinstance(part,str):self.fail('unsupported_format','响应格式不支持：正文 content 不是字符串')
        if part:self.parts.append(part)

    def line(self, line):
        if line.startswith('event:'):
            self.error_event=line[6:].strip()=='error';return
        if line.startswith('data:'):
            self.sse=True;self.d['response_format']='sse';self.d['event_count']+=1
            data=line[5:].strip()
            if data=='[DONE]':return
            self.pending+=('\n' if self.pending else '')+data
            if len(self.pending)>2_000_000:self.fail('parse_error','流式响应解析异常：未闭合事件超过读取上限')
            try:packet=json.loads(self.pending)
            except json.JSONDecodeError:return
            self.pending='';self.packet(packet,True);self.error_event=False
        elif not line and self.pending:
            if self.error_event:self.fail('upstream_error','上游错误事件：'+redact(self.pending,self.secret))
            self.fail('parse_error','流式响应解析异常：事件不是有效 JSON')
        elif line and not line.startswith((':','id:','retry:')):
            self.raw.append(line)
            if sum(map(len,self.raw))>2_000_000:self.fail('unsupported_format','非流式响应超过诊断读取上限')

    def finish(self):
        if self.sse and self.raw:self.fail('unsupported_format','响应格式不支持：SSE 中混入非事件正文')
        if self.pending:
            if self.error_event:self.fail('upstream_error','上游错误事件：'+redact(self.pending,self.secret))
            self.fail('parse_error','流式响应解析异常：事件 JSON 不完整')
        if not self.sse and self.raw:
            self.d['response_format']='json'
            try:packet=json.loads('\n'.join(self.raw))
            except json.JSONDecodeError:self.fail('unsupported_format','响应格式不支持：既非 SSE，也非有效 JSON')
            self.packet(packet,False)
        text=''.join(self.parts).strip()
        if self.d.get('finish_reason') in ('length','max_tokens'):return text
        if not text:
            if self.valid:self.fail('empty_result','上游返回有效响应，但最终正文为空；未将推理内容当作正文')
            self.fail('unsupported_format','未收到可识别的 Chat Completions 正文事件')
        self.d['category']='success'
        return text
