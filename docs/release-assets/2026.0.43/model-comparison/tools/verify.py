"""Validate the portable numeric data and exported figures. Run after rendering."""
from pathlib import Path
import json, math, statistics, struct, re, subprocess
from html.parser import HTMLParser
import xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
d=json.loads((ROOT/'data/metrics.json').read_text());trials=json.loads((ROOT/'data/trial-metrics.json').read_text())
assert len(trials)==63 and len(d['models'])==7 and len(d['metrics'])==14
fields={2:('first_text_s','median',False,1),3:('cpu_s_per_audio_s','median',False,1),4:('peak_rss_sum_mib','max',False,1/1024),5:('stop_to_complete_s','median',True,1),6:('word_count_fraction_at_audio_end','median',True,100),7:('completed_prefix_revisions','median',True,1),8:('max_text_update_gap_s','max',True,1),9:('load_s','median',False,1),10:('warmup_s','median',False,1),11:('offline_decode_s','median',True,1)}
checked=0
for j,m in enumerate(d['metrics'][:12]):
 for i,mid in enumerate(d['models']):
  rr=[r for r in trials if r['model']==mid]
  assert len(rr)==9
  if j<2:
   prefix='normalized_' if j==1 else '';v=100*sum(r[prefix+'edits'] for r in rr)/sum(r[prefix+'reference_words'] for r in rr)
  else:
   col,agg,long,factor=fields[j]
   rr=[r for r in rr if not long or r['recording']=='long']
   vv=[r[col]*factor for r in rr if r[col] is not None]
   # Do not reinterpret offline placeholder zeros as streamed revision observations.
   if j in [2,5,6,7,8] and i>=5:vv=[]
   if j==11 and i<5:vv=[]
   v=(max(vv) if agg=='max' else statistics.median(vv)) if vv else None
  observed=m['values'][i]
  assert v is None and observed is None or v is not None and observed is not None and math.isclose(v,observed,rel_tol=1e-12)
  checked+=1
images=sorted((ROOT/'png').glob('*.png'));assert len(images)==15
for p in images:
 with p.open('rb') as f:header=f.read(24)
 assert header[:8]==b'\x89PNG\r\n\x1a\n'
 assert struct.unpack('>II',header[16:24])==(7680,4320),p.name
 svg=ROOT/'svg'/(p.stem+'.svg');parsed=ET.parse(svg)
 text=' '.join(parsed.getroot().itertext())
 for name in d['names']:assert name in text,(p.name,name)
 if p.stem!='00-overview':
  m=next(m for m in d['metrics'] if m['key']==p.stem)
  for v in m['values']:
   if v is None:continue
   val=(f'{v*1000:.2f} ms' if v<1 else f'{v:.3f} s') if p.stem=='06-completion-tail' else f"{v:,.{m['decimals']}f}"
   assert val in text,(p.name,val)
for f in ROOT.rglob('*'):
 if f.suffix in ['.json','.csv','.svg','.md','.html']:
  text=f.read_text();assert not re.search(r'/home/|/tmp/|-----BEGIN .*PRIVATE KEY|Bearer\s+\S+',text),f.name
 assert f.suffix not in ['.wav','.flac','.mp3','.log','.jsonl']
class CheckLinks(HTMLParser):
 def handle_starttag(self,tag,attrs):
  for key,value in attrs:
   if key in ['src','href'] and not value.startswith(('http:','https:','#')):assert (ROOT/value).is_file(),value
CheckLinks().feed((ROOT/'index.html').read_text())
pdf=subprocess.check_output(['pdftotext',str(ROOT/'VOCO-all-models-benchmark.pdf'),'-'],text=True)
assert pdf.count('\f')==15
assert 'Seven configurations' in pdf.split('\f')[0]
print(json.dumps({'passed':True,'recomputedMainMetricValuesIncludingMissing':checked,'pngsVerifiedAt7680x4320':15,'svgsWithAllSevenModelsAndMatchingValues':15,'pdfPages':15,'overviewFirst':True,'galleryLinks':'passed','textPrivacyScan':'passed'},indent=2))
