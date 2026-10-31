#!/usr/bin/env python3
from pathlib import Path
import plistlib

home=Path('~')
root=home/'quick-arr-stack/arr-dashboard'
logs=home/'Library/Logs/agentbox'
logs.mkdir(parents=True,exist_ok=True,mode=0o700)
(folder:=root/'deploy').mkdir(exist_ok=True)
env={'HOME':str(home),'PATH':f'{root}/.venv/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
     'TZ':'Asia/Manila','PYTHONUNBUFFERED':'1','SHELL_WS_HOST':'HOST','SHELL_WS_PORT':'5556'}
commands={
 'telemetry':[str(root/'.venv/bin/python'),str(root/'telemetry_collector.py')],
 'web':[str(root/'.venv/bin/gunicorn'),'--workers','1','--threads','8','--bind','HOST:5555',
        '--timeout','45','--access-logfile','-', '--error-logfile','-', 'app:app'],
 'shell':[str(root/'.venv/bin/python'),str(root/'shell_ws.py')],
}
for role,args in commands.items():
 label='dev.agentbox.dashboard.'+role
 d={'Label':label,'UserName':'youruser','GroupName':'staff','RunAtLoad':True,'KeepAlive':True,
    'ThrottleInterval':5,'ExitTimeOut':20,'Umask':0o077,'ProcessType':'Interactive',
    'WorkingDirectory':str(root),'EnvironmentVariables':env,'ProgramArguments':args,
    'StandardOutPath':str(logs/(role+'.out.log')),'StandardErrorPath':str(logs/(role+'.err.log'))}
 with (folder/(label+'.plist')).open('wb') as f:plistlib.dump(d,f)
print('Three native boot-service definitions prepared.')
