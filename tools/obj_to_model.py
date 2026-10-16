"""Convert a Sweet Home 3D OBJ export into model.json for the home viewer.
usage: python obj_to_model.py My_Home.obj model.json
Units stay in centimeters (Sweet Home 3D default).
"""
import sys,json,base64,struct,re,collections
V=[];groups=[];cur=None
def cat(g):
    if g.startswith('ground'):return 'ground'
    if g.startswith('wall'):return 'wall'
    if g.startswith('room'):return 'floor'
    if 'window_pane' in g or g.startswith('upperWindow'):return 'glass'
    if 'opening_on_hinge' in g and not re.search(r'handle|drawer',g):return 'door'
    if g.startswith(('frame','Frame_Shape','Tour_Fenetre','Fenetre')):return 'frame'
    return 'furn'
for l in open(sys.argv[1]):
    if l.startswith('v '):p=l.split();V.append((float(p[1]),float(p[2]),float(p[3])))
    elif l.startswith('g '):cur={'n':l[2:].strip(),'f':[]};groups.append(cur)
    elif l.startswith('f '):
        idx=[int(t.split('/')[0]) for t in l.split()[1:]];cur['f'].append([i-1 if i>0 else len(V)+i for i in idx])
def bb(fs):
    xs=[V[i][0] for f in fs for i in f];zs=[V[i][2] for f in fs for i in f];ys=[V[i][1] for f in fs for i in f]
    return min(xs),max(xs),min(zs),max(zs),min(ys),max(ys)
walls=collections.defaultdict(list)
for g in groups:
    if g['n'].startswith('wall') and g['f']:walls[g['n'].split('_')[1]]+=g['f']
WB={n:bb(fs) for n,fs in walls.items()}
def hits(x,z,dx,dz,skip):
    for n,(x0,x1,z0,z1,_,_) in WB.items():
        if n==skip:continue
        if dx:
            if z0-1<=z<=z1+1 and ((dx>0 and x0>x) or (dx<0 and x1<x)):return True
        else:
            if x0-1<=x<=x1+1 and ((dz>0 and z0>z) or (dz<0 and z1<z)):return True
    return False
ext=set()
for n,(x0,x1,z0,z1,_,_) in WB.items():
    mx,mz=(x0+x1)/2,(z0+z1)/2
    if x1-x0>z1-z0:  # runs along x, normal z
        if not hits(mx,z0-1,0,-1,n) or not hits(mx,z1+1,0,1,n):ext.add(n)
    else:
        if not hits(x0-1,mz,-1,0,n) or not hits(x1+1,mz,1,0,n):ext.add(n)
print('exterior walls',len(ext),'of',len(WB))
EB=[WB[n] for n in ext]
cats={}
for g in groups:
    if not g['f']:continue
    c=cat(g['n'])
    if c=='wall' and g['n'].split('_')[1] in ext:c='wallx'
    elif c in('glass','frame','door'):
        x0,x1,z0,z1,_,_=bb(g['f']);cx,cz=(x0+x1)/2,(z0+z1)/2
        for (a0,a1,b0,b1,_,_) in EB:
            if a0-20<=cx<=a1+20 and b0-20<=cz<=b1+20:c+='x';break
    d=cats.setdefault(c,{'map':{},'pos':[],'ind':[]})
    for f in g['f']:
        if c=='floor' and any(V[i][1]>5 for i in f):continue  # skip room ceilings
        loc=[]
        for i in f:
            if i not in d['map']:d['map'][i]=len(d['pos']);d['pos'].append(V[i])
            loc.append(d['map'][i])
        for k in range(1,len(loc)-1):d['ind']+=[loc[0],loc[k],loc[k+1]]
out={}
for k,c in cats.items():
    big=len(c['pos'])>65535
    out[k]={'p':base64.b64encode(b''.join(struct.pack('<3f',*v) for v in c['pos'])).decode(),'i':base64.b64encode(struct.pack('<%d%s'%(len(c['ind']),'I' if big else 'H'),*c['ind'])).decode(),'b':big}
    print(k,len(c['pos']))
json.dump(out,open(sys.argv[2],'w'))
