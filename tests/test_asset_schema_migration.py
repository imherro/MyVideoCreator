import sqlite3
from backend import store as s

def test_legacy_asset_rows_gain_classification_without_file_or_data_changes(monkeypatch,tmp_path):
    data=tmp_path/'legacy-data';assets=data/'assets';assets.mkdir(parents=True)
    media=assets/'asset-old.png';media.write_bytes(b'unchanged-media')
    database=data/'studio.sqlite'
    with sqlite3.connect(database) as connection:
        connection.execute('CREATE TABLE assets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,path TEXT NOT NULL,mime TEXT NOT NULL,metadata TEXT NOT NULL,created REAL NOT NULL)')
        connection.execute('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)',('asset-old','project-old','旧角色图','image',media.name,'image/png','{"kept":true}',1.0))
    monkeypatch.setattr(s,'DATA',data);monkeypatch.setattr(s,'ASSETS',assets)
    s.init()
    with s.db() as connection:
        row=connection.execute('SELECT * FROM assets WHERE id=?',('asset-old',)).fetchone()
        index_names={item['name'] for item in connection.execute('PRAGMA index_list(assets)')}
    assert row['category']=='other' and row['source']=='uploaded'
    assert row['path']=='asset-old.png' and row['metadata']=='{"kept":true}'
    assert media.read_bytes()==b'unchanged-media'
    assert 'assets_project_category_created' in index_names
