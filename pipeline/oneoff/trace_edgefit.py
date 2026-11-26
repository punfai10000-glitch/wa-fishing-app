import sys; sys.path.insert(0,__import__('os').path.dirname(__file__))
from trace_zone_maps import *
def zone_mask(a):
    m=np.zeros(a.shape[:2],bool)
    for cols in CLS.values():
        for c in cols: m|=near(a,c)
    return m
def edge_controls(pg,a,cfg,Z,win=14,span=40):
    m=zone_mask(a); H,W=m.shape
    ctr=[]
    for bl in pg.get_text('dict')['blocks']:
        for l in bl.get('lines',[]):
            t=''.join(s['text'] for s in l['spans']).replace('”','"').replace('’',"'")
            mm=DMS.search(t)
            if not mm: continue
            d,mi,s,h=mm.groups(); v=int(d)+int(mi)/60+float(s)/3600
            x0,y0,x1,y1=l['bbox']; xc,yc=(x0+x1)/2,(y0+y1)/2
            if not inrect(xc,yc,cfg['main']) or any(inrect(xc,yc,r) for r in cfg['excl']): continue
            if h in 'EW':  # meridian: vertical edge near label x
                ya,yb=int((y0-span)*Z),int((y1+span)*Z); best=(0,None)
                for xi in range(int((xc-win)*Z),int((xc+win)*Z)):
                    if 1<=xi<W:
                        sc=(m[max(0,ya):yb,xi]^m[max(0,ya):yb,xi-1]).sum()
                        if sc>best[0]: best=(sc,xi)
                if best[0]>=6*Z: ctr.append(('lon',v,best[1]/Z,best[0]))
            else:
                v=-v; xa,xb=int((x0-span)*Z),int((x1+span)*Z); best=(0,None)
                for yi in range(int((yc-win)*Z),int((yc+win)*Z)):
                    if 1<=yi<H:
                        sc=(m[yi,max(0,xa):xb]^m[yi-1,max(0,xa):xb]).sum()
                        if sc>best[0]: best=(sc,yi)
                if best[0]>=6*Z: ctr.append(('lat',v,best[1]/Z,best[0]))
    return ctr
def fit_edges(ctr):
    res={}
    for ax in ('lon','lat'):
        pts=np.array([(v,p) for k,v,p,s in ctr if k==ax])
        if len(pts)<2: res[ax]=None; continue
        # robust: iterative drop worst
        keep=np.ones(len(pts),bool)
        for _ in range(len(pts)):
            A=np.c_[np.ones(keep.sum()),pts[keep,0]]; c=np.linalg.lstsq(A,pts[keep,1],rcond=None)[0]
            r=np.abs(c[0]+c[1]*pts[:,0]-pts[:,1])
            if keep.sum()<=2 or r[keep].max()<1.0: break
            keep[np.argmax(np.where(keep,r,-1))]=False
        res[ax]=(c,r,keep)
    return res
if __name__=='__main__':
    for key in sys.argv[1:]:
        cfg=MAPS[key]; Z=cfg['zoom']; pg,a=render(cfg['pdf'],cfg['page'],Z)
        ctr=edge_controls(pg,a,cfg,Z); R=fit_edges(ctr)
        for ax in R:
            if R[ax] is None: print(key,ax,'none'); continue
            c,r,k=R[ax]; print(key,ax,'coef',c.round(3),'resid pt',r.round(2),'keep',k.astype(int))
