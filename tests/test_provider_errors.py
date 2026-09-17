import httpx,pytest
from backend.worker import checked
@pytest.mark.parametrize('status,hint',[(401,'API Key'),(402,'额度不足'),(429,'限流或配额'),(422,'输入参数'),(503,'供应商状态')])
def test_service_errors_include_action_without_retry(status,hint):
    response=httpx.Response(status,json={'error':{'message':'provider detail'}})
    with pytest.raises(ValueError) as exc:checked(response)
    assert hint in str(exc.value)
    assert 'provider detail' in str(exc.value)


def test_credential_normalization_and_errors_never_echo_keys():
    from backend.provider_auth import bearer_headers,clean_api_key,safe_provider_error
    from backend import store as s
    assert bearer_headers({'api_key':' \t test-key\r\n'})=={'Authorization':'Bearer test-key'}
    assert bearer_headers({})=={}
    for invalid in ['test-key\nother','test key','test\x00key','中文key']:
        with pytest.raises(ValueError) as exc:clean_api_key(invalid)
        assert invalid not in str(exc.value)
    message="Illegal header value b'Bearer test-key '"
    assert 'test-key' not in safe_provider_error(message)
    assert 'test-key' not in s.unpack({'error':message})['error']
    assert 'test-key' not in safe_provider_error('Bad authorization: Bearer test-key')


def test_local_protocol_error_fails_instead_of_claiming_recoverable_connection(monkeypatch):
    import time
    from backend import store as s
    from backend.worker import Worker
    s.init();worker=Worker();now=time.time();pid=s.uid('header-project-');jid=s.uid('header-job-')
    with s.db() as c:
        c.execute('INSERT INTO projects(id,name,revision,document,created,updated) VALUES(?,?,1,?,?,?)',(pid,'Header error','{}',now,now))
        c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',(jid,s.uid(),pid,'script','text','queued','{}',now,now))
    def fail(job):raise httpx.LocalProtocolError("Illegal header value b'Bearer test-secret '")
    original=s.job_update
    def update(job_id,**fields):
        result=original(job_id,**fields)
        if job_id==jid:worker.halt.set()
        return result
    monkeypatch.setattr(worker,'execute',fail)
    monkeypatch.setattr(s,'job_update',update)
    worker.loop()
    with s.db() as c:row=dict(c.execute('SELECT status,error,phase FROM jobs WHERE id=?',(jid,)).fetchone())
    assert row['status']=='failed'
    assert 'test-secret' not in row['error']
    assert '请求配置错误' in row['phase']
