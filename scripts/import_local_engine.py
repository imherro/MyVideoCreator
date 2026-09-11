"""One-time, non-commercial import. Runtime never needs the source project."""
import argparse,json,os,shutil,subprocess,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('source',type=Path);args=parser.parse_args()
    source=args.source.resolve();target=ROOT/'inference'/'engine';target.mkdir(parents=True,exist_ok=True)
    ignore=shutil.ignore_patterns('__pycache__','*.pyc','.git','.cache','node_modules')
    for name in ('models','shared','services','preprocessing','postprocessing','defaults','profiles','icons','plugins','recipes','finetunes','scripts','docs'):
        if (source/name).is_dir():shutil.copytree(source/name,target/name,dirs_exist_ok=True,ignore=ignore)
    for file in source.iterdir():
        if file.is_file() and (file.suffix=='.py' or file.name in ('LICENSE.txt','requirements.txt')):shutil.copy2(file,target/file.name)
    (target/'wgp_config.json').write_text(json.dumps({'studio_minimal_assets':True,'attention_mode':'auto','transformer_quantization':'int8','text_encoder_quantization':'int8','profile':4,'video_profile':4,'image_profile':4,'save_path':'outputs','image_save_path':'outputs','checkpoints_paths':['ckpts','.'],'preload_model_policy':[],'enable_int8_kernels':1},indent=2),encoding='utf-8')
    # Keep mutable configuration and source files as independent copies.
    launch=target/'launch.py';text=launch.read_text(encoding='utf-8')
    a=text.index('try:\n    import gradio as gr\n    from shared.utils.plugins import WAN2GPApplication')
    b=text.index('# ============================================================================\n# Serve React build',a)
    text=text[:a]+'from shared.utils.plugins import WAN2GPApplication\nwgp.app = WAN2GPApplication()\nprint("[Studio] Embedded inference API; classic UI is disabled.")\n\n'+text[b:]
    launch.write_text(text,encoding='utf-8')
    core=target/'wgp.py';text=core.read_text(encoding='utf-8')
    text=text.replace('    if file_type == 0:\n        shared_def = {','    if file_type == 0 and not server_config.get("studio_minimal_assets", False):\n        shared_def = {')
    core.write_text(text,encoding='utf-8')
    def weights(src,dst):
        if not src.exists():raise FileNotFoundError(src)
        if src.is_dir():
            for child in src.iterdir():
                if child.name not in ('.cache','__pycache__'):weights(child,dst/child.name)
        else:
            dst.parent.mkdir(parents=True,exist_ok=True)
            if not dst.exists():
                try:os.link(src,dst)
                except OSError:shutil.copy2(src,dst)
    for name in ('flux-2-klein-base-9b_quanto_bf16_int8.safetensors','flux2_vae.safetensors','MiniMax-H3-FL2VA-pruned_rank8_int8_convrot.safetensors','qwen3_8b'):
        weights(source/'ckpts'/name,target/'ckpts'/name)
    for name in ('processor','text_encoder','vae','qwen3vl-32B-MiniMax-H3-Q2_K.gguf'):
        weights(source/'ckpts'/'minimax_h3'/name,target/'ckpts'/'minimax_h3'/name)
    for name in ('bin','Qwen3.8-27B-Uncensored'):
        weights(source/'ckpts'/'llm'/name,target/'ckpts'/'llm'/name)
    weights(source/'loras'/'flux2_klein_9b'/'Flux_Klein_9B_NSFW.safetensors',target/'loras'/'flux2_klein_9b'/'Flux_Klein_9B_NSFW.safetensors')
    # A fresh venv has its own interpreter launchers and sys.prefix. Packages are
    # copied, not referenced through sys.path or a junction to the old project.
    cfg=(source/'env'/'pyvenv.cfg').read_text();home=next(line.split('=',1)[1].strip() for line in cfg.splitlines() if line.startswith('home'))
    env=ROOT/'.inference-env'
    if not (env/'Scripts'/'python.exe').exists():subprocess.run([str(Path(home)/'python.exe'),'-m','venv',str(env)],check=True)
    print('Copying independent inference packages...',flush=True)
    shutil.copytree(source/'env'/'Lib'/'site-packages',env/'Lib'/'site-packages',dirs_exist_ok=True,ignore=ignore)
    notice=ROOT/'inference'/'NOTICE.md'
    notice.write_text('# Local inference engine\n\nBased on Maestro and WanGP, imported for personal non-commercial study.\nUpstream Maestro revision: a5dddd4faa53e8fa8d76ef528c1074935eded8c0.\nThe imported source retains its original notices; see engine/LICENSE.txt and component license files.\nLocal modifications: disabled classic UI; separate configuration, checkpoints, environment and loopback service.\nModel files imported using NTFS hard links remain usable after removal of the source directory.\n',encoding='utf-8')
    print('Independent engine imported at',target,flush=True)

if __name__=='__main__':main()
