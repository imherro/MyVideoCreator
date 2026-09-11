"""Real FFmpeg export integration; not a mocked renderer."""
import io
import subprocess
from pathlib import Path
from PIL import Image
from backend import store as s, runtime
from backend.worker import Worker,register
import time

def test_real_export_two_stills_and_decode():
    s.init()
    binaries=list((runtime.INFERENCE_ENV/'Lib'/'site-packages'/'imageio_ffmpeg'/'binaries').glob('ffmpeg*.exe'))
    if not binaries:
        import shutil,pytest
        if not shutil.which('ffmpeg'): pytest.skip('FFmpeg not installed')
        ffmpeg='ffmpeg'
    else: ffmpeg=str(binaries[0])
    s.set_setting('ffmpeg',ffmpeg)
    pid=s.uid();jid=s.uid();now=time.time()
    with s.db() as c:
        c.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,'Export integration','{}',now,now))
        c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',(jid,jid,pid,'export','export','running','{}',now,now))
    job={'id':jid,'project_id':pid,'node_id':'export','kind':'export','input':{}}
    timeline=[]
    for color in ('red','blue'):
        image=s.DATA/(s.uid()+'.png');Image.new('RGB',(64,64),color).save(image)
        asset=register(job,image,'frame.png');image.unlink()
        timeline.append({'asset_id':asset['id'],'duration':.5,'start':0})
    job['input']={'timeline':timeline,'resolution':'128x128'}
    result=Worker().export(job)
    assert result['assets'][0]['kind']=='video'
    with s.db() as c:
        file=s.ASSETS/c.execute('SELECT path FROM assets WHERE id=?',(result['assets'][0]['id'],)).fetchone()['path']
    assert file.stat().st_size>500
    frames=[]
    for offset in ('0.1','0.7'):
        response=subprocess.run([ffmpeg,'-v','error','-ss',offset,'-i',str(file),'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,timeout=30)
        assert response.returncode==0,response.stderr
        assert len(response.stdout)==3
        frames.append(tuple(response.stdout))
    assert frames[0][0]>frames[0][2]+150,frames
    assert frames[1][2]>frames[1][0]+150,frames

def test_export_original_audio_music_subtitle_and_mute():
    import array,math
    from backend.media import ffmpeg_executable,probe
    s.init();ffmpeg=ffmpeg_executable()
    pid=s.uid();now=time.time()
    with s.db() as c:c.execute('INSERT INTO projects VALUES(?,?,1,?,?,?)',(pid,'Sound and subtitle','{}',now,now))
    def job():
        jid=s.uid()
        with s.db() as c:c.execute('INSERT INTO jobs(id,submission_id,project_id,node_id,kind,status,input,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',(jid,jid,pid,'export','export','running','{}',now,now))
        return {'id':jid,'project_id':pid,'node_id':'export','kind':'export','input':{}}
    source=s.DATA/(s.uid()+'.mp4');music=s.DATA/(s.uid()+'.wav');base=job()
    for args in (
        ['-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',str(source)],
        ['-f','lavfi','-i','sine=frequency=880:duration=0.3',str(music)],
    ):
        response=subprocess.run([ffmpeg,'-y','-v','error',*args],capture_output=True,timeout=30)
        assert response.returncode==0,response.stderr
    video=register(base,source);audio=register(base,music);source.unlink();music.unlink()
    sid=s.uid();subtitle=s.ASSETS/(sid+'.srt')
    subtitle.write_text('1\n00:00:00,000 --> 00:00:01,000\nTEST\n',encoding='utf-8')
    with s.db() as c:c.execute('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)',(sid,pid,'test.srt','subtitle',subtitle.name,'application/x-subrip','{}',now))
    amplitudes=[]
    for volume in (1,0):
        current=job();current['input']={'timeline':[{'asset_id':video['id'],'duration':1,'volume':volume}], 'resolution':'320x180','audio_id':audio['id'],'music_volume':.5,'subtitle_id':sid,'transition':'fade'}
        result=Worker().export(current)
        with s.db() as c:path=s.ASSETS/c.execute('SELECT path FROM assets WHERE id=?',(result['assets'][0]['id'],)).fetchone()['path']
        info=probe(path);assert info['has_audio'] and .95<info['duration']<1.2
        pcm=subprocess.run([ffmpeg,'-v','error','-ss','0.2','-i',str(path),'-t','0.6','-vn','-ac','1','-ar','8000','-f','f32le','-'],capture_output=True,timeout=30)
        assert pcm.returncode==0
        samples=array.array('f',pcm.stdout)
        def amplitude(hz):
            real=sum(x*math.cos(2*math.pi*hz*i/8000) for i,x in enumerate(samples))
            imag=sum(x*math.sin(2*math.pi*hz*i/8000) for i,x in enumerate(samples))
            return math.hypot(real,imag)*2/len(samples)
        amplitudes.append((amplitude(440),amplitude(880)))
        frame=subprocess.run([ffmpeg,'-v','error','-ss','0.5','-i',str(path),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True,timeout=30)
        assert frame.returncode==0
        # A blue source has no white pixels; the burned subtitle must be visible.
        assert sum(min(frame.stdout[i:i+3])>180 for i in range(0,len(frame.stdout),3))>30
    assert amplitudes[0][0]>.02,amplitudes
    assert amplitudes[1][0]<amplitudes[0][0]/10,amplitudes
    assert all(a[1]>.01 for a in amplitudes),amplitudes
