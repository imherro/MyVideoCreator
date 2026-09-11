export type StageObject={id:string;name:string;shape:'actor'|'box';x:number;z:number;width:number;height:number;depth:number;color:string;rotation:number};
export type StageCamera={yaw:number;pitch:number;distance:number;fov:number;targetHeight:number};
export type Stage={objects:StageObject[];camera:StageCamera;views:{id:string;name:string;camera:StageCamera}[]};
export const defaultStage=():Stage=>({objects:[],camera:{yaw:25,pitch:12,distance:8,fov:45,targetHeight:1},views:[]});
export function cameraPosition(camera:StageCamera){
 const yaw=camera.yaw*Math.PI/180,pitch=camera.pitch*Math.PI/180;
 return {x:Math.sin(yaw)*Math.cos(pitch)*camera.distance,y:camera.targetHeight+Math.sin(pitch)*camera.distance,z:Math.cos(yaw)*Math.cos(pitch)*camera.distance};
}
export function describeStage(stage:Stage){
 const c=stage.camera;
 return `使用参考图的空间构图与主体位置，替换占位几何体为真实角色和环境，不保留网格或辅助线。摄影机：水平角 ${c.yaw}°，俯仰 ${c.pitch}°，距离 ${c.distance} 米，水平构图以镜头预览为准，垂直视角 ${c.fov}°。\n场景占位：\n`+stage.objects.map(o=>`${o.name}：位置 (${o.x}, ${o.z}) 米，高 ${o.height} 米，朝向 ${o.rotation}°。`).join('\n');
}
