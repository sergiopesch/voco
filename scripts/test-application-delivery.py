"""Private synthetic application clipboard qualification, never the owner desktop."""
import importlib.util
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import time

root=Path(sys.argv[1]);out=root/'evidence'
assert os.environ['DISPLAY']==':0' and os.environ['HOME']==str(root/'home')
assert not Path('/dev/input').exists() and not Path('/dev/snd').exists()
source=Path(__file__).resolve().parents[1]/'apps/desktop/src-tauri/resources/voco_desktop_target.py'
spec=importlib.util.spec_from_file_location('target',source);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
import gi
gi.require_version('Atspi','2.0')
from gi.repository import Atspi, GLib
gi.require_version('Gdk','3.0')
from gi.repository import Gdk
results=[];clipboard=None;processes=[];windows=[]
def pump(seconds=.1):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        context=GLib.MainContext.default()
        while context.pending():context.iteration(False)
        time.sleep(.005)
def key(*keys):subprocess.run(['xdotool','key','--clearmodifiers',*keys],check=True,timeout=4)
def launch(name,args):
    log=(out/(name+'.log')).open('w')
    p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT)
    processes.append(p)
    return p
def wait_window(pid=None,title=None):
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        args=['xdotool','search','--onlyvisible']+(['--pid',str(pid)] if pid else ['--name',title])
        result=subprocess.run(args,capture_output=True,text=True,timeout=4)
        ids=result.stdout.splitlines()
        if ids:
            subprocess.run(['xdotool','windowfocus','--sync',ids[-1]],check=True,timeout=4)
            windows.append(ids[-1]);pump(.3);return ids[-1]
        pump(.05)
    raise AssertionError('Fixture window unavailable')
def focused():
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        result=h.safe_probe()
        if result['scope']=='control':return result
        pump(.04)
    active=[]
    desktop=Atspi.get_desktop(0)
    for i in range(desktop.get_child_count()):
        app=desktop.get_child_at_index(i)
        for j in range(max(0,app.get_child_count())):
            window=app.get_child_at_index(j);window.clear_cache_single()
            if window.get_state_set().contains(Atspi.StateType.ACTIVE):
                active.append({'pid':app.get_process_id(),'binary':h.process_binary(app.get_process_id()),'role':window.get_role_name()})
    raise AssertionError('Control unavailable: '+result['reason']+' '+json.dumps(active))
def paste(text,shortcut):
    global clipboard
    if clipboard:clipboard.terminate();clipboard.wait(timeout=3)
    leading=text.startswith(' ') and len(text)>1 and not text[1].isspace()
    clipboard=subprocess.Popen(['xclip','-selection','clipboard','-in','-quiet'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    clipboard.stdin.write((text[1:] if leading else text).encode());clipboard.stdin.close()
    assert select.select([clipboard.stderr],[],[],2)[0],'Clipboard did not become ready'
    assert b'Waiting for selection requests' in os.read(clipboard.stderr.fileno(),4096),'Clipboard ownership failed'
    key(*(['space'] if leading else []),shortcut)
def read_text():
    node=h.TRACKER.hint
    node.clear_cache_single()
    iface,position=h.text_position(node)
    return h.read_slice(iface,0,min(position[0],10000)),position
def deliver(text,first):
    target=focused()
    request=h.prepare_delivery(dict(text=text,expected_token=target['token'],first_delivery=first))
    terminal=target['shortcut']=='ctrl+shift+v'
    assert request['observation']=='prepared' or (terminal and request['observation']=='unavailable'), request
    payload=(' ' if request.get('added_separator') else '')+text
    paste(payload,target['shortcut'])
    if request['observation']=='prepared':
        deadline=time.monotonic()+3
        while time.monotonic()<deadline:
            result=h.verify_delivery({'receipt_id':request['receipt_id']})
            if result['observation']!='pending':break
            pump(.015)
        assert result['observation']=='observed', result
        return 'observed'
    pump(.2)
    current=focused()
    assert current['token']==target['token'],'Terminal destination changed'
    value,position=read_text()
    assert text.strip() in value,('Terminal did not show fixture payload',position)
    return 'terminal-dispatch-with-independent-screen-readback'
def trial(name,run):
    if os.environ.get('VOCO_APP_CASE') and os.environ['VOCO_APP_CASE'] not in name:return
    item={'name':name,'passed':False};results.append(item)
    window_start=len(windows)
    try:item.update(run() or {});item['passed']=True
    except Exception as error:
        item['error']=str(error)
        window=Gdk.get_default_root_window()
        pixbuf=Gdk.pixbuf_get_from_window(window,0,0,1280,900)
        pixbuf.savev(str(out/(name.split()[0]+'.png')),'png',[],[])
    finally:
        for window in windows[window_start:]:
            subprocess.run(['xdotool','windowclose',window],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=4)
        pump(.1)
    print(json.dumps(item),flush=True)
def text_editor():
    p=launch('text-editor',['gnome-text-editor','--standalone'])
    wait_window(pid=p.pid)
    return {'deliveries':[deliver('Hello',True),deliver(' Linux.',False),deliver(' Next sentence.',True)]}
def toolkit(kind):
    p=launch(kind,['/usr/bin/python3',str(Path(__file__).with_name('fixtures')/'delivery-native.py'),kind])
    wait_window(pid=p.pid)
    deliveries=[deliver('Hello',True),deliver(' Linux.',False)]
    p.stdin.write(b'document\n');p.stdin.flush();pump(.15)
    deliveries.append(deliver('Another field.',True))
    p.stdin.write(b'protected\n');p.stdin.flush();pump(.15)
    protected=h.safe_probe()
    assert protected['scope']=='unavailable' and protected['input_state']=='protected', protected
    return {'deliveries':deliveries,'protectedFieldRejected':True}
def terminal(program,name):
    p=launch(name,['gnome-terminal','--wait','--title='+name,'--',*program])
    wait_window(title=name)
    return {'deliveries':[deliver('hello',True),deliver(' linux',False)]}
def firefox():
    profile=root/'home/firefox';profile.mkdir()
    (profile/'user.js').write_text('user_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.startup.homepage_override.mstone", "ignore");\nuser_pref("toolkit.telemetry.reportingpolicy.firstRun", false);\nuser_pref("accessibility.force_disabled", -1);\n')
    p=launch('firefox',[os.environ['VOCO_FIREFOX_BINARY'],'--no-remote','--profile',str(profile),'about:blank'])
    wait_window(pid=p.pid);key('ctrl+l','BackSpace');pump(.2)
    return {'deliveries':[deliver('hello',True),deliver(' linux',False)]}
def vscode():
    profile=root/'home/code';(profile/'User').mkdir(parents=True)
    (profile/'User/settings.json').write_text(json.dumps({'workbench.startupEditor':'none','security.workspace.trust.enabled':False,'editor.accessibilitySupport':'on','update.mode':'none'}))
    target=root/'home/fixture.txt';target.write_text('')
    p=launch('vscode',[os.environ['VOCO_VSCODE_BINARY'],'--no-sandbox','--disable-gpu','--password-store=basic','--force-renderer-accessibility','--user-data-dir='+str(profile),'--extensions-dir='+str(profile/'extensions'),'--new-window',str(target)])
    wait_window(pid=p.pid);pump(3);key('Escape','ctrl+1');pump(.3)
    deliveries=[deliver('Hello',True),deliver(' Linux.',False)]
    key('ctrl+grave');pump(1);key('ctrl+1');pump(.3)
    assert focused()['shortcut']=='ctrl+v','An unfocused terminal must not change the editor paste chord'
    deliveries.extend([deliver(' Editor.',False),deliver(' Still editing.',False)])
    window=Gdk.get_default_root_window()
    Gdk.pixbuf_get_from_window(window,0,0,1280,900).savev(str(out/'vscode-terminal-pane.png'),'png',[],[])
    return {'deliveries':deliveries,'terminalPaneScreenshot':'vscode-terminal-pane.png'}
try:
    h.safe_probe()
    for kind in ['gtk3','gtk4','webkit']:trial(kind+' native controls',lambda kind=kind:toolkit(kind))
    trial('GNOME Text Editor',text_editor)
    trial('GNOME Terminal / Bash',lambda:terminal(['/bin/bash','--noprofile','--norc'],'VOCO-bash-fixture'))
    trial('GNOME Terminal / nano',lambda:terminal(['/usr/bin/nano','--ignorerc','--nowrap'],'VOCO-nano-fixture'))
    if os.environ.get('VOCO_FIREFOX_BINARY'):trial('Firefox address bar',firefox)
    if os.environ.get('VOCO_VSCODE_BINARY'):trial('VS Code editor',vscode)
finally:
    (out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    if clipboard:clipboard.terminate()
    for process in processes:
        if process.poll() is None:process.terminate()
sys.exit(0 if results and all(r['passed'] for r in results) else 1)
