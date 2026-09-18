import {Trash2,Copy} from 'lucide-react';
type Value=Record<string,any>;
export function CompositionInspector({node,assets,sourceAssetId,onPatch,onEdit,onGenerate,onDuplicate,onDelete}:{
  node:Value;assets:Value[];sourceAssetId:string;onPatch:(patch:Value)=>void;onEdit:()=>void;onGenerate:()=>void;onDuplicate:()=>void;onDelete:()=>void;
}) {
  const panorama=node.data.compositionType==='panorama';
  return <aside className="inspector composition-inspector"><div className="inspector-title"><b>{panorama?'全景场景':'3D 构图'}</b></div><div className="inspector-scroll">
    <label>节点名称<input value={node.data.label} onChange={e=>onPatch({label:e.target.value})}/></label>
    {panorama && <><label>全景原图<select value={node.data.composition?.sourceAssetId || ''} onChange={e=>onPatch({composition:{...node.data.composition,sourceAssetId:e.target.value}})}><option value="">{node.data.composition?.sourceNodeId?'使用关联生成节点的结果':'选择已有的 2:1 全景图'}</option>{assets.filter(a=>a.kind==='image').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><button onClick={onGenerate}>{node.data.composition?.sourceNodeId?'打开全景生成节点':'创建全景生成节点'}</button><p className="muted">原图使用 2:1 全景格式，取景输出默认跟随项目资产画幅。</p></>}
    <button className="primary full" disabled={panorama&&!sourceAssetId} onClick={onEdit}>{panorama?'编辑全景取景':'编辑 3D 构图'}</button>
    <p className="muted">保存后自动建立构图参考图节点。请从参考图节点连到分镜图，角色与场景外观仍使用各自的资产参考。</p>
  </div><div className="inspector-bottom"><button title="复制构图节点" onClick={onDuplicate}><Copy size={16}/></button><button title="移除构图节点" onClick={onDelete}><Trash2 size={16}/></button></div></aside>;
}
