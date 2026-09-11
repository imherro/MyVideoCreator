from backend import app as api

def test_owned_catalogue_starts_engine_without_contacting_unready_server(monkeypatch):
    provider={'id':'owned','type':'maestro','local':True,'auto_start':True,'url':'http://127.0.0.1:7870','kind':'image'}
    monkeypatch.setattr(api.s,'get_setting',lambda *args:[provider])
    calls=[]
    monkeypatch.setattr(api.runtime,'start_maestro',lambda:calls.append(True) or {'status':'starting'})
    assert api.provider_models('owned')=={'models':[],'status':'starting'}
    assert calls==[True]
