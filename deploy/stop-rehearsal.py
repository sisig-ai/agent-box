#!/usr/bin/env python3
"""Stop only this dashboard's temporary processes, as the dashboard user."""
import json,os,signal,subprocess,time
from pathlib import Path
r=Path('/Users/kixpanganiban/quick-arr-stack/arr-dashboard')
p=r/'deploy/rehearsal-pids.json'
if p.exists():
    expected={'telemetry':'telemetry_collector.py','web':'.venv/bin/gunicorn','shell':'shell_ws.py'}
    for role,pid in json.loads(p.read_text()).items():
        pid=int(pid)
        result=subprocess.run(['/bin/ps','-p',str(pid),'-o','command='],capture_output=True,text=True)
        if not result.stdout.strip():continue
        if str(r) not in result.stdout or expected[role] not in result.stdout:
            raise SystemExit('Rehearsal process identity differs; inspect before replacing.')
        if os.getpgid(pid)!=pid:raise SystemExit('Unexpected process group')
        os.killpg(pid,signal.SIGTERM)
    for _ in range(50):
        if not any(subprocess.run(['/bin/ps','-p',str(pid)],stdout=subprocess.DEVNULL).returncode==0 for pid in json.loads(p.read_text()).values()):break
        time.sleep(.1)
    p.unlink()
