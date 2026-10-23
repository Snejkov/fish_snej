"""Derive editable rotational profiles and painted bands from the reference set."""
import json
import math
import colorsys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from paint_bands import BANDS, PALETTE

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'models'
OUT.mkdir(exist_ok=True)
CATALOG = json.loads((ROOT / 'data/catalog.json').read_text(encoding='utf-8'))
# These are working dimensions, never catalog measurements.
ESTIMATED_MM = {
    'F03':200,'F04':180,'F05':110,'F06':220,'F08':180,'F09':27,
    'F11':180,'F12':140,'F13':260,'F14':140,'F15':140,'F17':200,
    'F20':280,'F22':200,'F23':190,'F24':210,'F25':200,'F26':180,
    'F27':200,'F28':22,'F29':150,'F30':200,'F31':150,'F32':150,
    'F34':240,'F35':230,'F37':240,'F38':190,'F39':200,'F40':27,
    'F42':240,'F43':200,'F44':210,'F45':200,'F48':200,'F49':200,
    'F51':190,'F52':210,'F55':180,
}

def rdp(points, tolerance):
    if len(points) <= 2:
        return points
    a, b = np.array(points[0]), np.array(points[-1])
    delta = b-a
    ds = [abs(delta[0]*(p[1]-a[1])-delta[1]*(p[0]-a[0])) / max(np.linalg.norm(delta), 1e-9) for p in points]
    k = int(np.argmax(ds))
    if ds[k] > tolerance:
        return rdp(points[:k+1], tolerance)[:-1] + rdp(points[k:], tolerance)
    return [points[0], points[-1]]

def flat_paint(rgb):
    r,g,b=[float(c)/255 for c in rgb]
    hue,saturation,value=colorsys.rgb_to_hsv(r,g,b)
    if saturation<.16:
        return [27,33,33] if value<.72 else [229,225,207]
    if .12<hue<.27 and saturation>.3:
        return [212,226,33]
    if .27<=hue<.43 and saturation>.25:
        return [113,195,40]
    if .43<=hue<.69:
        return [15,94,108] if saturation>.27 else [29,36,37]
    if .76<hue<.98:
        return [162,28,100]
    if hue<.12 or hue>=.98:
        if saturation<.3:
            return [231,222,193]
        return [108,47,27] if value<.72 else [240,83,36]
    return [231,222,193]

def derive(item):
    src = Image.open(ROOT / item['image']).convert('RGB')
    a = np.asarray(src).astype(float)
    h, w = a.shape[:2]
    bg = np.median(np.concatenate([a[:,:int(w*.16)], a[:,int(w*.84):]], axis=1), axis=1)
    diff = np.linalg.norm(a-bg[:,None,:], axis=2)
    spread = a.max(axis=2)-a.min(axis=2)
    mean = a.mean(axis=2)
    mask = ((spread > 24) & (diff > 18)) | (mean < 142) | ((mean > 246) & (diff > 24))
    mask[:,:int(w*.29)] = False
    mask[:,int(w*.71):] = False
    ys, xs = np.where(mask)
    # Exclude isolated compression noise; the float occupies the central vertical axis.
    row_count = mask.sum(axis=1)
    valid_y = np.flatnonzero(np.convolve((row_count >= 3).astype(int), np.ones(7), mode='same') >= 5)
    top, bottom = int(valid_y.min()), int(valid_y.max())
    center = float(np.median(xs[(ys > top+10) & (ys < bottom-10)]))
    radius, colors = [], []
    for y in range(top, bottom+1):
        pixels = np.flatnonzero(mask[y])
        pixels = pixels[np.abs(pixels-center) < w*.23]
        if not len(pixels):
            radius.append(0.)
            colors.append([232,225,200])
            continue
        left, right = int(pixels.min()), int(pixels.max())
        local_center = (left+right)/2
        r = max(1, (right-left+1)/2)
        radius.append(r)
        # Read the most chromatic pixels across the interior, away from white glare.
        x0, x1 = int(left+r*.22), int(right-r*.22)
        samples = a[y,x0:max(x0+1,x1)+1]
        chroma = samples.max(axis=1)-samples.min(axis=1)
        if np.max(chroma)>32:
            samples=samples[chroma>=np.percentile(chroma,70)]
        else:
            luminance=samples.mean(axis=1)
            samples=samples[luminance<=np.percentile(luminance,35)]
        colors.append(flat_paint(np.median(samples,axis=0)))
    radius = np.array(radius)
    # A short median removes raster noise without erasing real shoulders.
    valid = np.flatnonzero(radius > 0)
    radius = np.interp(np.arange(len(radius)),valid,radius[valid])
    radius = np.array([np.median(radius[max(0,i-4):i+5]) for i in range(len(radius))])
    size = len(radius)-1
    winter = item['familyId'] in ['F09','F28','F40']
    eye = not winter
    # Rings are modeled as actual open geometry, not revolved discs.
    tail = max(16, int(size*.065))
    ring_y = size
    if eye:
        tail_values = radius[-tail:]
        local_peaks = [i for i in range(2,len(tail_values)-2) if tail_values[i] >= max(tail_values[i-2:i+3])]
        ring_y = size-tail+1+max(local_peaks, key=lambda i: (tail_values[i],i)) if local_peaks else size-8
        ring_radius = float(radius[ring_y])
        ring_radius = min(max(ring_radius,2.4), size*.026)
        cut = min(size-3, max(size-tail, int(ring_y-ring_radius*.8)))
    else:
        ring_radius, cut = 0, size
    # Start at the bottom in normalized coordinates. Force the terminal stems round.
    p = [(float(i), float(radius[i])) for i in range(0,cut+1,3)]
    p.append((float(cut),float(radius[cut])))
    simplified = rdp(p, 1.8)
    # Long cylinders need few rings; curved bodies keep silhouette extrema.
    tolerance = 1.8
    while len(simplified)>48:
        tolerance += .6
        simplified = rdp(p, tolerance)
    normalized = [[round(1-y/size,7),round(r/size,7)] for y,r in reversed(simplified)]
    top_r = normalized[-1][1]
    normalized.append([1.,max(top_r*.12,.00008)])
    normalized = sorted({v[0]:v for v in normalized}.values())
    if item['id'] in ['F09','F40']:
        # Ivory foam texture is not geometric ribbing; keep the cone clean.
        normalized = [[0,.028],[.015,.041],[.14,.041],[.16,.06],[.20,.075],
            [.32,.11],[.48,.15],[.64,.18],[.68,.18],[.75,.15],
            [.81,.10],[.84,.055],[.88,.05],[.90,.067],[.93,.072],
            [.96,.064],[.985,.04],[1,.001]]
    if item['id']=='F11':
        # A clear tube needs an explicit silhouette: its center blends into the backdrop.
        normalized = [[.028,.0097],[.04,.013],[.055,.013],[.06,.010],
            [.27,.012],[.28,.017],[.32,.027],[.38,.030],[.42,.028],
            [.435,.017],[.45,.016],[.985,.016],[.997,.008],[1,.001]]
    if item['familyId']=='F12':
        normalized = [[z,r] for z,r in normalized if not .055<z<.225]
        normalized += [[.055,.012],[.225,.012]]
        normalized.sort()
    if item['length']:
        parts = [float(v) for v in item['length'].split('-')]
        length = sum(parts)/len(parts)
        kind = 'catalog-length' if len(parts)==1 else 'catalog-range-midpoint'
        basis = 'Source overall length; all radial dimensions and part proportions are approximated from the illustration.' if len(parts)==1 else '195 mm midpoint of the source 190-200 mm range; all radial dimensions are approximate.'
    else:
        length = ESTIMATED_MM[item['id']]
        kind = 'estimated'
        basis = 'Working overall length chosen for modeling; no overall length is confirmed by the source. Radial dimensions and component proportions are approximate.'
        if item['id'] in ['F09','F40']:
            basis += ' The h-16 mm marking is treated as a body designation, not a verified assembled height.'
    dest = OUT / item['id'].lower()
    dest.mkdir(exist_ok=True)
    # Each float gets reviewed diffuse paint bands without reflected highlights.
    paint = Image.new('RGBA',(256,1024),PALETTE['k'])
    brush = ImageDraw.Draw(paint)
    start = 0
    for end,color in BANDS[item['familyId']]:
        finish = round(end*1024)
        brush.rectangle((0,start,255,finish-1),fill=PALETTE[color])
        start = finish
    brush.rectangle((0,1017,255,1023),fill=PALETTE['k'])
    if item['familyId']=='F11':
        alpha = np.full(1024,255,dtype=np.uint8)
        alpha[int(1024*.29):int(1024*.94)] = 100
        paint.putalpha(Image.fromarray(alpha.reshape(-1,1)).resize(paint.size))
    paint.save(dest / 'basecolor.webp',format='WEBP',quality=90,method=6,lossless=False,exact=True)
    result = {
        'id':item['id'],'title':item['title'],'sourceName':item['sourceName'],
        'familyId':item['familyId'],'sourceUrl':item['sourceUrl'],'rating':item['rating'],
        'lengthMm':length,'scaleBasis':kind,'dimensionNote':basis,
        'profile':normalized,'radialSegments':12,
        'eye':{'enabled':eye,'radius':round(ring_radius/size,7),'center':round(1-ring_y/size,7)},
        'texture':'basecolor.webp','textureSize':[256,1024],'textureQuality':90,
        'reference':item['image'],'sourceBounds':[center,top,bottom],
    }
    # Show the extracted profile over its source for a visual silhouette audit.
    qa = src.copy()
    d = ImageDraw.Draw(qa)
    line = [(center+r*size,top+(1-z)*size) for z,r in normalized]
    d.line(line,fill=(0,180,230),width=3)
    d.line([(2*center-x,y) for x,y in line],fill=(0,180,230),width=3)
    if eye:
        rr=ring_radius
        d.ellipse((center-rr,top+ring_y-rr,center+rr,top+ring_y+rr),outline=(0,180,230),width=3)
    qa.thumbnail((180,290))
    return result,qa

models, tiles = [], []
seen = set()
for item in CATALOG['items']:
    if not item['image']:
        continue
    model, qa = derive(item)
    models.append(model)
    if item['familyId'] not in seen:
        seen.add(item['familyId'])
        tiles.append((item['id'],qa))
(ROOT / 'data/model-profiles.json').write_text(json.dumps({'models':models},indent=2,ensure_ascii=True),encoding='ascii')
for offset in range(0,len(tiles),20):
    batch=tiles[offset:offset+20]
    sheet=Image.new('RGB',(1000,4*330),(239,241,235))
    d=ImageDraw.Draw(sheet)
    for i,(name,im) in enumerate(batch):
        x=(i%5)*200; y=(i//5)*330
        sheet.paste(im,(x+(200-im.width)//2,y))
        d.text((x+10,y+295),name,fill=(20,50,40))
    sheet.save(ROOT / 'tools' / ('profile-qa-%s.jpg'%(offset//20+1)),quality=90)
print('Prepared',len(models),'profiles;',len(seen),'families')
print('Length basis:', {kind:sum(m['scaleBasis']==kind for m in models) for kind in ['catalog-length','catalog-range-midpoint','estimated']})
