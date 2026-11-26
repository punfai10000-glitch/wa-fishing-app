import re, json, numpy as np, pymupdf as fitz
from PIL import Image
DMS=re.compile(r"(\d+)°\s*(\d+)'\s*(\d+(?:\.\d+)?)\"?\s*([NSEW])")
def labels(pg, main, excl):
    """return list of (kind,'lat'|'lon', value, xc, yc) for labels inside main frame and outside excl rects"""
    out=[]
    for b in pg.get_text('dict')['blocks']:
        for l in b.get('lines',[]):
            t=''.join(s['text'] for s in l['spans']).replace('”','"').replace('’',"'").strip()
            m=DMS.search(t)
            if not m: continue
            d,mi,s,h=m.groups(); v=int(d)+int(mi)/60+float(s)/3600
            x0,y0,x1,y1=l['bbox']; xc,yc=(x0+x1)/2,(y0+y1)/2
            if not inrect(xc,yc,main) or any(inrect(xc,yc,r) for r in excl): continue
            vert=abs(l['dir'][1])>0.5
            if h in 'SN': out.append(('lat',-v if h=='S' else v,xc,yc,vert))
            else: out.append(('lon',v,xc,yc,vert))
    return out
def inrect(x,y,r): return r[0]<=x<=r[2] and r[1]<=y<=r[3]
def render(pdf,page,zoom):
    pg=fitz.open(pdf)[page]
    pm=pg.get_pixmap(matrix=fitz.Matrix(zoom,zoom),alpha=False)
    a=np.frombuffer(pm.samples,dtype=np.uint8).reshape(pm.height,pm.width,3).astype(np.int16)
    return pg,a

from scipy import ndimage
from scipy.spatial import cKDTree
COAST=json.load(open('/home/claude/wa-fishing-app/data/coastline.json'))
def coast_pts(bbox):
    pts=[]
    for ln in COAST['lines']:
        for (x1,y1),(x2,y2) in zip(ln,ln[1:]):
            if not (bbox[0]-.05<x1<bbox[2]+.05 and bbox[1]-.05<y1<bbox[3]+.05): continue
            n=max(1,int(np.hypot(x2-x1,y2-y1)/0.0001))
            for t in np.linspace(0,1,n,endpoint=False): pts.append((x1+(x2-x1)*t,y1+(y2-y1)*t))
    return np.array(pts)
def near(a,col,tol=14): return np.abs(a-np.array(col)).sum(2)<tol
def fit_init(L):
    # x = a + b*lon ; y = c + d*lat  with d=-b (plate carree) -> solve 3 params
    A=[];B=[]
    for k,v,x,y,vert in L:
        if k=='lon': A.append([1,0,v]); B.append(x)
        else: A.append([0,1,-v]); B.append(y)
    p,*_=np.linalg.lstsq(np.array(A),np.array(B),rcond=None)
    a,c,b=p; return np.array([a,b,c,-b])
def px2ll(P,xy):  # xy in pt
    a,b,c,d=P; return np.c_[(xy[:,0]-a)/b,(xy[:,1]-c)/d]
def ll2px(P,ll):
    a,b,c,d=P; return np.c_[a+b*ll[:,0], c+d*ll[:,1]]
def icp(P,edge_pt,cpts,iters=30,trim=(0.006,0.0015)):
    tree=cKDTree(cpts*[0.83,1])
    for it in range(iters):
        ll=px2ll(P,edge_pt)
        d,i=tree.query(ll*[0.83,1])
        thr=trim[0] if it<8 else trim[1]
        k=d<thr
        tgt=cpts[i[k]]; src=edge_pt[k]
        # solve x = a+b*lon, y=c+d*lat independently
        A=np.c_[np.ones(k.sum()),tgt[:,0]]; a,b=np.linalg.lstsq(A,src[:,0],rcond=None)[0]
        A=np.c_[np.ones(k.sum()),tgt[:,1]]; c,dd=np.linalg.lstsq(A,src[:,1],rcond=None)[0]
        P=np.array([a,b,c,dd])
    ll=px2ll(P,edge_pt); d,i=tree.query(ll*[0.83,1]); k=d<trim[1]
    return P, k.sum(), np.median(d[k])*111000
