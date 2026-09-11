"""Project-owned inference runtime and supervised llama.cpp."""
import json
import os
import socket
import secrets
import subprocess
import threading
import time
from pathlib import Path
import httpx
from .store import ROOT, DATA, get_setting

ENGINE = ROOT / 'inference' / 'engine'
INFERENCE_ENV = ROOT / '.inference-env'
MAESTRO = ENGINE  # Retained as an adapter constant for protocol compatibility.
_lock = threading.RLock()
_process = None
_model = None
_port = None
_log = None
_key = ''
_idle_timer = None

def schedule_idle(seconds=60):
    """Start the idle window only after the current text request has ended."""
    global _idle_timer
    with _lock:
        if _idle_timer: _idle_timer.cancel()
        def expire():
            with _lock:
                if _idle_timer is timer: unload()
        timer=threading.Timer(seconds,expire)
        _idle_timer=timer
        _idle_timer.daemon=True
        _idle_timer.start()

def credentials():
    return _key

def bootstrap():
    """Register only models whose primary weights already exist on this host."""
    from .store import set_setting
    configured=get_setting('providers',[])
    defaults=[
        {'id':'maestro-image','name':'Flux 2 Klein Base 9B + NSFW LoRA · 内置','type':'maestro','url':'http://127.0.0.1:7870','kind':'image','model':'flux2_klein_base_9b','local':True,'auto_start':True,'parameters':{'activated_loras':['Flux_Klein_9B_NSFW.safetensors'],'loras_multipliers':'1'}},
        {'id':'maestro-video','name':'MiniMax H3 INT8 + Qwen3-VL Q2_K · 内置','type':'maestro','url':'http://127.0.0.1:7870','kind':'video','model':'minimax_h3','local':True,'auto_start':True,'parameters':{'minimax_h3_text_encoder':'gguf_q2_k'}},
    ]
    if get_setting('native_defaults_version')!=1:
        configured=[p for p in configured if p['id'] not in ('maestro-image','maestro-video')]
        set_setting('providers',defaults+configured)
        set_setting('native_defaults_version',1)

def hardware():
    try:
        p = subprocess.run(['nvidia-smi','--query-gpu=name,memory.total,memory.free','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        name,total,free = p.stdout.strip().splitlines()[0].rsplit(',',2)
        return {'name':name.strip(),'total_mb':int(total),'free_mb':int(free)}
    except Exception:
        return {'name':'未检测到 NVIDIA 显卡','total_mb':0,'free_mb':0}

def inventory():
    manifest=json.loads((ROOT/'inference'/'models.json').read_text(encoding='utf-8'))
    groups=[]
    for kind,group in manifest.items():
        files=[]
        for relative in group['files']:
            path=ENGINE/relative
            files.append({'name':path.name,'path':str(path),'present':path.is_file(),'size_gb':round(path.stat().st_size/1024**3,2) if path.is_file() else 0})
        groups.append({'kind':kind,'name':group['name'],'ready':all(f['present'] for f in files),'files':files})
    return {'engine_path':str(ENGINE),'environment_ready':(INFERENCE_ENV/'Scripts'/'python.exe').is_file(),'models':groups}

def discover():
    directories = [MAESTRO / 'ckpts' / 'llm']
    directories.extend(Path(p).expanduser() for p in get_setting('model_directories',[]))
    seen = set()
    models = []
    for directory in directories:
        if not directory.is_dir():
            continue
        for path in directory.rglob('*.gguf'):
            if path.name.startswith('mmproj') or str(path.resolve()) in seen:
                continue
            seen.add(str(path.resolve()))
            models.append({'id':str(path.resolve()),'name':path.stem,'size_gb':round(path.stat().st_size/1024**3,2),'kind':'text','local':True})
    return sorted(models,key=lambda m:('Qwen3.8-27B-Uncensored' not in m['name'],m['size_gb']))

def status():
    return {'loaded':_process is not None and _process.poll() is None,'model':_model,'port':_port,'maestro_found':(MAESTRO/'launch.py').is_file()}

def unload():
    global _process,_model,_port,_log,_idle_timer
    with _lock:
        if _idle_timer:
            _idle_timer.cancel()
            _idle_timer=None
        if _process and _process.poll() is None:
            _process.terminate()
            try:
                _process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                _process.kill()
                _process.wait(timeout=5)
        _process = _model = _port = None
        if _log:
            _log.close()
            _log = None

def load(model_path, progress, cancelled):
    global _process,_model,_port,_log,_key,_idle_timer
    with _lock:
        if _idle_timer:
            _idle_timer.cancel()
            _idle_timer=None
        if _process and _process.poll() is None and _model == model_path:
            return f'http://127.0.0.1:{_port}/v1'
        available = {m['id'] for m in discover()}
        if model_path not in available:
            raise ValueError('本地模型未找到，请在模型设置中扫描或添加模型目录。')
        unload()
        # The optional local media bridge may retain weights after its queue drains.
        # Release only through its guarded API; never terminate another user's job.
        try:
            while True:
                if cancelled():raise InterruptedError('任务已取消')
                response=httpx.post('http://127.0.0.1:7870/api/v1/system/release-model',timeout=20,trust_env=False)
                if response.status_code!=409:
                    response.raise_for_status()
                    break
                progress('等待本地媒体任务释放显存',None)
                time.sleep(2)
        except httpx.ConnectError:
            pass
        except httpx.HTTPError as exc:
            raise ValueError('无法确认本地媒体引擎已释放显存，请检查引擎状态后重试') from exc
        executable = Path(get_setting('llama_executable',str(MAESTRO/'ckpts'/'llm'/'bin'/'llama-server.exe')))
        if not executable.is_file():
            raise ValueError('未找到 llama-server，请在设置中指定本地运行程序。')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            _port = sock.getsockname()[1]
        _log = (DATA/'logs'/'llama-server.log').open('w',encoding='utf-8')
        _key=secrets.token_urlsafe(32)
        args = [str(executable),'-m',model_path,'--host','127.0.0.1','--port',str(_port),'-c',str(get_setting('llama_context',8192)),'-ngl',('auto' if int(get_setting('llama_gpu_layers',-1)) in (-1,99) else str(get_setting('llama_gpu_layers'))),'--jinja','--api-key',_key]
        _process = subprocess.Popen(args,stdout=_log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        _model = model_path
        progress('加载本地文本模型',None)
        with httpx.Client(timeout=2,trust_env=False) as client:
            for _ in range(300):
                if cancelled():
                    unload()
                    raise InterruptedError('任务已取消')
                if _process.poll() is not None:
                    raise RuntimeError('文本模型加载失败，请查看 data/logs/llama-server.log；可能是显存或模型格式不兼容。')
                try:
                    if client.get(f'http://127.0.0.1:{_port}/health').status_code == 200:
                        return f'http://127.0.0.1:{_port}/v1'
                except httpx.HTTPError:
                    pass
                time.sleep(1)
        unload()
        raise TimeoutError('文本模型加载超过五分钟，请选择更小的模型。')

_maestro_process = None
_maestro_lock = threading.Lock()
def start_maestro():
    with _maestro_lock:
        return _start_maestro()

def _start_maestro():
    global _maestro_process
    try:
        if httpx.get('http://127.0.0.1:7870/api/v1/system-stats',timeout=3,trust_env=False).is_success:
            return {'status':'ready'}
    except httpx.HTTPError:
        pass
    if _maestro_process and _maestro_process.poll() is None:
        return {'status':'starting'}
    python = INFERENCE_ENV/'Scripts'/'python.exe'
    if not python.is_file():
        raise ValueError('未找到本项目的独立推理环境，请先运行模型引擎安装。')
    log = (DATA/'logs'/'inference-engine.log').open('a',encoding='utf-8')
    env = {**os.environ,'SERVER_NAME':'127.0.0.1','SERVER_PORT':'7870','PYTHONUTF8':'1','PYTHONUNBUFFERED':'1'}
    _maestro_process = subprocess.Popen([str(python),'launch.py'],cwd=MAESTRO,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    log.close()
    return {'status':'starting'}
