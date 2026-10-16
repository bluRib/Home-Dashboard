"""Build a viewer page from the template.
usage: python build_page.py TEMPLATE MODEL LABELS OUT MODE "TITLE"
  MODE 1 = first floor only (uses MODEL from the Sweet Home 3D export)
  MODE 2 = second floor only (MODEL can be "none")
  MODE 0 = both floors with level buttons
examples (from the tools folder):
  python build_page.py viewer-template.html ../model/model.json ../model/labels.json ../viewer/home-level0.html 1 "Home, level 0"
  python build_page.py viewer-template.html none ../model/labels.json ../viewer/home-level1.html 2 "Home, level 1"
"""
import sys,json
tpl,model,labels,out,mode,title=sys.argv[1:7]
m='{}' if model=='none' else open(model).read()
t=open(tpl).read().replace('__MODEL__',m).replace('__LABELS__',json.dumps(json.load(open(labels)))).replace('__MODE__',str(int(mode))).replace('__TITLE__',title).replace('__OBJS__',open(__import__('os').path.join(__import__('os').path.dirname(labels),'objects.json')).read())
open(out,'w').write(t)
print('wrote',out)
