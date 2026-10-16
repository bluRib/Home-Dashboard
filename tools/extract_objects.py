import json,base64,struct,re,sys
V=[];G=[];cur=None
def cat(g):
    if 'window_pane' in g or g.startswith('upperWindow'):return 'glass'
    if 'opening_on_hinge' in g and not re.search(r'handle|drawer',g) and ('door' in g or re.search(r'opening_on_hinge_\d+_\d+$',g)):return 'door'
    if g.startswith(('frame','Frame_Shape','Tour_Fenetre','Fenetre')):return 'frame'
    return 'furn'
for l in open(sys.argv[2] if len(sys.argv)>2 else '../model/My_Home.obj'):
    if l.startswith('v '):p=l.split();V.append((float(p[1]),float(p[2]),float(p[3])))
    elif l.startswith('g '):cur={'n':l[2:].strip(),'f':[]};G.append(cur)
    elif l.startswith('f '):cur['f'].append([int(t.split('/')[0])-1 for t in l.split()[1:]])
def idx(n):
    try:return int(n.split('_')[-1])
    except:return -1
D={'door':[(556,564)],'window':[(610,615)],'toilet':[(851,855)],'tub':[(861,868)],'showerfix':[(913,928)],'basin':[(869,882)],
'bed':[(1469,1474)],'nightstand':[(1475,1481)],'tv':[(1489,1495)],'desk':[(1273,1281),(1303,1314)],'chair':[(1183,1191)],'dresser':[(1261,1272)],'chest':[(935,952)]}
out={}
for name,rs in D.items():
    gs=[g for g in G if g['f'] and any(a<=idx(g['n'])<=b for a,b in rs)]
    main=[g for g in gs if rs[0][0]<=idx(g['n'])<=rs[0][1]]
    pts=[V[i] for g in main for f in g['f'] for i in f]
    x0,x1=min(p[0] for p in pts),max(p[0] for p in pts);z0,z1=min(p[2] for p in pts),max(p[2] for p in pts)
    cx,cz=(x0+x1)/2,(z0+z1)/2
    parts={}
    for g in gs:
        c=cat(g['n']);d=parts.setdefault(c,{'m':{},'p':[],'i':[]})
        for f in g['f']:
            loc=[]
            for i in f:
                if i not in d['m']:d['m'][i]=len(d['p']);v=V[i];d['p'].append((v[0]-cx,v[1],v[2]-cz))
                loc.append(d['m'][i])
            for k in range(1,len(loc)-1):d['i']+=[loc[0],loc[k],loc[k+1]]
    out[name]={'s':[round(x1-x0,1),round(z1-z0,1)],'parts':{c:{'p':base64.b64encode(b''.join(struct.pack('<3f',*v) for v in d['p'])).decode(),'i':base64.b64encode(struct.pack('<%dH'%len(d['i']),*d['i'])).decode()} for c,d in parts.items()}}
    print(name,out[name]['s'],{c:len(d['p']) for c,d in parts.items()})
json.dump(out,open(sys.argv[1],'w'))
