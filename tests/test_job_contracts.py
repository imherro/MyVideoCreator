from backend.job_contracts import freeze_prompt_contract


def test_media_jobs_freeze_debuggable_system_prompt_contracts():
    for kind in ('image', 'video'):
        frozen = freeze_prompt_contract(kind, {'prompt': '测试镜头'})
        assert frozen['system_prompt']
        assert frozen['schema_version'] == f'{kind}-generation/v1'
        assert frozen['prompt_contract_origin'] == 'submission'

