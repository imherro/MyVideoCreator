"""Soft-delete an entire production without reviving previously deleted episodes."""
import time
from fastapi import HTTPException


def trash_production(c, production_id):
    if not c.execute('SELECT 1 FROM productions WHERE id=?',(production_id,)).fetchone():
        raise HTTPException(404,'作品不存在')
    if c.execute("SELECT 1 FROM deleted_items WHERE kind='production' AND item_id=?",(production_id,)).fetchone():
        return []
    active=c.execute("""SELECT COUNT(*) FROM jobs j JOIN projects p ON p.id=j.project_id
        WHERE p.production_id=? AND j.status IN ('queued','running')""",(production_id,)).fetchone()[0]
    if active:raise HTTPException(409,f'作品仍有 {active} 个活动任务，请等待完成或取消后再移入回收站。')
    members=[r['id'] for r in c.execute("""SELECT id FROM projects WHERE production_id=? AND NOT EXISTS(
        SELECT 1 FROM deleted_items d WHERE d.kind='project' AND d.item_id=projects.id)""",(production_id,))]
    now=time.time()
    c.execute("INSERT INTO deleted_items VALUES('production',?,?,?)",(production_id,production_id,now))
    for pid in members:
        c.execute('INSERT INTO production_trash_members VALUES(?,?)',(production_id,pid))
        c.execute("INSERT INTO deleted_items VALUES('project',?,?,?)",(pid,pid,now))
    return members


def restore_production(c, production_id):
    members=[r['project_id'] for r in c.execute('SELECT project_id FROM production_trash_members WHERE production_id=?',(production_id,))]
    for pid in members:c.execute("DELETE FROM deleted_items WHERE kind='project' AND item_id=?",(pid,))
    c.execute('DELETE FROM production_trash_members WHERE production_id=?',(production_id,))
    c.execute("DELETE FROM deleted_items WHERE kind='production' AND item_id=?",(production_id,))
    return members


def hidden_owner(c, kind, item_id):
    if kind=='project':
        row=c.execute('SELECT production_id FROM projects WHERE id=?',(item_id,)).fetchone()
    elif kind=='asset':
        row=c.execute('SELECT production_id FROM assets WHERE id=?',(item_id,)).fetchone()
    elif kind=='source':
        row=c.execute('SELECT production_id FROM source_documents WHERE id=?',(item_id,)).fetchone()
    elif kind=='chapter':
        row=c.execute('SELECT d.production_id FROM source_chapters sc JOIN source_documents d ON d.id=sc.source_id WHERE sc.id=?',(item_id,)).fetchone()
    else:return False
    return bool(row and c.execute("SELECT 1 FROM deleted_items WHERE kind='production' AND item_id=?",(row['production_id'],)).fetchone())
