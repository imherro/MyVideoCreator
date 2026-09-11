import httpx,pytest
from backend.worker import checked
@pytest.mark.parametrize('status,hint',[(401,'API Key'),(402,'额度不足'),(429,'限流或配额'),(422,'输入参数'),(503,'供应商状态')])
def test_service_errors_include_action_without_retry(status,hint):
    response=httpx.Response(status,json={'error':{'message':'provider detail'}})
    with pytest.raises(ValueError) as exc:checked(response)
    assert hint in str(exc.value)
    assert 'provider detail' in str(exc.value)
