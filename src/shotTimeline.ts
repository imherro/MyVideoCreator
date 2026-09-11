import type {Clip} from './timeline';
type Value=Record<string,any>;
export function planShotTimeline(shots:Value[],nodes:Value[],assets:Value[],newId:()=>string){
 const clips:Clip[]=[],issues:string[]=[];
 for(const [index,shot] of shots.entries()){
  const label=`第 ${index+1} 镜`;const node=nodes.find(n=>n.id===shot.videoNode);
  const asset=assets.find(a=>a.id===node?.data.assetId&&a.kind==='video');
  if(!node||!asset){issues.push(`${label}缺少已生成视频`);continue}
  if(node.data.stale||shot.prompts_need_review){issues.push(`${label}输入已变更，请核对并重新生成`);continue}
  const duration=Number(shot.duration),actual=Number(asset.metadata?.duration);
  if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(actual)||actual<=0){issues.push(`${label}时长无效`);continue}
  if(duration>actual+.08){issues.push(`${label}需要 ${duration} 秒，素材仅 ${actual.toFixed(2)} 秒`);continue}
  clips.push({id:newId(),asset_id:asset.id,start:0,duration:Math.min(duration,actual),volume:1});
 }
 return {clips,issues};
}
