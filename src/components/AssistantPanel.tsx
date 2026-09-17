import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Square, X, ArrowUpRight, LoaderCircle } from "lucide-react";
import { assistantContextLabel, assistantRequestId, readAssistantStream, type AssistantAction, type AssistantContext, type AssistantMessage } from "../assistantChat";
import "./assistant.css";

type Conversation = {messages: AssistantMessage[]; busy: boolean; error: string};
const empty = (): Conversation => ({messages:[],busy:false,error:""});

export function AssistantPanel({open, onClose, projectId, productionId, context, stage, nodeId, pageGuide, unsaved, onAction}: {
  open: boolean; onClose: () => void; projectId?: string; productionId?: string;
  context: AssistantContext; stage: string; nodeId?: string | null; pageGuide?: string; unsaved: boolean;
  onAction: (action: AssistantAction) => Promise<void>;
}) {
  const scope = productionId || "workspace";
  const [conversations, setConversations] = useState<Record<string,Conversation>>({});
  const [drafts, setDrafts] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<{headline:string;detail:string;progress:string;questions:string[];action?:AssistantAction}|null>(null);
  const [contextError, setContextError] = useState("");
  const controllers = useRef(new Map<string,AbortController>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const current = conversations[scope] || empty();
  const draft = drafts[scope] || "";
  const patch = (key: string, fn: (value: Conversation) => Conversation) => setConversations(items=>({...items,[key]:fn(items[key] || empty())}));

  useEffect(()=>()=>{controllers.current.forEach(controller=>controller.abort());},[]);
  useEffect(()=>{
    if (!open) return;
    if (controllers.current.has(scope)) {setLoading(false);return;}
    const controller=new AbortController();
    setLoading(true);
    fetch('/api/assistant/history'+(projectId?'?project_id='+encodeURIComponent(projectId):''),{signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error("聊天记录加载失败，请重新打开助手重试");return response.json();})
      .then(messages=>{if(!controller.signal.aborted&&!controllers.current.has(scope))patch(scope,value=>({...value,messages}));})
      .catch(error=>{if(!controller.signal.aborted)patch(scope,value=>({...value,error:error.message}));})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[open,scope]);
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();setOpening(null);setContextError("");
    const query=new URLSearchParams({stage});if(projectId)query.set('project_id',projectId);if(nodeId)query.set('node_id',nodeId);
    fetch('/api/assistant/context?'+query,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('暂时无法读取进展，可重新打开助手刷新。');return response.json();
    }).then(value=>{if(!controller.signal.aborted)setOpening(value.hint);}).catch(error=>{if(!controller.signal.aborted)setContextError(error.message);});
    return ()=>controller.abort();
  },[open,projectId,stage,nodeId]);
  useEffect(()=>{
    if(open && bottomRef.current && scrollRef.current) scrollRef.current.scrollTop=scrollRef.current.scrollHeight;
  },[open,current.messages]);
  useEffect(()=>{if(open)inputRef.current?.focus();},[open]);

  async function ask(question=draft) {
    const text=question.trim();
    if(!text || controllers.current.has(scope) || loading)return;
    const key=scope, requestId=assistantRequestId(), now=Date.now()/1000, captured={...context,unsaved};
    const user:AssistantMessage={id:requestId+'-u',role:'user',content:text,status:'complete',context:captured,actions:[],created:now};
    const answer:AssistantMessage={id:requestId+'-a',role:'assistant',content:'',status:'running',context:captured,actions:[{kind:'panel',panel:projectId?'projectInfo':'settings',projectId,label:projectId?'打开作品设置':'打开设置'}],created:now+0.001};
    const controller=new AbortController();controllers.current.set(key,controller);
    setDrafts(values=>({...values,[key]:''}));bottomRef.current=true;
    patch(key,value=>({...value,busy:true,error:'',messages:[...value.messages,user,answer]}));
    const updateAnswer=(fn:(message:AssistantMessage)=>AssistantMessage)=>patch(key,value=>({...value,messages:value.messages.map(m=>m.id===answer.id?fn(m):m)}));
    try {
      const response=await fetch('/api/assistant/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({request_id:requestId,message:text,project_id:projectId,stage,node_id:nodeId,unsaved,page_guide:(pageGuide || '').slice(0,1200)})});
      await readAssistantStream(response,event=>{
        if(event.type==='start')updateAnswer(message=>({...message,context:event.context,actions:event.actions}));
        if(event.type==='delta')updateAnswer(message=>({...message,content:message.content+event.text}));
        if(event.type==='done')updateAnswer(message=>({...message,status:'complete'}));
        if(event.type==='error'){updateAnswer(message=>({...message,status:'failed',content:message.content+(message.content?'\n\n':'')+'回答失败：'+event.message}));}
      });
    } catch(error) {
      const stopped=controller.signal.aborted;
      updateAnswer(message=>({...message,status:stopped?'interrupted':'failed',content:message.content || (stopped?'已停止回答。':(error instanceof Error?error.message:'回答失败'))}));
      if(!stopped){patch(key,value=>({...value,error:'未自动重试。可检查设置后重新发送问题。'}));setDrafts(values=>({...values,[key]:values[key] || text}));}
    } finally {controllers.current.delete(key);patch(key,value=>({...value,busy:false}));}
  }
  return <aside className="assistant-panel" hidden={!open} aria-label="AI助手" onKeyDown={event=>{if(event.key==='Escape')onClose();}}>
    <header><h2><MessageCircle size={19}/>AI助手</h2><button className="icon-button" onClick={onClose} aria-label="收起 AI助手"><X size={18}/></button></header>
    <div className="assistant-context" title={assistantContextLabel(context)}>{assistantContextLabel(context)}{unsaved&&<small>有未保存修改 · 诊断以服务端已保存内容为准</small>}</div>
    <section className="assistant-opening" aria-label="当前进展与建议">
      {opening?<><div><strong>{opening.headline}</strong><small>{opening.progress}</small></div><p>{opening.detail}</p>{opening.action&&(opening.action.kind==='task'?<a href={'/?task='+encodeURIComponent(opening.action.taskId!)} target="_blank" rel="noopener noreferrer">{opening.action.label}<ArrowUpRight size={12}/></a>:<button onClick={()=>onAction(opening.action!).catch(error=>setContextError(error.message))}>{opening.action.label}<ArrowUpRight size={12}/></button>)}</>:<p>{contextError || '正在识别当前状态与进展…'}</p>}
      {opening&&contextError&&<small className="assistant-error">{contextError}</small>}
    </section>
    <div className="assistant-messages" ref={scrollRef} onScroll={()=>{const el=scrollRef.current!;bottomRef.current=el.scrollHeight-el.scrollTop-el.clientHeight<70;}}>
      {loading&&<p className="muted">正在读取对话…</p>}
      {!loading&&!current.messages.length&&<div className="assistant-welcome"><MessageCircle size={30}/><h3>遇到问题，随时问我</h3><p>我会结合当前作品，帮你了解怎么操作、下一步做什么，以及卡在哪里。</p></div>}
      {current.messages.map(message=><article key={message.id} className={'assistant-message '+message.role}>
        <small>{message.role==='user'?'你':'AI助手'} · {assistantContextLabel(message.context)}</small>
        <div className="assistant-content">{message.content || (message.status==='running'?'正在分析当前状态…':'未返回正文')}</div>
        {message.status==='running'&&<span className="assistant-status"><LoaderCircle size={12} className="spin"/>正在回答</span>}
        {message.status==='interrupted'&&<span className="assistant-status">回答已停止，已收到内容保留</span>}
        {message.role==='assistant'&&message.context.model&&<small className="assistant-model">{message.context.model.provider} · {message.context.model.model}</small>}
        {!!message.actions.length&&<div className="assistant-actions">{message.actions.map((action,index)=>action.kind==='task'?<a key={index} href={'/?task='+encodeURIComponent(action.taskId!)} target="_blank" rel="noopener noreferrer">{action.label}<ArrowUpRight size={12}/></a>:<button key={index} onClick={()=>onAction(action).catch(error=>patch(scope,value=>({...value,error:error.message})))}>{action.label}<ArrowUpRight size={12}/></button>)}</div>}
      </article>)}
    </div>
    <div className="assistant-composer">
      <div className="assistant-quick">{(opening?.questions || ['下一步做什么','为什么进行不下去','这页怎么用']).map(text=><button key={text} disabled={current.busy||loading} onClick={()=>void ask(text)}>{text}</button>)}</div>
      {current.error&&<p role="alert" className="assistant-error">{current.error}</p>}
      <textarea ref={inputRef} aria-label="向 AI助手提问" placeholder="问问怎么操作，或描述遇到的问题…" value={draft} maxLength={6000} rows={3} onChange={event=>setDrafts(values=>({...values,[scope]:event.target.value}))} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void ask();}}}/>
      <footer><small>Enter 发送 · Shift+Enter 换行</small>{current.busy?<button onClick={()=>controllers.current.get(scope)?.abort()}><Square size={13}/>停止</button>:<button className="primary" disabled={!draft.trim()||loading} onClick={()=>void ask()}><Send size={14}/>发送</button>}</footer>
    </div>
  </aside>;
}
