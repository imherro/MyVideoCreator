"""OS-owned lock; stale files never imply a live owner."""
import os
from pathlib import Path

class ProcessLock:
    def __init__(self,path):
        self.path=Path(path)
        self.file=None

    def acquire(self):
        if self.file:raise RuntimeError('任务进程锁已持有')
        self.path.parent.mkdir(parents=True,exist_ok=True)
        handle=self.path.open('a+b')
        try:
            if handle.seek(0,2)==0:
                handle.write(b'0');handle.flush()
            handle.seek(0)
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError as exc:
            handle.close()
            raise RuntimeError('此工作室已有任务进程运行。请使用已有服务，不要对同一数据目录启动多个 worker。') from exc
        self.file=handle

    def release(self):
        if not self.file:return
        handle,self.file=self.file,None
        try:
            handle.seek(0)
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(),fcntl.LOCK_UN)
        finally:handle.close()
