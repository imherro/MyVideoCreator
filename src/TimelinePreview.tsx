import {useEffect,useRef,useState} from 'react';
import {Play,Pause,X} from 'lucide-react';
import {timelineDuration,timelinePosition,type Clip} from './timeline';
type Asset={id:string;url:string;kind:string;name:string;metadata:Record<string,any>};
export function TimelinePreview({clips,assets,audioId,musicVolume,transition,ratio,onClose}:{clips:Clip[];assets:Asset[];audioId?:string;musicVolume:number;transition:string;ratio:string;onClose:()=>void}){
 const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[error,setError]=useState('');
 const video=useRef<HTMLVideoElement>(null),music=useRef<HTMLAudioElement>(null);
 const duration=timelineDuration(clips),position=timelinePosition(clips,time);
 const asset=assets.find(a=>a.id===position?.clip.asset_id),audio=assets.find(a=>a.id===audioId);
 useEffect(()=>{if(!playing)return;let last=performance.now(),frame=0;const tick=(now:number)=>{const elapsed=(now-last)/1000;last=now;setTime(t=>Math.min(duration,t+elapsed));frame=requestAnimationFrame(tick)};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame)},[playing,duration]);
 useEffect(()=>{if(time>=duration)setPlaying(false)},[time,duration]);
 useEffect(()=>{const stop=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',stop);return()=>window.removeEventListener('keydown',stop)},[onClose]);
 useEffect(()=>{
   const element=video.current;
   if(!element||!position)return;
   element.volume=Math.max(0,Math.min(1,position.clip.volume??1));
   const target=Number(position.clip.start||0)+position.offset;
   if(element.readyState>=1&&Math.abs(element.currentTime-target)>.25)element.currentTime=target;
   if(playing&&element.paused)element.play().catch(()=>{setPlaying(false);setError('无法播放当前视频，请检查素材或点击播放重试')});
   if(!playing)element.pause();
 },[time,playing,position?.index,asset?.id]);
 useEffect(()=>{
   const element=music.current;if(!element)return;
   element.volume=Math.max(0,Math.min(1,musicVolume));
   if(Number.isFinite(element.duration)&&element.duration>0){const target=time%element.duration;if(Math.abs(element.currentTime-target)>.3)element.currentTime=target}
   if(playing&&element.paused)element.play().catch(()=>{setPlaying(false);setError('配乐播放失败，请点击播放重试')});
   if(!playing)element.pause();
 },[time,playing,audioId,musicVolume]);
 const fade=position?Math.min(.3,position.duration/4):.3;
 const opacity=transition==='fade'&&position?Math.max(0,Math.min(1,position.offset/fade,(position.duration-position.offset)/fade)):1;
 return <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="时间线预览"><div className="timeline-preview"><div className="panel-title"><h2>时间线预览</h2><button className="icon-button" aria-label="关闭预览" onClick={onClose}><X/></button></div>
 <div className="timeline-screen" style={{aspectRatio:ratio.replace(':','/')}}>{asset?.kind==='video'?<video key={position?.clip.id} ref={video} src={asset.url} style={{opacity}} playsInline preload="auto" onLoadedMetadata={e=>{e.currentTarget.currentTime=Number(position?.clip.start||0)+(position?.offset||0)}} onWaiting={()=>{setPlaying(false);setError('素材缓冲中，加载完成后可继续播放')}} onCanPlay={()=>setError('')} onError={()=>{setPlaying(false);setError('视频素材无法读取')}}/>:asset?.kind==='image'?<img src={asset.url} alt={asset.name} style={{opacity}}/>:<p>当前镜头素材不可用</p>}</div>
 {audio&&<audio ref={music} src={audio.url} loop preload="auto"/>}
 <div className="preview-controls"><button className="primary" disabled={!position} onClick={()=>{if(time>=duration)setTime(0);setError('');setPlaying(!playing)}}>{playing?<Pause size={16}/>:<Play size={16}/>} {playing?'暂停':'播放'}</button><input aria-label="预览位置" type="range" min="0" max={duration} step="0.01" value={time} onChange={e=>{setTime(Number(e.target.value));setError('')}}/><span>{time.toFixed(2)} / {duration.toFixed(2)} 秒</span></div>
 <p className="muted">镜头 {(position?.index||0)+1} / {clips.length} · {asset?.name}。预览包含原声、配乐和淡入淡出，字幕请以导出成片为准。</p>{error&&<p className="error">{error}</p>}
 </div></div>;
}
