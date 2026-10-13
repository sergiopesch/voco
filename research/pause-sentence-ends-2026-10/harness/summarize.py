import json, sys, subprocess
from pathlib import Path
out = subprocess.run([sys.executable, str(Path(__file__).with_name('score.py')), 'items.json', sys.argv[1], *sys.argv[2:]], capture_output=True, text=True, check=True).stdout
first = out.index('{'); print(out[:first].strip()); t = json.loads(out[first:])
cols = ['S_acc', 'M_acc', 'M_inserted_acc', 'M_natural_acc', 'PA', 'term_P', 'term_R']
print('policy     ' + ' '.join(f'{c[:6]:>6}' for c in cols) + '   WER%  jdel viol   rtf   d50   d90  PA_ci            M_ci             WER_ci')
for k, v in t.items():
    f = lambda x: f'{v[x]:6.3f}' if isinstance(v.get(x), float) else f'{str(v.get(x)):>6}'
    g = lambda x: f'{v[x]:5.2f}' if isinstance(v.get(x), float) else '    -'
    ci = lambda x: '[%+.3f,%+.3f]' % tuple(v[x]) if x in v else '        -       '
    print(f'{k:10} ' + ' '.join(f(c) for c in cols) + f' {100*v["WER"]:6.2f} {v["junction_dels_per_100"]:5.1f} {v["violations"]:4d} {v["rtf"]:5.3f} {g("forced_S_delay_p50")} {g("forced_S_delay_p90")}  {ci("PA_ci")} {ci("M_acc_ci")} {ci("WER_ci")}')
