from backend import runtime,store

def test_native_defaults_preserve_custom_services_and_use_existing_encoder(monkeypatch):
    settings={'providers':[{'id':'custom-cloud','type':'video_api'},{'id':'maestro-image','model':'old'}]}
    monkeypatch.setattr(runtime,'get_setting',lambda key,default=None:settings.get(key,default))
    monkeypatch.setattr(store,'set_setting',lambda key,value:settings.__setitem__(key,value))
    runtime.bootstrap()
    providers={p['id']:p for p in settings['providers']}
    assert 'custom-cloud' in providers
    assert providers['maestro-image']['model']=='flux2_klein_base_9b'
    assert providers['maestro-image']['parameters']['activated_loras']==['Flux_Klein_9B_NSFW.safetensors']
    assert providers['maestro-video']['parameters']['minimax_h3_text_encoder']=='gguf_q2_k'
    assert providers['maestro-video']['url']=='http://127.0.0.1:7870'
    assert runtime.ENGINE.is_relative_to(store.ROOT)
    assert runtime.INFERENCE_ENV.is_relative_to(store.ROOT)
    providers['maestro-image']['name']='User name'
    runtime.bootstrap()
    assert settings['providers'][0]['name']=='User name'
