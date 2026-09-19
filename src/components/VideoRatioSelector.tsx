import {supportsMotionReference} from '../motionReference.ts';
type Value=Record<string,any>;
const ratios=['21:9','16:9','4:3','1:1','3:4','9:16','adaptive'];
export function VideoRatioSelector({document,data,provider,mode,onChange}:{document:Value;data:Value;provider?:Value;mode:string;onChange:(patch:Value)=>void}) {
 const strict=['first_frame','first_last_frame'].includes(mode),supported=supportsMotionReference(provider,data.model);
 const options=ratios.filter(r=>!(r==='21:9'&&['wan3.0-video','alibaba/wan-3.0'].includes(data.model)));
 const inherited=document.videoRatio||document.ratio||'16:9';
 return <label>视频画幅<select aria-label="视频画幅" value={strict?'first_frame':data.videoRatio||''} disabled={strict} onChange={e=>onChange({videoRatio:e.target.value||null})}>{strict?<option value="first_frame">跟随首帧</option>:<><option value="">继承项目（{inherited}）</option>{data.videoRatio&&!options.includes(data.videoRatio)&&<option disabled value={data.videoRatio}>{data.videoRatio}（当前模型不支持）</option>}{options.map(r=><option key={r} value={r} disabled={!supported}>{r==='adaptive'?'自适应':r}</option>)}</>}</select>{strict&&<small>输出跟随首帧；切换多模态参考后可单独选择比例。</small>}{!strict&&!supported&&<small>当前模型暂未开放单镜比例设置。</small>}</label>
}
export function videoDimensions(asset?:Value){const w=Number(asset?.metadata?.width),h=Number(asset?.metadata?.height);if(!w||!h)return '';let a=w,b=h;while(b){const t=b;b=a%b;a=t}return `${w/a}:${h/a} · ${w}×${h}`;}
