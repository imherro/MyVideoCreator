import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {Plus,Save,Camera,Trash2} from 'lucide-react';
import {frameRatio} from './compositionNodes';
import {cameraPosition,describeStage,type Stage,type StageObject} from './directorScene';

export function DirectorStage({stage,onChange,newId,onCapture,ratio='16:9'}:{stage:Stage;ratio?:string;onChange:(stage:Stage)=>void;newId:()=>string;onCapture:(blob:Blob,prompt:string)=>Promise<void>}){
 const aspect=frameRatio(ratio);
 const mount=useRef<HTMLDivElement>(null),capture=useRef<(()=>Promise<Blob>)|undefined>(undefined);
 const [selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const api=useRef<{scene:THREE.Scene;camera:THREE.PerspectiveCamera;renderer:THREE.WebGLRenderer;objects:THREE.Group;grid:THREE.GridHelper;render:()=>void}|null>(null);
 useEffect(()=>{
  const host=mount.current;if(!host)return;
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})}catch{setError('浏览器无法启动 WebGL，请开启硬件加速或使用支持 WebGL 的浏览器');return}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));host.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#202730');
  const camera=new THREE.PerspectiveCamera(45,aspect,.1,200),objects=new THREE.Group();scene.add(objects);
  scene.add(new THREE.HemisphereLight(0xffffff,0x333344,2));const light=new THREE.DirectionalLight(0xffecc9,3);light.position.set(-5,8,6);scene.add(light);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:'#363d43',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.01;scene.add(ground);
  const grid=new THREE.GridHelper(30,30,0x86939c,0x4d5963);scene.add(grid);
  const render=()=>renderer.render(scene,camera);api.current={scene,camera,renderer,objects,grid,render};
  const resize=()=>{const width=Math.min(host.clientWidth,window.innerHeight*.55*aspect);renderer.setSize(width,width/aspect);render()};const observer=new ResizeObserver(resize);observer.observe(host);window.addEventListener("resize",resize);resize();
  capture.current=async()=>{const size=renderer.getSize(new THREE.Vector2()),ratio=renderer.getPixelRatio();const highlights:{material:THREE.MeshStandardMaterial;color:THREE.Color}[]=[];objects.traverse(o=>{if(o instanceof THREE.Mesh&&o.material instanceof THREE.MeshStandardMaterial){highlights.push({material:o.material,color:o.material.emissive.clone()});o.material.emissive.set(0)}});grid.visible=false;renderer.setPixelRatio(1);renderer.setSize(aspect>=1?1280:Math.round(1280*aspect),aspect>=1?Math.round(1280/aspect):1280,false);render();try{return await new Promise<Blob>((resolve,reject)=>renderer.domElement.toBlob(b=>b?resolve(b):reject(new Error('构图截图失败')),'image/png'))}finally{highlights.forEach(h=>h.material.emissive.copy(h.color));grid.visible=true;renderer.setPixelRatio(ratio);renderer.setSize(size.x,size.y);render()}};
  const raycaster=new THREE.Raycaster();const pick=(event:PointerEvent)=>{const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);const hit=raycaster.intersectObjects(objects.children,true)[0];if(hit){let object=hit.object;while(object.parent&&object.parent!==objects)object=object.parent;setSelected(object.userData.id)}};
  renderer.domElement.addEventListener('pointerdown',pick);
  return()=>{window.removeEventListener("resize",resize);observer.disconnect();renderer.domElement.removeEventListener('pointerdown',pick);scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose())}});grid.geometry.dispose();(grid.material as THREE.Material).dispose();renderer.dispose();renderer.domElement.remove();api.current=null;capture.current=undefined};
 },[aspect]);
 useEffect(()=>{
  const engine=api.current;if(!engine)return;
  for(const object of [...engine.objects.children]){object.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose()}});engine.objects.remove(object)}
  for(const item of stage.objects){
   const group=new THREE.Group();group.userData.id=item.id;group.position.set(item.x,0,item.z);group.rotation.y=item.rotation*Math.PI/180;
   const material=new THREE.MeshStandardMaterial({color:item.color,roughness:.7,emissive:item.id===selected?0x332813:0x000000});
   if(item.shape==='actor'){
    const body=new THREE.Mesh(new THREE.CylinderGeometry(item.width*.35,item.width*.48,item.height*.7,20),material);body.position.y=item.height*.35;group.add(body);
    const head=new THREE.Mesh(new THREE.SphereGeometry(item.height*.15,20,16),material.clone());head.position.y=item.height*.85;group.add(head);
    const marker=new THREE.Mesh(new THREE.ConeGeometry(item.width*.12,item.width*.35,12),material.clone());marker.rotation.x=Math.PI/2;marker.position.set(0,item.height*.85,item.width*.4);group.add(marker);
   }else{const box=new THREE.Mesh(new THREE.BoxGeometry(item.width,item.height,item.depth),material);box.position.y=item.height/2;group.add(box)}
   engine.objects.add(group);
  }
  const p=cameraPosition(stage.camera);engine.camera.position.set(p.x,p.y,p.z);engine.camera.lookAt(0,stage.camera.targetHeight,0);engine.camera.fov=stage.camera.fov;engine.camera.updateProjectionMatrix();engine.render();
 },[stage,selected,aspect]);
 const object=stage.objects.find(o=>o.id===selected);
 const edit=(patch:Partial<StageObject>)=>onChange({...stage,objects:stage.objects.map(o=>o.id===selected?{...o,...patch}:o)});
 const add=(shape:StageObject['shape'])=>{const id=newId();onChange({...stage,objects:[...stage.objects,{id,name:shape==='actor'?'新角色':'场景物体',shape,x:stage.objects.length%3-1,z:0,width:.6,height:shape==='actor'?1.7:1,depth:.6,color:shape==='actor'?'#c99d63':'#6d98b4',rotation:0}]});setSelected(id)};
 return <section className="director-stage"><div className="section-title"><div><span className="eyebrow">3D DIRECTOR</span><h2>布置场景与机位</h2></div><button disabled={stage.objects.length>=50} onClick={()=>add('actor')}><Plus size={15}/>角色</button><button disabled={stage.objects.length>=50} onClick={()=>add('box')}><Plus size={15}/>场景物体</button></div>{error&&<p className="error">{error}</p>}
 <div className="director-layout"><div><div ref={mount} className="director-viewport"/><p className="muted">点击占位物编辑位置。地面网格每格 1 米，保存参考图时自动隐藏。场景和机位保存在当前构图节点中。</p><button className="primary" disabled={busy||!stage.objects.length} onClick={async()=>{if(!capture.current)return;setBusy(true);setError('');try{await onCapture(await capture.current(),describeStage(stage))}catch(e:any){setError(e.message)}finally{setBusy(false)}}}><Camera size={16}/>{busy?'保存中':'保存构图参考图'}</button></div>
 <div className="director-properties"><h3>摄影机</h3>{([['yaw','水平角',-180,180,1],['pitch','俯仰角',-10,80,1],['distance','距离（米）',2,30,.1],['targetHeight','视线高度（米）',0,5,.1],['fov','垂直视角',20,100,1]] as const).map(([key,label,min,max,step])=><label key={key}>{label} · {stage.camera[key]}<input type="range" min={min} max={max} step={step} value={stage.camera[key]} onChange={e=>onChange({...stage,camera:{...stage.camera,[key]:Number(e.target.value)}})}/></label>)}
 <button disabled={stage.views.length>=20} onClick={()=>onChange({...stage,views:[...stage.views,{id:newId(),name:`机位 ${stage.views.length+1}`,camera:{...stage.camera}}]})}><Save size={14}/>保存机位</button>{stage.views.map(v=><div className="settings-actions" key={v.id}><button onClick={()=>onChange({...stage,camera:{...v.camera}})}>{v.name}</button><button aria-label={'删除'+v.name} onClick={()=>onChange({...stage,views:stage.views.filter(x=>x.id!==v.id)})}><Trash2 size={13}/></button></div>)}
 <h3>场景物体</h3><select aria-label="选择场景物体" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择物体</option>{stage.objects.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>
 {object&&<><label>名称<input value={object.name} onChange={e=>edit({name:e.target.value})}/></label>{(['x','z','width','height','depth','rotation'] as const).map(key=><label key={key}>{{x:'左右位置',z:'前后位置',width:'宽度',height:'高度',depth:'深度',rotation:'朝向角度'}[key]}<input type="number" step={key==='rotation'?5:.1} min={['width','height','depth'].includes(key)?.1:-30} max={key==='rotation'?360:30} value={object[key]} onChange={e=>{const value=Number(e.target.value);if(Number.isFinite(value))edit({[key]:Math.max(['width','height','depth'].includes(key)?.1:-360,Math.min(360,value))})}}/></label>)}<label>颜色<input type="color" value={object.color} onChange={e=>edit({color:e.target.value})}/></label><button onClick={()=>{onChange({...stage,objects:stage.objects.filter(o=>o.id!==selected)});setSelected('')}}><Trash2 size={14}/>移除物体</button></>}
 </div></div></section>;
}
