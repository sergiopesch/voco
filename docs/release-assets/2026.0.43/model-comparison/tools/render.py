"""Render 7680x4320 white-background figures from audited numeric data.
Requires matplotlib and numpy; no network, audio or transcript access.
"""
from pathlib import Path
import json,html
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.lines import Line2D
ROOT=Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'data/metrics.json').read_text())
INK='#132D3D';MUTED='#536875';GREEN='#087F67';BAR='#516D80';GRID='#E5EBEF'
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'text.color':INK,'axes.labelcolor':MUTED,'xtick.color':MUTED,'axes.edgecolor':GRID,'figure.facecolor':'white','axes.facecolor':'white','savefig.facecolor':'white','svg.fonttype':'none','pdf.fonttype':42})
PDF=PdfPages(ROOT/'VOCO-all-models-benchmark.pdf',metadata={'Title':'VOCO — all tested models, one metric at a time','Author':'VOCO'})
index=[]
def line(fig,y):fig.add_artist(Line2D([.055,.945],[y,y],transform=fig.transFigure,color=GRID,lw=.8))
def frame(number,title,subtitle,tag):
 f=plt.figure(figsize=(16,9),dpi=100)
 f.text(.055,.941,'VOCO  /  LOCAL SPEECH BENCHMARK',fontsize=10,weight='bold',color=GREEN)
 f.text(.945,.941,number,ha='right',fontsize=10,color=MUTED)
 f.text(.055,.868,title,fontsize=29,weight='bold')
 f.text(.055,.816,subtitle,fontsize=12,color=MUTED)
 line(f,.778)
 f.text(.055,.740,'MODEL / TESTED CONFIGURATION',fontsize=9,weight='bold',color=MUTED)
 f.text(.945,.740,tag,fontsize=9,ha='right',weight='bold',color=MUTED)
 return f

def save(f,key,title,caption):
 f.canvas.draw()
 renderer=f.canvas.get_renderer()
 for text in f.texts:
  bounds=text.get_window_extent(renderer)
  assert bounds.x0>=0 and bounds.x1<=1600 and bounds.y0>=0 and bounds.y1<=900, (key,text.get_text())
 f.savefig(ROOT/'png'/f'{key}.png',dpi=480)
 svg_path=ROOT/'svg'/f'{key}.svg'
 f.savefig(svg_path)
 svg_path.write_text('\n'.join(line.rstrip() for line in svg_path.read_text().splitlines())+'\n')
 f.savefig(ROOT/'previews'/f'{key}.png',dpi=100)
 PDF.savefig(f);plt.close(f)
 index.append(dict(key=key,title=title,caption=caption))
 print(key,flush=True)

def fmt(v,m):return f"{v:,.{m['decimals']}f}"
# Main scorecard: all comparable models, original cohort only, no synthetic overall grade.
f=frame('OVERVIEW','Seven configurations. The measured tradeoffs.','Matched recorded-speech comparison · 14 September 2026 · AMD Ryzen 7 PRO 8840HS · CPU only.','NO COMPOSITE SCORE')
cols=[(.385,'WER','%',D['metrics'][0]),(.485,'NORMALIZED','WER %',D['metrics'][1]),(.60,'FIRST OUTPUT','s · median',D['metrics'][2]),(.72,'CPU WORK','s / audio s',D['metrics'][3]),(.84,'PEAK RSS','GiB',D['metrics'][4])]
for x,head,unit,m in cols:
 f.text(x,.691,head,fontsize=9,weight='bold',ha='center',color=MUTED);f.text(x,.665,unit,fontsize=9,ha='center',color=MUTED)
for i,name in enumerate(D['names']):
 yp=.610-i*.052
 f.text(.055,yp,name,fontsize=13.0,va='center',weight='bold' if i==0 else 'normal',color=GREEN if i==0 else INK)
 for x,h,u,m in cols:
  val=m['values'][i]
  label=fmt(val,m) if val is not None else 'Unavailable'
  f.text(x,yp,label,fontsize=15 if val is not None else 10.5,ha='center',va='center',color=GREEN if i==0 else INK,weight='bold' if i==0 else 'normal')
 line(f,yp-.027)
f.text(.055,.211,'Why Nemotron: early output with practical CPU and memory use.',fontsize=16,weight='bold',color=GREEN)
f.text(.055,.171,'Qwen 0.6B had lower measured WER. The selection reflects the combined live-dictation tradeoff in this test.',fontsize=11.5)
f.text(.055,.109,'One speaker · 3 previously used recordings · 919 distinct words · 3 repeats · 63 selected successful trials / 64 attempts.',fontsize=9.5,color=MUTED)
f.text(.055,.073,'WER excludes punctuation. First output is a recognizer callback, not cursor paint. Offline first output is unavailable.',fontsize=9.5,color=MUTED)
f.text(.055,.037,'CPU is not battery use; sampled process-tree RSS may double-count shared pages. No universal superiority is established.',fontsize=9.5,color=MUTED)
save(f,'00-overview','Seven configurations. The measured tradeoffs.','All seven configurations, same one-speaker corpus. WER, normalized WER, first callback, CPU work and sampled memory. No composite grade.')

# Single metric cards. All configurations remain in the same order, including missing values.
for num,m in enumerate(D['metrics'],1):
 f=frame(f'{num:02d} / 14',m['title'],m['subtitle'],m['direction'])
 ax=f.add_axes([.34,.260,.405,.455]);ax.set_ylim(6.55,-.55)
 vals=m['values'];mx=max(v for v in vals if v is not None)
 limit=100 if m['key'].startswith('07-') else mx*1.07
 ax.set_xlim(0,limit);ax.set_yticks([]);ax.xaxis.set_major_locator(MaxNLocator(nbins=5))
 if m['key']=='06-completion-tail':
  ax.set_xscale('log');ax.set_xlim(.001,1000);ax.set_xticks([.001,.01,.1,1,10,100,1000],['0.001','0.01','0.1','1','10','100','1,000']);ax.minorticks_off()
 ax.grid(axis='x',color=GRID,lw=.6,zorder=0)
 for sp in ['top','left','right']:ax.spines[sp].set_visible(False)
 ax.tick_params(axis='x',length=0,labelsize=10,pad=8)
 ax.set_xlabel('Seconds · logarithmic scale' if m['key']=='06-completion-tail' else m['unit'],fontsize=10,labelpad=8)
 for i,(name,value) in enumerate(zip(D['names'],vals)):
  yp=.260+.455*(6.55-i)/7.10
  color=GREEN if i==0 else BAR
  f.text(.055,yp+.005,name,fontsize=13.2,va='center',weight='bold' if i==0 else 'normal')
  mode='STREAMING ADAPTER' if i<5 else 'OFFLINE ADAPTER'
  if m['boundary']=='native': mode=['VOCO .34','RESEARCH PROTOTYPE','RESEARCH PROTOTYPE','NO TRIAL','NO TRIAL','NO TRIAL','VOCO .33'][i]
  elif m['boundary']=='public40':mode=['INCREMENTAL','INCREMENTAL','INCREMENTAL','NO TRIAL','NO TRIAL','NO TRIAL','FULL UTTERANCE'][i]
  f.text(.055,yp-.018,('SELECTED DEFAULT · ' if i==0 else '')+mode,fontsize=7.4,color=GREEN if i==0 else MUTED)
  if value is None:
   reason=m['missing'][i] if isinstance(m['missing'],list) else m['missing']
   f.text(.35,yp,reason,fontsize=11,color=MUTED,va='center')
   f.text(.945,yp,'—',fontsize=17,color=MUTED,va='center',ha='right')
  else:
   if m['key']=='06-completion-tail':ax.plot(value,i,'o',color=color,markersize=8,zorder=3)
   else:ax.barh(i,value,height=.39,color=color,zorder=3)
   if value==0:ax.plot(0,i,'o',color=color,markersize=4,clip_on=False,zorder=4)
   display=(f'{value*1000:.2f} ms' if value<1 else f'{value:.3f} s') if m['key']=='06-completion-tail' else fmt(value,m)
   f.text(.945,yp,display,fontsize=21,ha='right',va='center',weight='bold',color=color)
 line(f,.185)
 if m['boundary']=='round3':
  scope='One speaker · 3 previously used recordings · 919 distinct reference words · 63 selected successes / 64 attempts.'
  if m['scope']=='long':scope='Long-recording slice · one speaker · 303.712 s · 3 repeats per model · drawn from the 63/64-trial comparison.'
  hardware='14 Sep 2026 · AMD Ryzen 7 PRO 8840HS · CPU only · runtime thread settings differ · no general model ranking.'
 elif m['boundary']=='public40':
  scope='14 Sep 2026 · 160 completed inferences · CPU only · NVIDIA 13, Small 27, Medium 19, Whisper 23 word errors.'
  hardware='Historical regression corpus; NVIDIA vs Medium descriptive 95% WER-difference interval: −0.11 to +1.41 pp.'
 else:
  scope='14 Sep 2026 · 6 completed trials + 2 failed feasibility trials · CPU only · field/state observation, not pixel paint.'
  hardware='Observed Stop ranges: NVIDIA 161–165 ms; Whisper 2,579–3,066 ms. Small sample; no percentile guarantee.'
 for y,text in zip([.151,.116,.081,.038],[*m['notes'],scope,hardware]):f.text(.055,y,text,fontsize=9.2,color=MUTED)
 save(f,m['key'],m['title'],m['subtitle']+' '+ ' '.join(m['notes'])+' '+scope+' '+hardware)

PDF.close()
index.sort(key=lambda x:x['key'])
(ROOT/'data/image-captions.json').write_text(json.dumps(index,indent=2)+'\n')
body=['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VOCO — all-model benchmark images</title><style>body{font:17px/1.6 system-ui;background:white;color:#132d3d;margin:0}main{max-width:1400px;margin:auto;padding:40px 24px}h1{font-size:42px;line-height:1.15}a{color:#087f67}article{margin:50px 0;border-top:1px solid #e5ebef;padding-top:24px}img{width:100%;height:auto}p{max-width:1100px}nav a{margin-right:20px}</style><main><h1>All tested models.<br>One metric at a time.</h1><p>15 figures · white backgrounds · 7680 × 4320 PNG · scalable SVG. The 12 metric cards use the final matched seven-configuration study. Two historical comparisons remain separate, with missing and failed trials labeled.</p><nav><a href="README.md">Read the methods</a><a href="VOCO-all-models-benchmark.pdf">PDF</a><a href="data/metric-values.csv">Exact values</a></nav>']
for a in index:
 key=a['key'];body.append(f'<article><h2>{html.escape(a["title"])}</h2><a href="png/{key}.png"><img loading="lazy" src="previews/{key}.png" alt="{html.escape(a["caption"],quote=True)}"></a><p>{html.escape(a["caption"])}</p><nav><a href="png/{key}.png">8K PNG</a><a href="svg/{key}.svg">Vector SVG</a></nav></article>')
body.append('</main></html>');(ROOT/'index.html').write_text(''.join(body))
