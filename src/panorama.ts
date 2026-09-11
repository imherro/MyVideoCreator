export function panoramaUV(x:number,y:number,aspect:number,fov:number,yaw:number,pitch:number){
 const radians=Math.PI/180,t=Math.tan(fov*radians/2);
 const rx=x*t,ry=-y*t/aspect,rz=1;
 const p=pitch*radians,a=yaw*radians;
 const py=ry*Math.cos(p)+rz*Math.sin(p),pz=rz*Math.cos(p)-ry*Math.sin(p);
 const dx=rx*Math.cos(a)+pz*Math.sin(a),dz=pz*Math.cos(a)-rx*Math.sin(a);
 const length=Math.hypot(dx,py,dz);
 return {u:((Math.atan2(dx,dz)/(2*Math.PI)+.5)%1+1)%1,v:.5-Math.asin(py/length)/Math.PI};
}
export function projectPanorama(source:{width:number;height:number;data:Uint8ClampedArray},width:number,height:number,fov:number,yaw:number,pitch:number){
 const output=new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const uv=panoramaUV((x+.5)/width*2-1,(y+.5)/height*2-1,width/height,fov,yaw,pitch);
  const sx=uv.u*source.width-.5,sy=Math.max(0,Math.min(source.height-1,uv.v*source.height-.5));
  const x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0;
  const index=(x:number,y:number)=>(y*source.width+((x%source.width)+source.width)%source.width)*4;
  for(let channel=0;channel<3;channel++){
   const top=source.data[index(x0,y0)+channel]*(1-fx)+source.data[index(x0+1,y0)+channel]*fx;
   const bottom=source.data[index(x0,Math.min(y0+1,source.height-1))+channel]*(1-fx)+source.data[index(x0+1,Math.min(y0+1,source.height-1))+channel]*fx;
   output[(y*width+x)*4+channel]=top*(1-fy)+bottom*fy;
  }
  output[(y*width+x)*4+3]=255;
 }
 return output;
}
