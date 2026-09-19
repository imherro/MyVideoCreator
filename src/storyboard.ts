import { updateShot } from "./shotSync.ts";
import { visualBibleOf, type FilmBibleDocument, type VisualKind } from "./filmBible/types.ts";

type Value = Record<string, any>;

export function shotIdentity(shot: Value) {
  return String(shot.uid || shot.id || "");
}

export function updateStoryboardShot<
  T extends FilmBibleDocument & { nodes: Value[]; edges: Value[] },
>(document: T, uid: string, patch: Value): T {
  const shot = document.shots.find((item) => shotIdentity(item) === uid);
  if (!shot) throw new Error("目标分镜不存在");
  return updateShot(document as any, shot.id, patch) as T;
}

export function moveStoryboardShot<T extends FilmBibleDocument>(
  document: T,
  uid: string,
  offset: -1 | 1,
): T {
  const shots = [...document.shots];
  const index = shots.findIndex((item) => shotIdentity(item) === uid);
  if (index < 0) throw new Error("目标分镜不存在");
  const target = index + offset;
  if (target < 0 || target >= shots.length) return document;
  [shots[index], shots[target]] = [shots[target], shots[index]];
  return { ...document, shots };
}

export function createStoryboardShot<T extends FilmBibleDocument>(
  document: T,
  newId: () => string,
): T {
  const uid = `shot-${newId()}`;
  return {
    ...document,
    shots: [
      ...document.shots,
      {
        id: uid,
        uid,
        compositionMode: 'direct',
        videoReferenceMode: (document as Value).videoReferenceMode && (document as Value).videoReferenceMode !== 'legacy' ? (document as Value).videoReferenceMode : 'multimodal',
        duration: 3,
        scene: "",
        characters: [],
        action: "",
        emotion: "",
        camera: "中景，固定机位",
        audio: "",
        image_prompt: "",
        video_prompt: "",
        assetBindings: { characters: [], scene: null, props: [] },
        pipeline: {},
      },
    ],
  };
}

export type ShotReferenceProjection = {
  group: "characters" | "scene" | "props";
  role: string;
  versionId: string;
  cardId: string;
  cardName: string;
  kind: VisualKind;
  version: number;
  status: string;
  primaryAssetId?: string;
};

export function projectShotReferences(
  document: FilmBibleDocument,
  shot: Value,
): ShotReferenceProjection[] {
  const visual = visualBibleOf(document);
  const bindings = shot.assetBindings || {};
  const grouped: Array<[ShotReferenceProjection["group"], Value[]]> = [
    ["characters", Array.isArray(bindings.characters) ? bindings.characters : []],
    ["scene", bindings.scene?.versionId ? [bindings.scene] : []],
    ["props", Array.isArray(bindings.props) ? bindings.props : []],
  ];
  return grouped.flatMap(([group, values]) =>
    values.flatMap((binding) => {
      const version = visual.versions[binding.versionId];
      const card = version ? visual.cards[version.cardId] : undefined;
      if (!version || !card) return [];
      const primary = version.references.find((item) => item.role === "primary");
      return [{
        group,
        role: String(binding.role || card.name),
        versionId: version.id,
        cardId: card.id,
        cardName: card.name,
        kind: card.kind,
        version: version.version,
        status: version.status,
        primaryAssetId: primary?.assetId,
      }];
    }),
  );
}

export function selectedShotImageNodeIds(document: FilmBibleDocument, uids: string[]) {
  const selected = new Set(uids);
  return document.shots
    .filter((shot) => selected.has(shotIdentity(shot)))
    .map((shot) => shot.imageNode || shot.pipeline?.imageNodeId)
    .filter((value): value is string => typeof value === "string" && Boolean(value));
}

export function selectedShotVideoNodeIds(document: FilmBibleDocument, uids: string[]) {
  const selected = new Set(uids);
  return document.shots
    .filter((shot) => selected.has(shotIdentity(shot)))
    .map((shot) => shot.videoNode || shot.pipeline?.videoNodeId)
    .filter((value): value is string => typeof value === "string" && Boolean(value));
}


/** Adopt an existing canvas video without creating/replacing any media node. */
export function adoptCanvasVideo<T extends FilmBibleDocument>(document:T,nodeId:string,newId:()=>string,position=document.shots.length):T {
  if(document.shots.some(s=>(s.videoNode||s.pipeline?.videoNodeId)===nodeId))return document;
  const node=document.nodes.find(n=>n.id===nodeId);
  if(!node||node.data.kind!=='video')throw new Error('请选择独立视频节点');
  const visual=visualBibleOf(document),bindings:Value={characters:[],scene:null,props:[]};
  const linked=new Set(document.edges.filter(e=>e.target===nodeId).map(e=>e.source));
  const seen=new Set<string>();
  for(const source of [...linked].map(id=>document.nodes.find(n=>n.id===id)).filter((n):n is Value=>!!n&&n.data.kind==='visual_asset')){
    const version=visual.versions[source.data.visualVersionId],card=version&&visual.cards[version.cardId];
    if(!version||!card||card.deletedAt)throw new Error('连入的视觉资产已不存在，请先移除无效连线');
    if(seen.has(version.id))continue;seen.add(version.id);
    const binding={versionId:version.id,role:card.name};
    if(['character','character_state'].includes(card.kind))bindings.characters.push(binding);
    else if(['scene','scene_state'].includes(card.kind)){
      if(bindings.scene)throw new Error('请只保留一个场景或场景状态，再加入分镜');
      bindings.scene={versionId:version.id};
    }else if(card.kind==='prop')bindings.props.push(binding);
  }
  const mode=String(document.videoReferenceMode||'legacy');
  const images=document.nodes.filter(n=>linked.has(n.id)&&n.data.kind==='image');
  if(mode!=='multimodal'&&images.length!==1)throw new Error('首帧模式请先连接一个图像节点，再加入分镜；多模态模式无需分镜图');
  const duration=Number(node.data.parameters?.duration??(Number(document.videoDuration)>0?document.videoDuration:5));
  if(!Number.isFinite(duration)||duration<=0)throw new Error('请先设置有效的视频时长');
  const uid=`shot-${newId()}`;
  const shot:Value={id:uid,uid,canvasSourceNodeId:nodeId,videoNode:nodeId,pipeline:{videoNodeId:nodeId},
    compositionMode:mode==='multimodal'?'direct':'preview',videoReferenceMode:mode==='legacy'?'legacy':undefined,duration,
    scene:bindings.scene?visual.cards[visual.versions[bindings.scene.versionId].cardId].name:'',
    characters:bindings.characters.map((b:Value)=>b.role),action:'',emotion:'',camera:'',audio:'',image_prompt:'',
    video_prompt:String(node.data.prompt||''),assetBindings:bindings};
  if(node.data.parameters?.duration!=null)shot.videoDurationOverride=duration;
  if(mode!=='multimodal'){
    shot.imageNode=images[0].id;shot.pipeline.imageNodeId=images[0].id;shot.image_prompt=String(images[0].data.prompt||'');
  }
  const shots=[...document.shots];shots.splice(Math.max(0,Math.min(position,shots.length)),0,shot);
  // Canonical bindings now own these edges; keep all ordinary media links intact.
  const visualSources=new Set(document.nodes.filter(n=>n.data.kind==='visual_asset').map(n=>n.id));
  return {...document,shots,edges:document.edges.filter(e=>!(e.target===nodeId&&visualSources.has(e.source)))};
}
