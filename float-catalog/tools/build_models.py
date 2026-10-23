"""Create the low-poly float library with Blender; meters in, meters out."""
import bpy
import bmesh
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/models'
MODELS = json.loads((ROOT / 'data/model-profiles.json').read_text())['models']
ONLY = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
if ONLY:
    MODELS = [m for m in MODELS if m['id'] in ONLY]

def clean_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if not collection.objects:
            bpy.data.collections.remove(collection)
    bpy.context.view_layer.active_layer_collection=bpy.context.view_layer.layer_collection
    bpy.data.orphans_purge(do_recursive=True)

def lathe(spec):
    sides = spec['radialSegments']
    vertices, faces, uvs = [], [], []
    for z, radius in spec['profile']:
        for j in range(sides):
            theta = j*2*math.pi/sides
            vertices.append((radius*math.cos(theta),radius*math.sin(theta),z))
    for ring in range(len(spec['profile'])-1):
        z0, z1 = spec['profile'][ring][0], spec['profile'][ring+1][0]
        for j in range(sides):
            k = (j+1)%sides
            faces.append((ring*sides+j,ring*sides+k,(ring+1)*sides+k,(ring+1)*sides+j))
            uvs.append([(j/sides,z0),((j+1)/sides,z0),((j+1)/sides,z1),(j/sides,z1)])
    faces.append(tuple(reversed(range(sides))))
    uvs.append([(.5,spec['profile'][0][0])]*sides)
    offset = (len(spec['profile'])-1)*sides
    faces.append(tuple(offset+j for j in range(sides)))
    uvs.append([(.5,1.)]*sides)
    mesh = bpy.data.meshes.new(spec['id']+'_Profile')
    mesh.from_pydata(vertices,[],faces)
    mesh.update()
    layer = mesh.uv_layers.new(name='PaintedBands')
    for polygon, coordinates in zip(mesh.polygons,uvs):
        for loop, uv in zip(polygon.loop_indices,coordinates):
            layer.data[loop].uv = uv
        polygon.use_smooth = len(polygon.vertices)==4
    obj = bpy.data.objects.new(spec['id']+'_Float',mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.vertex_groups.new(name='Rotational_form').add(list(range(len(vertices))),1.,'REPLACE')
    if spec['eye']['enabled']:
        add_eye(obj,spec)
    # Normalize the final open eye and tip to the specified assembled height.
    lower = min(v.co.z for v in obj.data.vertices)
    upper = max(v.co.z for v in obj.data.vertices)
    factor = (spec['lengthMm']/1000)/(upper-lower)
    for vertex in obj.data.vertices:
        vertex.co.z -= lower
        vertex.co *= factor
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj

def add_eye(obj,spec):
    eye = spec['eye']
    outer = max(eye['radius'],.0018)
    tube = outer*.24
    major = outer-tube
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=tube,
        major_segments=10,minor_segments=4,location=(0,0,eye['center']),
        rotation=(math.pi/2,0,0))
    ring = bpy.context.object
    ring.name = spec['id']+'_Line_eye'
    ring.data.uv_layers.active.name='PaintedBands'
    ring.vertex_groups.new(name='Line_eye').add(list(range(len(ring.data.vertices))),1.,'REPLACE')
    # Sample the lower fitting color, away from the photographic ring highlight.
    for loop in ring.data.uv_layers.active.data:
        loop.uv = (.5,.002)
    for polygon in ring.data.polygons:
        polygon.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    ring.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()

def make_material(obj,spec,dest):
    material = bpy.data.materials.new(spec['id']+'_Paint')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .35
    shader.inputs['Metallic'].default_value = 0.
    tex = nodes.new('ShaderNodeTexImage')
    tex.name = 'BaseColor_WebP_Q90'
    image = bpy.data.images.load(str(dest / 'basecolor.webp'),check_existing=False)
    image.colorspace_settings.name = 'sRGB'
    tex.image = image
    material.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color'])
    if spec['id']=='F11':
        material.node_tree.links.new(tex.outputs['Alpha'],shader.inputs['Alpha'])
        material.surface_render_method = 'DITHERED'
        material.use_transparency_overlap = False
        shader.inputs['Roughness'].default_value = .22
    obj.data.materials.append(material)
    return image

def setup_units(scene):
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.
    scene.unit_settings.length_unit = 'MILLIMETERS'

def select(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def setup_view(obj):
    height = obj.dimensions.z
    center = Vector((0,0,height/2))
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.shading.type='MATERIAL'
                area.spaces.active.overlay.show_overlays=False
                region=area.spaces.active.region_3d
                region.view_location=center
                region.view_distance=height*1.55
                region.view_rotation=Vector((.25,-1,.12)).to_track_quat('Z','Y')
    bpy.context.scene.cursor.location=(0,0,0)

def bounds(objects):
    points=[o.matrix_world @ v.co for o in objects for v in o.data.vertices]
    low=Vector([min(p[i] for p in points) for i in range(3)])
    high=Vector([max(p[i] for p in points) for i in range(3)])
    return low,high

reports=[]
for spec in MODELS:
    clean_scene()
    scene=bpy.context.scene
    scene.render.film_transparent=False
    scene.render.image_settings.color_mode='RGBA'
    scene.render.image_settings.color_depth='8'
    scene.name=spec['id']+'_'+spec['title'].replace(' ','_')
    setup_units(scene)
    dest=OUT/spec['id'].lower()
    obj=lathe(spec)
    image=make_material(obj,spec,dest)
    for key,value in [('catalog_id',spec['id']),('catalog_title',spec['title']),
                      ('catalog_rating_g',spec['rating'] or 'Unspecified'),
                      ('length_mm',spec['lengthMm']),('scale_basis',spec['scaleBasis']),
                      ('dimension_note',spec['dimensionNote']),('source_url',spec['sourceUrl'])]:
        obj[key]=value
    select(obj)
    bpy.context.view_layer.update()
    setup_view(obj)
    low,high=bounds([obj])
    expected=[float(v) for v in high-low]
    assert abs(expected[2]*1000-spec['lengthMm'])<.001
    assert len(obj.data.polygons)<1500,(spec['id'],len(obj.data.polygons))
    fbx=dest/(spec['id'].lower()+'.fbx')
    bpy.ops.export_scene.fbx(filepath=str(fbx),use_selection=True,object_types={'MESH'},
        global_scale=1.,apply_unit_scale=True,apply_scale_options='FBX_SCALE_NONE',
        axis_forward='-Z',axis_up='Y',use_mesh_modifiers=True,mesh_smooth_type='OFF',
        use_triangles=True,use_tspace=True,add_leaf_bones=False,bake_anim=False,
        path_mode='COPY',embed_textures=True,use_custom_props=True)
    bpy.ops.export_scene.gltf(filepath=str(dest/(spec['id'].lower()+'.glb')),
        export_format='GLB',use_selection=True,export_image_format='WEBP',
        export_image_quality=90,export_image_webp_fallback=False,
        export_yup=True,export_extras=True,export_animations=False)
    image.pack()
    image.filepath='//basecolor.webp'
    bpy.ops.wm.save_as_mainfile(filepath=str(dest/(spec['id'].lower()+'.blend')),compress=True)
    report={k:v for k,v in spec.items() if k not in ['profile','sourceBounds','eye']}
    assert len(obj.data.uv_layers)==1
    report.update({'blender':bpy.app.version_string,'vertices':len(obj.data.vertices),
        'triangles':len(obj.data.polygons),'meshes':1,'materials':1,'uvLayers':len(obj.data.uv_layers),
        'dimensionsMm':[round(x*1000,4) for x in expected],
        'units':'meters','blenderUpAxis':'Z','exportUpAxis':'Y',
        'origin':'Bottom center of assembled float','fbxEmbeddedTexture':True,
        'files':{'fbx':spec['id'].lower()+'.fbx','glb':spec['id'].lower()+'.glb',
                 'blend':spec['id'].lower()+'.blend','texture':'basecolor.webp'},
        'geometryNote':'Rotational approximation of the adapted front illustration; no rear or measured radial reference is available.'})
    # Reimport every actual FBX in a clean scene to check units and embedded texture.
    clean_scene()
    bpy.ops.import_scene.fbx(filepath=str(fbx),use_anim=False)
    imported=[o for o in scene.objects if o.type=='MESH']
    lo,hi=bounds(imported)
    actual=[float(v) for v in hi-lo]
    assert len(imported)==1
    assert max(abs(a-b) for a,b in zip(actual,expected))<1e-6,(spec['id'],actual,expected)
    imported_textures=[n.image for o in imported for mat in o.data.materials if mat and mat.node_tree
        for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image]
    assert imported_textures and all(im.has_data for im in imported_textures),spec['id']
    assert fbx.read_bytes().find((dest/'basecolor.webp').read_bytes())>=0,'Missing embedded WebP'
    report['validation']={'fbxReimport':'passed','scaleToleranceMm':.001,
        'reimportedDimensionsMm':[round(x*1000,4) for x in actual],
        'embeddedTextureLoaded':True,'embeddedBytesMatch':True,'triangles':sum(len(o.data.polygons) for o in imported)}
    (dest/'model.json').write_text(json.dumps(report,indent=2,ensure_ascii=True),encoding='ascii')
    reports.append(report)
    print('MODEL_READY',spec['id'],report['triangles'],report['lengthMm'],spec['scaleBasis'],flush=True)

manifest={'version':1,'blender':bpy.app.version_string,'models':reports,
    'missing':[{'id':'F53','reason':'No usable source image. Source photos show fishing line.'}],
    'textureEncoding':{'format':'WebP','quality':90,'lossless':False,'alphaPreserved':True},
    'dimensionPolicy':'Only listed overall lengths are source dimensions. All radial dimensions are approximated from adapted illustrations. Unknown overall lengths are explicitly estimated.'}
if not ONLY:
    (ROOT/'data/models.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=True),encoding='ascii')
    # Editable master library: real meter scale, individual named collections.
    clean_scene()
    scene=bpy.context.scene
    scene.name='Float_Library_54'
    setup_units(scene)
    for i,report in enumerate(reports):
        spec=next(m for m in MODELS if m['id']==report['id'])
        obj=lathe(spec)
        make_material(obj,spec,OUT/spec['id'].lower())
        obj.location=((i%9)*.09,(i//9)*.09,0)
        obj['catalog_id']=spec['id']
        obj['length_mm']=spec['lengthMm']
        obj['scale_basis']=spec['scaleBasis']
        obj['dimension_note']=spec['dimensionNote']
        for slot in obj.material_slots:
            for node in slot.material.node_tree.nodes:
                if node.type=='TEX_IMAGE' and node.image:
                    node.image.pack()
                    node.image.filepath='//assets/models/'+spec['id'].lower()+'/basecolor.webp'
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'float-library.blend'),compress=True)
    # Same-height contact sheet for an honest silhouette and texture review.
    for i,obj in enumerate([o for o in scene.objects if o.type=='MESH']):
        height=obj.dimensions.z
        obj.scale=(1/height,)*3
        obj.location=((i%9)*.72,0,-(i//9)*1.28)
    camera_data=bpy.data.cameras.new('Contact_Camera')
    camera=bpy.data.objects.new('Contact_Camera',camera_data)
    scene.collection.objects.link(camera)
    camera.location=(2.88,-15,-2.72)
    camera.rotation_euler=(Vector((2.88,0,-2.72))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type='ORTHO'
    camera_data.ortho_scale=7.55
    scene.camera=camera
    world=bpy.data.worlds.new('Neutral_World')
    world.use_nodes=True
    world.node_tree.nodes.get('Background').inputs[0].default_value=(.65,.68,.64,1)
    world.node_tree.nodes.get('Background').inputs[1].default_value=.8
    scene.world=world
    for name,loc,power,size in [('Key',(-1,-4,5),1200,8),('Fill',(6,-2,2),700,6)]:
        ld=bpy.data.lights.new(name,'AREA');lo=bpy.data.objects.new(name,ld)
        scene.collection.objects.link(lo);lo.location=loc
        lo.rotation_euler=(Vector((2.8,0,-2.5))-lo.location).to_track_quat('-Z','Y').to_euler()
        ld.energy=power;ld.shape='DISK';ld.size=size
    scene.render.engine='CYCLES'
    scene.cycles.samples=16
    scene.cycles.use_denoising=True
    scene.render.resolution_x=2700
    scene.render.resolution_y=3000
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.view_settings.view_transform='Standard'
    scene.render.filepath=str(ROOT/'assets/models-contact.png')
    bpy.ops.render.render(write_still=True)
print('BUILD_COMPLETE',len(reports),flush=True)
