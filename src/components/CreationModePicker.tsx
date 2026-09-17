import { useId } from "react";

export function CreationModePicker({value,onChange,disabled=false}:{
  value:"direct"|"adaptation";onChange:(value:"direct"|"adaptation")=>void;disabled?:boolean;
}) {
  const name=useId();
  return <fieldset className="creation-mode-picker" disabled={disabled}>
    <legend>创作起点</legend>
    <div>
      <label className={value==='direct'?'selected':''}><input type="radio" name={name} value="direct" checked={value==='direct'} onChange={()=>onChange('direct')}/>直接写剧本</label>
      <label className={value==='adaptation'?'selected':''}><input type="radio" name={name} value="adaptation" checked={value==='adaptation'} onChange={()=>onChange('adaptation')}/>从原著改编</label>
    </div>
    <small>{value==='direct'?'编写、粘贴、导入成稿剧本，或使用 AI 辅助创作。':'导入原著，提取事件并完成改编策划后生成剧本。'}</small>
  </fieldset>;
}
