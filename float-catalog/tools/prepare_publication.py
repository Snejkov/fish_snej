"""Add the reviewed float collection to the existing, unchanged asset-library UI."""
import hashlib
import json
import argparse
from pathlib import Path
import shutil
import tarfile
from datetime import datetime,timezone
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'publication'
PREVIEW=WORK/'preview'
PAYLOAD=WORK/'payload'
UPSTREAM=WORK/'upstream'
ORIGIN='http://144.31.28.132/'
COLLECTION='badis-floats-2026-10-24'
STATIC=['index.html','app.js','viewer.js','style.css','favicon.svg',
        'vendor/GLTFLoader.js','vendor/three.module.js','vendor/BufferGeometryUtils.js','vendor/OrbitControls.js']
parser=argparse.ArgumentParser()
parser.add_argument('--offline',action='store_true',help='Reuse the previously fetched public site snapshot')
args=parser.parse_args()
for folder in [PREVIEW,PAYLOAD,UPSTREAM]:
    folder.mkdir(parents=True,exist_ok=True)

def encoded(value):
    return json.dumps(value,indent=2,ensure_ascii=True).encode('ascii')+b'\n'

def fetch(path):
    with urlopen(ORIGIN+path,timeout=30) as response:
        return response.read()

for relative in STATIC+['catalog.json']:
    content=(UPSTREAM/relative).read_bytes() if args.offline else fetch(relative)
    target=UPSTREAM/relative
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(content)
    if relative!='catalog.json':
        dest=PREVIEW/relative
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_bytes(content)

base_bytes=(UPSTREAM/'catalog.json').read_bytes()
base=json.loads(base_bytes)
manifest=json.loads((ROOT/'data/models.json').read_text())
catalog=json.loads((ROOT/'data/catalog.json').read_text())
source_items={i['id']:i for i in catalog['items']}
thumbnail_items={i['id']:i for i in json.loads((ROOT/'data/thumbnails.json').read_text())['items']}
old_imports=[m for m in base['models'] if m.get('collectionId')==COLLECTION]
preserved=[m for m in base['models'] if m.get('collectionId')!=COLLECTION]
stamp=datetime.now(timezone.utc).replace(tzinfo=None,microsecond=0).isoformat()
records=[]
files=[]

def add_file(source,relative):
    target=PAYLOAD/relative
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source,target)
    files.append(relative)

for model in manifest['models']:
    slug=model['id'].lower()
    item=source_items[model['id']]
    directory='assets/floats/'+slug+'/'
    for name in list(model['files'].values())+['model.json']:
        add_file(ROOT/'assets/models'/slug/name,directory+name)
    archive='downloads/floats/'+slug+'.zip'
    add_file(ROOT/'downloads'/(slug+'.zip'),archive)
    thumb='thumbnails/floats/'+slug+'.webp'
    thumbnail=thumbnail_items[model['id']]
    assert thumbnail['modelPath']=='assets/models/'+slug+'/'+model['files']['glb']
    assert hashlib.sha256((ROOT/thumbnail['modelPath']).read_bytes()).hexdigest()==thumbnail['modelSha256']
    thumbnail_source=ROOT/thumbnail['thumbnailPath']
    assert hashlib.sha256(thumbnail_source.read_bytes()).hexdigest()==thumbnail['thumbnailSha256']
    add_file(thumbnail_source,thumb)
    rating='Not specified' if model['rating'] is None else model['rating'].replace('+',' + ')+' g'
    identifier='catalog_float_'+slug
    if any(m['id']==identifier for m in preserved):
        raise ValueError('Existing catalog ID belongs to a different collection: '+identifier)
    description=(f"{item['title']}. Catalog loading: {rating}. "
        f"Model height: {model['lengthMm']:g} mm. {model['dimensionNote']} "
        "One low-poly mesh and material; lossy WebP quality 90. "
        "Available as FBX, GLB and editable Blender source in the ZIP. "
        "Library asset; not connected to the game yet.")
    # Source names and existing status enums are data, serialized with ASCII escapes.
    record={
        'id':identifier,'title':model['id']+' / '+item['sourceName'],
        'category':'bobbers','default':0,'origin':'file',
        'status':'\u0412 \u0437\u0430\u043f\u0430\u0441\u0435',
        'description':description,'path':directory+model['files']['fbx'],
        'key':model['id'],'usage':[],'updated':stamp,
        'thumbnail':thumb+'?v='+thumbnail['thumbnailSha256'][:12],
        'thumbnailModelSha256':thumbnail['modelSha256'],
        'thumbnailSha256':thumbnail['thumbnailSha256'],
        'archive':archive,'archiveBytes':(PAYLOAD/archive).stat().st_size,
        'collectionId':COLLECTION,'sourceProduct':item['sourceUrl'],
        'catalogRating':model['rating'],'scaleBasis':model['scaleBasis'],
        'dimensionNote':model['dimensionNote'],
        'variants':[{
            'id':identifier+'-0','label':model['id']+' / Low-poly / '+rating,
            'url':directory+model['files']['glb'],
            'source':directory+model['files']['fbx'],
            'bytes':(PAYLOAD/directory/model['files']['fbx']).stat().st_size,
            'previewBytes':(PAYLOAD/directory/model['files']['glb']).stat().st_size,
            'triangles':model['triangles'],'materials':1,
            'dimensions':[round(model['dimensionsMm'][0]/1000,8),
                          round(model['lengthMm']/1000,8),
                          round(model['dimensionsMm'][1]/1000,8)],
            'texture':directory+'basecolor.webp','fbx':directory+model['files']['fbx'],
        }],
    }
    records.append(record)

for filename in ['float-library.fbx','float-library.glb','float-library.blend']:
    add_file(ROOT/filename,'downloads/floats/'+filename)
add_file(ROOT/'downloads/float-models-all.zip','downloads/floats/float-models-all.zip')

def resource(relative):
    content=(PAYLOAD/relative).read_bytes()
    digest=hashlib.sha256(content).hexdigest()
    return {'url':ORIGIN+relative+'?v='+digest[:12],
            'path':relative,'sha256':digest,'bytes':len(content)}

feed_items=[]
for model in manifest['models']:
    slug=model['id'].lower()
    folder='assets/floats/'+slug+'/'
    feed_items.append({
        'id':model['id'],'name':model['title'],'sourceName':model['sourceName'],
        'rating':model['rating'],'ratingMeaning':'Catalog loading marking, not object mass',
        'lengthMm':model['lengthMm'],'scaleBasis':model['scaleBasis'],
        'dimensionNote':model['dimensionNote'],'triangles':model['triangles'],
        'dimensionsMeters':[round(model['dimensionsMm'][0]/1000,8),
                            round(model['lengthMm']/1000,8),
                            round(model['dimensionsMm'][1]/1000,8)],
        'files':{
            'glb':resource(folder+model['files']['glb']),
            'fbx':resource(folder+model['files']['fbx']),
            'texture':resource(folder+'basecolor.webp'),
            'thumbnail':resource('thumbnails/floats/'+slug+'.webp'),
            'package':resource('downloads/floats/'+slug+'.zip'),
        },
    })
feed={'schemaVersion':1,'collectionId':COLLECTION,'generatedAt':stamp+'Z',
      'version':hashlib.sha256(encoded(feed_items)).hexdigest(),
      'units':'meters','upAxis':'Y','forwardAxis':'-Z','origin':'bottom-center',
      'preferredRuntimeFormat':'glb','glbTexturesEmbedded':True,
      'items':feed_items,'downloadAll':resource('downloads/floats/float-models-all.zip'),
      'missing':[{'id':'F53','reason':'No usable float reference image'}]}
feed_path='assets/floats/catalog.json'
(PAYLOAD/feed_path).write_bytes(encoded(feed))
files.append(feed_path)
(ROOT/'data/library-feed.json').write_bytes(encoded(feed))

updated={**base,'generatedAt':stamp,'models':preserved+records,
         'sourceFiles':base['sourceFiles']-len(old_imports)+len(records)}
assert len(records)==54 and len({r['id'] for r in updated['models']})==len(updated['models'])
for original in preserved:
    assert original==next(m for m in updated['models'] if m['id']==original['id'])
(PAYLOAD/'catalog.json').write_bytes(encoded(updated))
files.append('catalog.json')
for relative in files:
    dest=PREVIEW/relative
    dest.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(PAYLOAD/relative,dest)
# Only the local review uses remote URLs for untouched pre-existing assets.
review=json.loads(encoded(updated))
for model in review['models']:
    if model.get('collectionId')==COLLECTION:
        continue
    for field in ['thumbnail','archive']:
        if model.get(field): model[field]=ORIGIN+model[field]
    for variant in model['variants']:
        for field in ['url','godot']:
            if variant.get(field): variant[field]=ORIGIN+variant[field]
(PREVIEW/'catalog.json').write_bytes(encoded(review))

inventory=[{'path':p,'bytes':(PAYLOAD/p).stat().st_size,
    'sha256':hashlib.sha256((PAYLOAD/p).read_bytes()).hexdigest()} for p in sorted(files)]
revision=hashlib.sha256(encoded(inventory)).hexdigest()[:12]
report={
    'collectionId':COLLECTION,'origin':ORIGIN,'release':'floats-'+revision,
    'baseCatalogSha256':hashlib.sha256(base_bytes).hexdigest(),
    'catalogSha256':hashlib.sha256((PAYLOAD/'catalog.json').read_bytes()).hexdigest(),
    'addedModels':len(records),'preservedModels':len(preserved),
    'totalModels':len(updated['models']),
    'totalBobbers':sum(m['category']=='bobbers' for m in updated['models']),
    'feedUrl':ORIGIN+feed_path,'feedVersion':feed['version'],
    'skipped':[{'id':'F53','reason':'No usable float reference image'}],
    'files':inventory,
}
(WORK/'manifest.json').write_bytes(encoded(report))
(ROOT/'data/library-import.json').write_bytes(encoded({'collectionId':COLLECTION,'models':records}))
(ROOT/'data/library-publication.json').write_bytes(encoded({k:v for k,v in report.items() if k!='files'}))
with tarfile.open(WORK/'floats-payload.tar.gz','w:gz') as archive:
    archive.add(WORK/'manifest.json',arcname='manifest.json')
    for relative in sorted(files):
        archive.add(PAYLOAD/relative,arcname='dist/'+relative)
print(json.dumps({k:v for k,v in report.items() if k not in ['files','skipped']}))
print('PAYLOAD_BYTES',(WORK/'floats-payload.tar.gz').stat().st_size)
