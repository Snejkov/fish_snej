"""Export the complete real-scale Blender library as one additional FBX and GLB."""
import bpy
import json
import shutil
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
models=json.loads((ROOT/'data/models.json').read_text())['models']
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'float-library.blend'))
scene=bpy.context.scene
textures=ROOT/'assets/library-textures'
textures.mkdir(exist_ok=True)
objects=[o for o in scene.objects if o.type=='MESH']
assert len(objects)==54
for obj in objects:
    model=next(m for m in models if m['id']==obj['catalog_id'])
    obj['catalog_title']=model['title']
    obj['catalog_rating_g']=model['rating'] or 'Unspecified'
    obj['source_url']=model['sourceUrl']
    slug=model['id'].lower()
    for material in obj.data.materials:
        for node in material.node_tree.nodes:
            if node.type=='TEX_IMAGE' and node.image:
                target=textures/(slug+'_basecolor.webp')
                shutil.copyfile(ROOT/'assets/models'/slug/'basecolor.webp',target)
                node.image.name=model['id']+'_BaseColor_WebP_Q90'
                node.image.filepath=str(target)
    obj.select_set(True)
bpy.ops.export_scene.fbx(filepath=str(ROOT/'float-library.fbx'),use_selection=True,
    object_types={'MESH'},global_scale=1.,apply_unit_scale=True,
    apply_scale_options='FBX_SCALE_NONE',axis_forward='-Z',axis_up='Y',
    use_mesh_modifiers=True,mesh_smooth_type='OFF',use_triangles=True,
    use_tspace=True,add_leaf_bones=False,bake_anim=False,path_mode='COPY',
    embed_textures=True,use_custom_props=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'float-library.glb'),export_format='GLB',
    use_selection=True,export_image_format='WEBP',export_image_quality=90,
    export_image_webp_fallback=False,export_yup=True,export_extras=True,export_animations=False)
for image in bpy.data.images:
    if image.name.startswith('F') and image.has_data:
        image.pack()
        image.filepath='//assets/library-textures/'+Path(image.filepath).name
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'float-library.blend'),compress=True)
# A fresh scene and image database exercise all 54 embedded image bindings.
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(ROOT/'float-library.fbx'),use_anim=False)
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
assert len(meshes)==54
checks=[]
for obj in meshes:
    model=next(m for m in models if m['id']==obj['catalog_id'])
    points=[v.co for v in obj.data.vertices]
    dims=[(max(p[i] for p in points)-min(p[i] for p in points))*1000 for i in range(3)]
    assert max(abs(a-b) for a,b in zip(dims,model['dimensionsMm']))<.001
    images=[n.image for m in obj.data.materials for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]
    assert images and all(i.has_data for i in images)
    checks.append({'id':model['id'],'dimensionsMm':dims,'textureLoaded':True})
report={'result':'passed','meshes':54,'triangles':sum(len(o.data.polygons) for o in meshes),
    'checks':checks,'file':'float-library.fbx','units':'meters'}
(ROOT/'data/library-validation.json').write_text(json.dumps(report,indent=2),encoding='ascii')
print('LIBRARY_FBX_VERIFIED',len(meshes),flush=True)
