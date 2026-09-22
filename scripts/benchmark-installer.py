#!/usr/bin/env python3
"""Compare installer download paths on repeatable local transfers, without installing."""
import argparse
import fcntl
import hashlib
import http.server
import json
import os
from pathlib import Path
import pty
import resource
import select
import struct
import subprocess
import tempfile
import termios
import threading
import time

PAYLOAD = bytes(range(256)) * 32768


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        data = PAYLOAD if self.path == '/paced' else PAYLOAD[:65536]
        self.send_response(200)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        for offset in range(0, len(data), 131072):
            self.wfile.write(data[offset:offset+131072])
            self.wfile.flush()
            if self.path == '/paced':
                time.sleep(.012)


def trial(source, url, mode, temporary, trace=None):
    prefix = source.read_text().split('# ─── Header', 1)[0]
    body = '''
VOCO_TERMINAL_COLUMNS=80
VOCO_DOWNLOAD_DIR=$(mktemp -d)
voco_download fixture "$VOCO_DOWNLOAD_DIR/data" "$1"
sha256sum "$VOCO_DOWNLOAD_DIR/data"
'''
    env = {**os.environ, 'TERM':'xterm-256color', 'TMPDIR':str(temporary), 'XDG_CURRENT_DESKTOP':''}
    for key in ('NO_COLOR','VOCO_INSTALL_PLAIN','VOCO_INSTALL_NO_MOTION'):
        env.pop(key, None)
    if mode == 'plain':
        env['NO_COLOR']='1'
    command=['bash','-c',prefix+body,'fixture',url]
    if trace:
        command=['strace','-f','-qq','-e','trace=execve','-o',str(trace),*command]
    master,slave=pty.openpty()
    fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',30,80,0,0))
    before=resource.getrusage(resource.RUSAGE_CHILDREN)
    start=time.monotonic()
    process=subprocess.Popen(command,stdin=slave,stdout=slave,stderr=slave,env=env)
    os.close(slave)
    output=bytearray()
    try:
        while time.monotonic()-start < 15:
            if select.select([master],[],[],.01)[0]:
                try:
                    chunk=os.read(master,65536)
                except OSError:
                    break
                if not chunk:
                    break
                output.extend(chunk)
            elif process.poll() is not None:
                break
        code=process.wait(timeout=2)
    finally:
        if process.poll() is None:
            process.kill();process.wait()
        os.close(master)
    after=resource.getrusage(resource.RUSAGE_CHILDREN)
    expected=PAYLOAD if url.endswith('/paced') else PAYLOAD[:65536]
    return {
        'wall_seconds':time.monotonic()-start,
        'cpu_seconds':after.ru_utime+after.ru_stime-before.ru_utime-before.ru_stime,
        'exit_code':code,
        'payload_sha256_verified':hashlib.sha256(expected).hexdigest().encode() in output,
        'output_bytes':len(output),
        'trace_exec_count':trace.read_text().count('execve(') if trace else None,
    }


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--candidate',type=Path,default=Path(__file__).resolve().parents[1]/'install')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--repeats',type=int,default=7)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=False)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    sources={'baseline':args.baseline.resolve(),'candidate':args.candidate.resolve()}
    record={'scope':'local HTTP download fixtures; no APT, Internet or desktop timing',
            'source_sha256':{name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in sources.items()},
            'trials':[], 'traces':[]}
    try:
        with tempfile.TemporaryDirectory(prefix='voco-install-bench-') as temporary:
            for transfer in ('fast','paced'):
                for mode in ('plain','animated'):
                    for repeat in range(args.repeats):
                        order=('baseline','candidate') if repeat%2==0 else ('candidate','baseline')
                        for name in order:
                            result=trial(sources[name],f'http://127.0.0.1:{server.server_port}/{transfer}',mode,temporary)
                            result.update(source=name,transfer=transfer,mode=mode,repeat=repeat)
                            record['trials'].append(result)
                            (args.output/'results.json').write_text(json.dumps(record,indent=2)+'\n')
                            print(f'{name} {transfer} {mode} {repeat+1}: {result["wall_seconds"]:.3f}s, CPU {result["cpu_seconds"]:.4f}s',flush=True)
                            if result['exit_code'] or not result['payload_sha256_verified']:
                                raise SystemExit('Trial failed; all attempted results retained.')
            for name,path in sources.items():
                trace=args.output/f'{name}-exec.trace'
                result=trial(path,f'http://127.0.0.1:{server.server_port}/paced','animated',temporary,trace)
                result.update(source=name)
                record['traces'].append(result)
            (args.output/'results.json').write_text(json.dumps(record,indent=2)+'\n')
    finally:
        server.shutdown();server.server_close()


if __name__=='__main__':
    main()
