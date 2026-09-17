"""Validate provider credentials without including them in diagnostic messages."""
import re


def clean_api_key(value):
    key = str(value or '').strip()
    if any(ord(char) < 33 or ord(char) > 126 for char in key):
        raise ValueError('API Key 包含内部空白或非法字符，请在供应商设置中重新粘贴完整 Key')
    return key


def bearer_headers(provider):
    key = clean_api_key(provider.get('api_key'))
    return {'Authorization': 'Bearer ' + key} if key else {}


def safe_provider_error(value):
    message = str(value)
    if 'illegal header' in message.lower():
        return '请求头格式无效，请检查供应商 API Key 是否包含空格、换行或非法字符；请求未能正常提交'
    return re.sub(r'(?i)\bBearer\s+[^\s\'"<>]+', 'Bearer [已隐藏]', message)
