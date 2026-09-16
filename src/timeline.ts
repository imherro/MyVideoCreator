export type Clip={id:string;asset_id:string;start:number;duration:number;volume?:number};
export function timelinePosition(clips:Clip[],time:number){
  let begin=0;
  for(let index=0;index<clips.length;index++){
    const duration=Math.max(.1,Number(clips[index].duration)||.1);
    if(time<begin+duration||index===clips.length-1){
      return {index,clip:clips[index],offset:Math.max(0,Math.min(duration,time-begin)),begin,duration};
    }
    begin+=duration;
  }
  return null;
}
export function timelineDuration(clips:Clip[]){return clips.reduce((sum,c)=>sum+Math.max(.1,Number(c.duration)||.1),0)}

export function timelinePreviewWindow(clips:Clip[],currentIndex:number){
  return [currentIndex-1,currentIndex,currentIndex+1]
    .filter(index=>index>=0&&index<clips.length)
    .map(index=>({index,slot:((index%3)+3)%3,clip:clips[index]}));
}
