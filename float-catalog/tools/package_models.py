"""Validate portable exports, generate the download index, and package only deliverables."""
import csv
import hashlib
import html
import json
from pathlib import Path
import struct
import zipfile
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/models'
DOWNLOADS=ROOT/'downloads'
DOWNLOADS.mkdir(exist_ok=True)
manifest=json.loads((ROOT/'data/models.json').read_text())
catalog=json.loads((ROOT/'data/catalog.json').read_text())
reports=[]
readme='''FLOAT LIBRARY - BLENDER LOW-POLY MODELS

54 individually named FBX models, each with an embedded WebP base-color texture.
Each model folder also contains the external WebP, GLB preview, editable Blender
source, and model.json with catalog name, loading rating, dimensions and checks.

Units: meters. Export orientation: Y up, -Z forward. Blender source: Z up.
Origin: bottom center of the assembled float. One UV-mapped mesh and material.
The rotational form and open line eye have named vertex groups for editing.
Texture: 256 x 1024 pixels, lossy WebP quality 90. The hollow tube preserves alpha.
Use the supplied WebP if your FBX importer does not bind embedded image content.

DIMENSIONS
14 models use a single source-listed overall length. F47 uses 195 mm, the
midpoint of the listed 190-200 mm range. The other 39 use explicitly ESTIMATED
working lengths, including F09/F40 whose h-16 marking is not a confirmed full
assembly height. All diameters and component proportions are approximations
of adapted front illustrations. These are visual models, not measured scans.
Catalog gram ratings are load markings, not verified object masses.
Families with shared references retain the same illustrative proportions.

F53 is not modeled: both source images show fishing line instead of the float.
Original catalog names and ratings are retained in the JSON manifests.
Colors were reinterpreted; manufacturer logos are omitted.

The complete library is also supplied as float-library.fbx and .glb.
Open float-library.blend for the entire editable library, or an individual
model folder's .blend file. Use the JSON profile data and tools/build_models.py
to adjust geometry and regenerate exports with Blender 5.2 or later.
'''
(DOWNLOADS/'README.txt').write_text(readme,encoding='ascii')

for model in manifest['models']:
    slug=model['id'].lower()
    folder=OUT/slug
    fbx=(folder/model['files']['fbx']).read_bytes()
    webp=(folder/'basecolor.webp').read_bytes()
    assert fbx.startswith(b'Kaydara FBX Binary'),slug
    assert fbx.find(webp)>=0,(slug,'embedded image differs')
    assert webp[:4]==b'RIFF' and webp[8:12]==b'WEBP'
    assert b'VP8 ' in webp and b'VP8L' not in webp,(slug,'expected lossy WebP')
    image=Image.open(folder/'basecolor.webp')
    assert image.size==(256,1024)
    if slug=='f11':
        assert image.mode=='RGBA' and image.getchannel('A').getextrema()==(100,255)
    glb=(folder/model['files']['glb']).read_bytes()
    assert glb[:4]==b'glTF'
    n=struct.unpack_from('<I',glb,12)[0]
    gltf=json.loads(glb[20:20+n])
    assert 'EXT_texture_webp' in gltf['extensionsRequired']
    assert gltf['images'][0]['mimeType']=='image/webp'
    assert gltf.get('buffers') and not any('uri' in b for b in gltf['buffers'])
    assert len(gltf['meshes'])==1 and len(gltf['materials'])==1
    if slug=='f11':
        assert gltf['materials'][0]['alphaMode']=='BLEND'
    assert 100<model['triangles']<1500
    assert model['validation']['fbxReimport']=='passed'
    assert abs(model['dimensionsMm'][2]-model['lengthMm'])<.001
    files={key:{'bytes':(folder/value).stat().st_size,'sha256':hashlib.sha256((folder/value).read_bytes()).hexdigest()}
        for key,value in model['files'].items()}
    reports.append({'id':model['id'],'checks':'passed','files':files})
    with zipfile.ZipFile(DOWNLOADS/(slug+'.zip'),'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for value in model['files'].values():
            z.write(folder/value,slug+'/'+value)
        z.write(folder/'model.json',slug+'/model.json')
        z.writestr(slug+'/README.txt',readme)

validation={'models':54,'result':'passed','checks':['All FBX reimport dimensions','Embedded WebP bytes',
    'Lossy WebP bitstream','Hollow tube alpha','Standalone GLB with WebP','Mesh and triangle budget'],
    'minimumTriangles':min(m['triangles'] for m in manifest['models']),
    'maximumTriangles':max(m['triangles'] for m in manifest['models']),
    'totalTriangles':sum(m['triangles'] for m in manifest['models']),'files':reports}
(ROOT/'data/model-validation.json').write_text(json.dumps(validation,indent=2),encoding='ascii')

for item in catalog['items']:
    model=next((m for m in manifest['models'] if m['id']==item['id']),None)
    if model:
        item['model']={k:model[k] for k in ['lengthMm','scaleBasis','dimensionNote','triangles','files']}
        item['status']='modeled'
catalog['catalogVersion']='2026-10-24.3'
(ROOT/'data/catalog.json').write_text(json.dumps(catalog,indent=2,ensure_ascii=True),encoding='ascii')

with (DOWNLOADS/'model-index.csv').open('w',newline='',encoding='ascii') as f:
    writer=csv.writer(f)
    writer.writerow(['id','name','catalog_rating_g','model_length_mm','scale_basis','triangles','fbx','webp'])
    for m in manifest['models']:
        slug=m['id'].lower()
        writer.writerow([m['id'],m['title'],m['rating'] or 'Not specified',m['lengthMm'],m['scaleBasis'],m['triangles'],'assets/models/'+slug+'/'+m['files']['fbx'],'assets/models/'+slug+'/basecolor.webp'])

rows=[]
for item in catalog['items']:
    m=next((m for m in manifest['models'] if m['id']==item['id']),None)
    slug=item['id'].lower()
    rating='Not specified' if item['rating'] is None else item['rating'].replace('+',' + ')+' g'
    links='No usable reference' if not m else ' / '.join('<a download href="'+html.escape(href)+'">'+label+'</a>' for href,label in [('../assets/models/'+slug+'/'+m['files']['fbx'],'FBX'),('../assets/models/'+slug+'/basecolor.webp','WebP'),(slug+'.zip','ZIP'),('../assets/models/'+slug+'/'+m['files']['blend'],'Blend')])
    scale='Not modeled' if not m else str(m['lengthMm'])+' mm / '+m['scaleBasis']
    rows.append('<tr><td><a href="../#'+item['id']+'">'+item['id']+'</a></td><td>'+html.escape(item['title'])+'<small>'+html.escape(item['sourceName'])+'</small></td><td>'+html.escape(rating)+'</td><td>'+html.escape(scale)+'</td><td>'+links+'</td></tr>')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Float model downloads</title><style>body{margin:30px;background:#102017;color:#dde9ce;font:14px/1.5 system-ui}a{color:#c5dc9b}h1{font-size:32px}p{color:#9eb48a}table{border-collapse:collapse;width:100%;min-width:900px}td,th{text-align:left;padding:13px;border-bottom:1px solid #344c2d}td:first-child{width:50px}th{color:#a8bd91}small{display:block;color:#8da47a;font-size:11px}.scroll{overflow:auto}.actions{display:flex;gap:25px;margin:25px 0}</style><h1>Float model downloads.</h1><p>54 Blender models with individual FBX and WebP files. Estimated dimensions are labeled.</p><div class="actions"><a href="float-models-all.zip" download>Download all models</a><a href="../float-library.blend" download>Entire Blender library</a><a href="../">Return to 3D preview</a></div><div class="scroll"><table><thead><tr><th>ID</th><th>Catalog name</th><th>Loading rating</th><th>Model length / basis</th><th>Files</th></tr></thead><tbody>'''+''.join(rows)+'''</tbody></table></div></html>'''
(DOWNLOADS/'index.html').write_text(page.encode('ascii','xmlcharrefreplace').decode('ascii'),encoding='ascii')

# Number the Blender contact render without changing the texture or model exports.
sheet=Image.open(ROOT/'assets/models-contact.png').convert('RGB')
draw=ImageDraw.Draw(sheet)
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',25)
for i,m in enumerate(manifest['models']):
    x=round(205+(i%9)*259.0)
    y=round(434+(i//9)*508.5)
    text=m['id']+' / '+str(m['lengthMm']).removesuffix('.0')+' mm'
    width=draw.textlength(text,font=font)
    draw.text((x-width/2,y),text,fill=(35,55,38),font=font)
sheet.save(ROOT/'assets/model-library.webp',quality=90,method=6,lossless=False)

with zipfile.ZipFile(DOWNLOADS/'float-models-all.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    z.writestr('README.txt',readme)
    for extension in ['blend','fbx','glb']:
        z.write(ROOT/('float-library.'+extension),'float-library.'+extension)
    for texture in sorted((ROOT/'assets/library-textures').glob('*.webp')):
        z.write(texture,'assets/library-textures/'+texture.name)
    z.write(ROOT/'data/models.json','data/models.json')
    z.write(ROOT/'data/catalog.json','data/catalog.json')
    z.write(ROOT/'data/model-profiles.json','data/model-profiles.json')
    z.write(ROOT/'data/model-validation.json','data/model-validation.json')
    z.write(ROOT/'data/library-validation.json','data/library-validation.json')
    z.write(DOWNLOADS/'model-index.csv','model-index.csv')
    z.write(ROOT/'assets/model-library.webp','model-library.webp')
    for name in ['build_models.py','export_library.py']:
        z.write(ROOT/'tools'/name,'tools/'+name)
    for m in manifest['models']:
        slug=m['id'].lower()
        for name in list(m['files'].values())+['model.json']:
            z.write(OUT/slug/name,'assets/models/'+slug+'/'+name)
print(json.dumps({'models':54,'triangles':[validation['minimumTriangles'],validation['maximumTriangles']],
    'allZipBytes':(DOWNLOADS/'float-models-all.zip').stat().st_size,'individualPackages':len(list(DOWNLOADS.glob('f[0-9][0-9].zip')))}))
