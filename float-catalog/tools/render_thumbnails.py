"""Render each thumbnail from its exact exported GLB, identified by catalog ID."""
import bpy
import hashlib
import json
import math
from pathlib import Path
import sys
from mathutils import Matrix,Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/thumbnails'
OUT.mkdir(exist_ok=True)
source=json.loads((ROOT/'data/models.json').read_text())['models']
selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
models=[m for m in source if not selected or m['id'] in selected]
report=[]

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

for model in models:
    reset()
    slug=model['id'].lower()
    glb=ROOT/'assets/models'/slug/model['files']['glb']
    bpy.ops.import_scene.gltf(filepath=str(glb))
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    assert len(objects)==1,(model['id'],len(objects))
    bpy.context.view_layer.update()
    points=[o.matrix_world @ v.co for o in objects for v in o.data.vertices]
    lower=Vector([min(p[i] for p in points) for i in range(3)])
    upper=Vector([max(p[i] for p in points) for i in range(3)])
    size=upper-lower
    assert abs(size.z*1000-model['lengthMm'])<.001,(model['id'],list(size))
    triangles=sum(len(p.vertices)-2 for o in objects for p in o.data.polygons)
    assert triangles==model['triangles']
    center=(lower+upper)/2
    # Presentation transforms apply only to this temporary imported scene.
    transform=Matrix.Scale(1/size.z,4) @ Matrix.Translation(-center)
    for obj in objects:
        original=obj.matrix_world.copy()
        obj.parent=None
        obj.matrix_world=transform @ original
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.samples=8
    scene.cycles.use_denoising=True
    scene.render.resolution_x=600
    scene.render.resolution_y=450
    scene.render.resolution_percentage=100
    scene.render.film_transparent=False
    scene.render.image_settings.file_format='WEBP'
    scene.render.image_settings.quality=90
    scene.render.image_settings.color_mode='RGBA'
    scene.view_settings.view_transform='Standard'
    scene.view_settings.look='None'
    world=bpy.data.worlds.new('Neutral_Background')
    world.use_nodes=True
    world.node_tree.nodes['Background'].inputs['Color'].default_value=(.50,.54,.49,1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7
    scene.world=world
    camera_data=bpy.data.cameras.new('Thumbnail_Camera')
    camera=bpy.data.objects.new('Thumbnail_Camera',camera_data)
    scene.collection.objects.link(camera)
    camera.location=(0,-3,0)
    camera.rotation_euler=(Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type='ORTHO'
    camera_data.ortho_scale=1.52
    scene.camera=camera
    for name,position,power,width in [('Key',(-2,-3,3),180,3),('Fill',(2,-1,1),75,2.5)]:
        data=bpy.data.lights.new(name,'AREA')
        light=bpy.data.objects.new(name,data)
        scene.collection.objects.link(light)
        light.location=position
        light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
        data.energy=power
        data.shape='DISK'
        data.size=width
    target=OUT/(slug+'.webp')
    scene.render.filepath=str(target)
    bpy.ops.render.render(write_still=True)
    entry={'id':model['id'],'modelPath':str(glb.relative_to(ROOT)).replace('\\','/'),
        'modelSha256':hashlib.sha256(glb.read_bytes()).hexdigest(),
        'thumbnailPath':'assets/thumbnails/'+slug+'.webp',
        'thumbnailSha256':hashlib.sha256(target.read_bytes()).hexdigest(),
        'width':600,'height':450,'format':'WebP','quality':90,
        'triangles':triangles,'sourceLengthMm':round(size.z*1000,4),
        'method':'Individual GLB import and orthographic front render',
        'blender':bpy.app.version_string}
    report.append(entry)
    print('THUMBNAIL_READY',model['id'],entry['modelSha256'][:12],flush=True)

if not selected:
    (ROOT/'data/thumbnails.json').write_text(json.dumps({'version':1,'items':report},indent=2),encoding='ascii')
print('THUMBNAILS_COMPLETE',len(report),flush=True)
