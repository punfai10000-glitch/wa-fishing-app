# One-off: traces South Coast marine park zones from the DBCA zoning map PDFs (raster colours, georeferenced on the
# printed boundary coordinates). Inputs are the PDFs Chloe supplied (not in the repo). Output: data/zones/south-coast.geojson
import sys, json, cv2
sys.path.insert(0,__import__('os').path.dirname(__file__))
from trace_common import *
UP='/mnt/user-data/uploads/'
MAPS={
 'mamang-west':dict(pdf=UP+'fd378b14-mamang-maambakoort-marine-park-zoning-map-west.pdf',page=0,zoom=4,park='Mamang Maambakoort',
    main=(51,51,1140,790),excl=[(50,50,348,350),(774,158,1173,324),(619,331,1173,536),(619,536,1173,774),(843,50,1173,158)]),
 'mamang-east':dict(pdf=UP+'22641f9b-mamang-maambakoort-marine-park-zoning-map-east.pdf',page=0,zoom=4,park='Mamang Maambakoort',
    main=(51,51,1140,790),excl=[(50,50,494,286),(500,50,666,179),(672,50,1172,292),(422,547,845,762),(50,637,422,762)]),
 'wudjari-west':dict(pdf=UP+'6c5c884c-212786.pdf',page=100,zoom=2,park='Wudjari',
    main=(55,68,1142,785),excl=[(55,635,432,785),(814,582,1142,785)]),
 'wudjari-central':dict(pdf=UP+'6c5c884c-212786.pdf',page=104,zoom=2,park='Wudjari',
    main=(55,68,1142,785),excl=[(55,537,157,785),(838,576,1142,785)]),
 'wudjari-east':dict(pdf=UP+'6c5c884c-212786.pdf',page=108,zoom=2,park='Wudjari',
    main=(55,68,1142,785),excl=[(207,52,596,295),(936,343,1142,560),(825,576,1142,785),(55,635,380,785)]),
}
CLS={'sanctuary':[(207,255,90)],'whale':[(240,213,255)],'cultural':[(90,162,255)],'wildlife':[(164,90,139),(115,0,75)]}
SEA=[(222,255,255),(207,255,90),(240,213,255),(90,162,255),(164,90,139)]
LAND=[(255,255,255),(204,204,204),(225,225,225),(224,224,224),(235,235,235),(205,205,205)]

def all_labels(pg):
    lat=set(); lon=set()
    for k,v,x,y,_ in labels(pg,(0,0,9999,9999),[]):
        (lat if k=='lat' else lon).add(round(v,6))
    return sorted(lat),sorted(lon)

def run(key,cfg):
    Z=cfg['zoom']; pg,a=render(cfg['pdf'],cfg['page'],Z)
    H,W=a.shape[:2]
    frame=np.zeros((H,W),bool); x0,y0,x1,y1=[int(v*Z) for v in cfg['main']]; frame[y0:y1,x0:x1]=True
    for r in cfg['excl']:
        x0,y0,x1,y1=[int(v*Z) for v in r]; frame[max(0,y0):y1,max(0,x0):x1]=False
    L=labels(pg,cfg['main'],cfg['excl']); P=fit_init(L)
    sea=np.zeros((H,W),bool)
    for c in SEA: sea|=near(a,c)
    sea|=near(a,(0,255,255),40)
    sea=ndimage.binary_closing(sea,iterations=Z)
    land=np.zeros((H,W),bool)
    for c in LAND: land|=near(a,c,6)
    edge=sea&ndimage.binary_dilation(land,iterations=2)&frame
    ys,xs=np.nonzero(edge); pts=np.c_[xs,ys]/Z
    ll=px2ll(P,pts); bb=(ll[:,0].min(),ll[:,1].min(),ll[:,0].max(),ll[:,1].max())
    cp=coast_pts(bb)
    P2,n,med=icp(P,pts,cp)
    from edgefit import edge_controls, fit_edges
    R=fit_edges(edge_controls(pg,a,cfg,Z))
    if R['lon'] is not None and R['lat'] is not None:
        P2=np.array([R['lon'][0][0],R['lon'][0][1],R['lat'][0][0],R['lat'][0][1]])
        tree=cKDTree(cp*[0.83,1]); d,_=tree.query(px2ll(P2,pts)*[0.83,1]); k=d<0.0015; n,med=k.sum(),np.median(d[k])*111000
    shift=np.abs(px2ll(P2,np.array([[600,400]]))-px2ll(P,np.array([[600,400]])))[0]*111000
    print(key,'labels',len(L),'icp pairs',n,'median resid m',round(med),'shift m',shift.round())
    lat_l,lon_l=all_labels(pg)
    mpp=1/abs(P2[1])/Z*111000*0.83   # metres per pixel (lon)
    grow=max(2,int(round(150/mpp)))
    feats=[]
    for cls,cols in CLS.items():
        m=np.zeros((H,W),bool)
        for c in cols: m|=near(a,c)
        m&=frame
        if m.sum()<50: continue
        m=ndimage.binary_closing(m,iterations=max(2,int(1.5*Z)))
        m=ndimage.binary_fill_holes(m)
        m=ndimage.binary_opening(m,iterations=1)
        other=np.zeros((H,W),bool)
        for c2,cols2 in CLS.items():
            if c2!=cls:
                for c in cols2: other|=near(a,c)
        g=m|(ndimage.binary_dilation(m,iterations=max(1,int(round(0.7*Z))))&~other&frame)
        growable=frame&~other&~near(a,(222,255,255))&~near(a,(242,255,255))   # land, coastline/boundary lines, labels — not open sea or other zones
        for _ in range(grow): g|=ndimage.binary_dilation(g)&growable
        g=ndimage.binary_fill_holes(g)
        cs,_=cv2.findContours(g.astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        for c in cs:
            area=cv2.contourArea(c)*mpp*mpp/0.83/1e4
            if area<3: continue
            c=cv2.approxPolyDP(c,0.6,True)[:,0,:].astype(float)
            ll=px2ll(P2,(c+0.5)/Z)
            tol=max(0.0009, 1.5/abs(P2[1]))
            for j in range(len(ll)):
                for vals,ax in ((lon_l,0),(lat_l,1)):
                    if vals:
                        d=np.abs(np.array(vals)-ll[j,ax]); k=d.argmin()
                        if d[k]<tol: ll[j,ax]=vals[k]
            ring=[[round(x,5),round(y,5)] for x,y in ll]; ring.append(ring[0])
            cx,cy=ll.mean(0)
            feats.append(dict(cls=cls,ring=ring,area_ha=round(area),c=(round(cx,4),round(cy,4)),map=key,park=cfg['park']))
    # callout names
    calls=[]
    for bl in pg.get_text('dict')['blocks']:
        t=' '.join(''.join(s['text'] for s in l['spans']).strip() for l in bl.get('lines',[]))
        if re.search(r'Sanctuary Zone|Special Purpose Zone',t):
            x0,y0,x1,y1=bl['bbox']; xc,yc=(x0+x1)/2,(y0+y1)/2
            if inrect(xc,yc,cfg['main']) and not any(inrect(xc,yc,r) for r in cfg['excl']):
                calls.append((t, px2ll(P2,np.array([[xc,yc]]))[0]))
    return feats,calls,P2

if __name__=='__main__':
    out={}
    for k in (sys.argv[1:] or MAPS):
        f,c,P=run(k,MAPS[k]); out[k]=dict(feats=f,calls=[(t,list(map(float,ll))) for t,ll in c])
        for x in f: print('  ',x['cls'],x['area_ha'],'ha',x['c'],len(x['ring']))
        for t,ll in c: print('  CALL',t,ll.round(4))
    json.dump(out,open('/tmp/zt/traced.json','w'))
