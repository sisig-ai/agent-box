"""Functional verification in a disposable database; production notes untouched."""
import json
import tempfile
from pathlib import Path
import app

with tempfile.TemporaryDirectory() as folder:
    app.DATA_DIR=Path(folder);app.DB_PATH=app.DATA_DIR/'briefs.db';app.init_db()
    c=app.app.test_client()
    for route in ['/api/brief']:
        assert c.put(route,json={'date':'2026-10-01','content':'# Native check\n\n- saved'}).status_code==200
        assert c.get(route+'?date=2026-10-01').json['content'].startswith('# Native')
        assert len(c.get(route+'/list').json)==1
        assert c.delete(route+'?date=2026-10-01').status_code==200
        assert c.get(route+'?date=2026-10-01').json['content']==''
    assert c.put('/api/schedule',json={'week':'2026-10-01','content':'# Week'}).status_code==200
    assert c.get('/api/schedule?week=2026-10-01').json['content']=='# Week'
    assert c.delete('/api/schedule?week=2026-10-01').status_code==200
    app.record_telemetry_snapshot(15.2,42.1,{'used_bytes':123,'total_bytes':456},None,None,8.4)
    h=c.get('/api/stats/history?seconds=60').json
    assert 15.2 in h['cpu'] and 42.1 in h['temp'] and 8.4 in h['pwr']
    assert c.get('/api/stats').status_code==503
    assert c.post('/api/shell/input',json={'id':'bad;command','text':'no'}).status_code==400
    assert c.post('/api/shell/key',json={'id':'bad;command','key':'Enter'}).status_code==400

    # Filesystem explorer, sandboxed to a throwaway "home"
    import io
    app.FS_HOME = Path(folder) / 'fs-home'
    (app.FS_HOME / 'sub').mkdir(parents=True)
    (app.FS_HOME / 'note.txt').write_text('hello')
    assert c.get('/api/fs/list').json['path'] == str(app.FS_HOME)
    assert c.get('/api/fs/list?path=/no/such/dir').status_code == 404
    assert c.post('/api/fs/mkdir', json={'parent': str(app.FS_HOME), 'name': 'new'}).status_code == 200
    assert c.post('/api/fs/touch', json={'parent': str(app.FS_HOME), 'name': 'a.txt'}).status_code == 200
    r = c.post('/api/fs/rename', json={'path': str(app.FS_HOME / 'a.txt'), 'name': 'b.txt'})
    assert r.status_code == 200 and r.json['name'] == 'b.txt'
    up = c.post('/api/fs/upload',
                data={'path': str(app.FS_HOME), 'file': (io.BytesIO(b'up'), 'up.bin')},
                content_type='multipart/form-data')
    assert up.status_code == 200
    assert c.post('/api/fs/upload',
                  data={'path': str(app.FS_HOME), 'file': (io.BytesIO(b'x'), 'up.bin')},
                  content_type='multipart/form-data').status_code == 409
    assert c.get('/api/fs/download?path=%s' % (app.FS_HOME / 'up.bin')).data == b'up'
    assert c.get('/api/fs/stat?path=%s' % (app.FS_HOME / 'note.txt')).json['size'] == 5
    assert c.delete('/api/fs?path=%s' % (app.FS_HOME / 'new')).status_code == 200
    assert c.delete('/api/fs?path=%s' % app.FS_HOME).status_code == 400  # home guard
    assert c.delete('/api/fs?path=/').status_code == 400                 # root guard

    print('Notes, schedule, telemetry history, stale-data, shell-ID and filesystem checks passed.')
