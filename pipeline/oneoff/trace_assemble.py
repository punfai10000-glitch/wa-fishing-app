import json, numpy as np
from shapely.geometry import Polygon, mapping, Point
from shapely.ops import unary_union
T=json.load(open('/tmp/zt/traced.json'))
NAMES={ # (cls, lon, lat) -> name
 ('sanctuary',119.644,-34.380):'Doubtful Island (east)', ('sanctuary',119.515,-34.294):'Tooregullup',
 ('sanctuary',119.582,-34.178):'Cheedenup', ('sanctuary',119.720,-34.086):'Dwoort Barl Kartup',
 ('whale',119.570,-34.245):'Mamang', ('cultural',119.503,-34.342):'Tooregullup', ('cultural',119.572,-34.360):'Point Hood',
 ('sanctuary',119.769,-34.068):'Dwoort Barl Kartup', ('sanctuary',120.444,-34.065):'Jerdacuttup',
 ('sanctuary',119.905,-34.000):'Wonjarup', ('sanctuary',120.326,-33.948):'Kundong-unjip', ('cultural',119.909,-33.972):'Wongalingup',
 ('sanctuary',120.894,-34.068):'Nangarup', ('sanctuary',120.485,-34.096):'Jerdacuttup', ('sanctuary',121.605,-34.068):'Murningup',
 ('sanctuary',120.772,-33.922):'Munglinup', ('sanctuary',121.117,-33.879):'Benwenerup', ('sanctuary',121.418,-33.840):'Wari-irning',
 ('wildlife',121.350,-33.877):'Red Island', ('wildlife',121.345,-33.867):'Red Island', ('wildlife',121.357,-33.866):'Red Island',
 ('sanctuary',121.998,-34.453):'Dwert Balgart', ('sanctuary',121.656,-34.063):'Murningup', ('sanctuary',122.188,-34.055):'Mandooweernup',
 ('sanctuary',122.024,-33.958):'Moort', ('sanctuary',122.482,-33.964):'Puudal Mia', ('sanctuary',122.677,-33.914):'Membinup',
 ('sanctuary',122.871,-34.083):'Yirrangudding', ('whale',123.009,-33.902):'Thomas River–Yokinup Bay',
 ('sanctuary',123.560,-34.312):'Madjet Kubitj', ('sanctuary',123.539,-33.971):'Marlee-Maletup',
 ('whale',123.057,-33.906):'Thomas River–Yokinup Bay', ('wildlife',123.250,-34.030):'Cape Arid',
}
MAPREF={'mamang-west':'Map 7 (Mamang Maambakoort – west, DBCA 2024)','mamang-east':'Map 8 (Mamang Maambakoort – east, DBCA 2024)',
 'wudjari-west':'Map 10 (Wudjari plan 2024)','wudjari-central':'Map 12 (Wudjari plan 2024)','wudjari-east':'Map 14 (Wudjari plan 2024)'}
LINK={'Mamang Maambakoort':'https://www.dbca.wa.gov.au/management/plans/mamang-maambakoort-marine-park-joint-management-plan',
      'Wudjari':'https://www.dbca.wa.gov.au/scmp'}
groups={}
for key,d in T.items():
    for f in d['feats']:
        g=Polygon(f['ring']).buffer(0)
        best=min(NAMES,key=lambda k:(k[0]!=f['cls'])*99+g.distance(Point(k[1],k[2])))
        if best[0]!=f['cls'] or g.distance(Point(best[1],best[2]))>0.03:
            print('UNNAMED',key,f['cls'],f['c'],f['area_ha']); continue
        k=(f['cls'],NAMES[best],f['park']); groups.setdefault(k,{'geoms':[],'maps':set()})
        groups[k]['geoms'].append(g); groups[k]['maps'].add(MAPREF[key])
SAN_D=['✗ Line fishing (shore or boat)','✗ Spearfishing','✗ Collecting anything (shellfish, crabs, abalone, bait)','✓ Swimming, snorkelling, diving (look, don\'t take)','✓ Boating, surfing, wildlife watching']
feats=[]
for (cls,name,park),v in sorted(groups.items()):
    g=unary_union(v['geoms'])
    if name=='Moort': g=g.buffer(0.0012)   # tiny on the map: pad so the whole bay counts
    g=g.simplify(0.00004)
    if cls=='sanctuary':
        p=dict(name=f'{name} Sanctuary Zone',zone_type='sanctuary',prohibits=['shore','spear'],
               note='sanctuary zone — no fishing or collecting of any kind (line, spear, hand).',details=SAN_D)
    elif cls=='wildlife':
        p=dict(name=f'{name} Special Purpose Zone (wildlife conservation)',zone_type='special_purpose',prohibits=['shore','spear'],
               note='wildlife conservation zone for sea lions and seabirds — no line fishing or spearfishing; only hand collection of abalone, rock lobster, octopus and shells.',
               details=['✗ Line fishing','✗ Spearfishing','✓ Hand collection only (abalone, rock lobster, octopus, shells) under normal rules','⚠ Sea lion breeding area — stay 50 m away in the water, 100 m in a boat'])
    elif cls=='whale':
        p=dict(name=f'{name} Special Purpose Zone (whale conservation)',zone_type='special_purpose',prohibits=[],
               note='southern right whale calving area — fishing allowed under the normal rules; seasonal boat limits may apply (about May–Oct).',
               details=['✓ Line fishing and spearfishing (normal rules)','⚠ Whales calve here in winter–spring: stay 100 m from whales in the water and in a boat','⚠ Seasonal speed / vessel limits may apply'])
    else:
        p=dict(name=f'{name} Special Purpose Zone (cultural protection)',zone_type='special_purpose',prohibits=[],
               note='Aboriginal cultural area — recreational fishing allowed under the normal rules; please respect the site.',
               details=['✓ Line fishing and spearfishing (normal rules; spearfishing still banned in estuaries)','⚠ Culturally significant Sea Country — respect signs and sites'])
    p.update(park=park,link=LINK[park],source='Traced from '+'; '.join(sorted(v['maps']))+'. Lines at the printed coordinates are exact; other edges approximate (about ±100 m).',approx=True)
    geom=mapping(g)
    def rnd(x): return [rnd(i) for i in x] if isinstance(x[0],(list,tuple)) else [round(x[0],5),round(x[1],5)]
    geom={'type':geom['type'],'coordinates':rnd(geom['coordinates'])}
    feats.append({'type':'Feature','properties':p,'geometry':geom})
    print(f"{p['name']:<70} {g.area*111*111*0.83*100:8.0f} ha  {len(v['geoms'])} pieces")
out={'type':'FeatureCollection','generated_at':'2026-11-26','covers_parks':['Mamang Maambakoort','Wudjari'],
     'source':'DBCA zoning maps (Mamang Maambakoort Maps 7–8; Wudjari Marine Park Joint Management Plan 2024, Maps 10, 12, 14) — georeferenced on the printed boundary coordinates and traced. Rules: Wudjari plan Table 1; DBCA South Coast marine parks.',
     'features':feats}
json.dump(out,open('/home/claude/wa-fishing-app/data/zones/south-coast.geojson','w'),separators=(',',':'))
