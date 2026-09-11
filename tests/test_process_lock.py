import subprocess
import sys
import pytest
from backend.process_lock import ProcessLock

def test_other_process_cannot_acquire_and_exit_releases_lock(tmp_path):
    path=tmp_path/'worker.lock'
    child=subprocess.Popen([sys.executable,'-c',
        'import sys;from backend.process_lock import ProcessLock;p=ProcessLock(sys.argv[1]);p.acquire();print("owned",flush=True);sys.stdin.readline()',str(path)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        assert child.stdout.readline().strip()=='owned'
        contender=ProcessLock(path)
        with pytest.raises(RuntimeError,match='已有任务进程'):contender.acquire()
        child.terminate();child.wait(timeout=5)
        # Kernel ownership ends even though the lock file remains on disk.
        assert path.exists()
        contender.acquire();contender.release()
    finally:
        if child.poll() is None:child.kill();child.wait(timeout=5)

def test_release_does_not_erase_another_lock_owner(tmp_path):
    path=tmp_path/'worker.lock';first=ProcessLock(path);second=ProcessLock(path)
    first.acquire()
    with pytest.raises(RuntimeError):second.acquire()
    second.release()
    with pytest.raises(RuntimeError):second.acquire()
    first.release();second.acquire();second.release()
