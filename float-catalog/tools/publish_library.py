"""Publish only a checksum-verified float payload to the existing model-library service."""
import argparse
import hashlib
import json
import os
from pathlib import Path,PurePosixPath
import re
import shutil
import subprocess
import tarfile
import time
from urllib.request import urlopen

parser=argparse.ArgumentParser()
parser.add_argument('archive')
parser.add_argument('--sha256',required=True)
parser.add_argument('--commit',required=True)
args=parser.parse_args()
root=Path('/srv/model-library')
assert root.resolve()==root and root.is_dir()
archive_path=Path(args.archive).resolve()
assert archive_path.parent==root/'uploads'
assert hashlib.sha256(archive_path.read_bytes()).hexdigest()==args.sha256
assert re.fullmatch('[0-9a-f]{40}',args.commit)

with tarfile.open(archive_path,'r:gz') as archive:
    manifest=json.loads(archive.extractfile('manifest.json').read())
    assert manifest['collectionId']=='badis-floats-2026-10-24'
    assert re.fullmatch('floats-[0-9a-f]{12}',manifest['release'])
    expected={'manifest.json'}|{'dist/'+f['path'] for f in manifest['files']}
    assert set(archive.getnames())==expected
    for member in archive.getmembers():
        assert member.isfile() and not member.issym() and not member.islnk()
        path=PurePosixPath(member.name)
        assert not path.is_absolute() and '..' not in path.parts
    contents={}
    for record in manifest['files']:
        name=record['path']
        assert name=='catalog.json' or name.startswith(('assets/floats/','downloads/floats/','thumbnails/floats/'))
        content=archive.extractfile('dist/'+name).read()
        assert len(content)==record['bytes']
        assert hashlib.sha256(content).hexdigest()==record['sha256']
        contents[name]=content

current=root/'current'
previous=current.resolve(strict=True)
assert previous.parent==root/'releases'
previous_catalog=(previous/'dist/catalog.json').read_bytes()
assert hashlib.sha256(previous_catalog).hexdigest()==manifest['baseCatalogSha256'],'Catalog changed; prepare a fresh import'
before=json.loads(previous_catalog)
after=json.loads(contents['catalog.json'])
for original in before['models']:
    if original.get('collectionId')!=manifest['collectionId']:
        assert original==next(m for m in after['models'] if m['id']==original['id'])
added=[m for m in after['models'] if m.get('collectionId')==manifest['collectionId']]
assert len(added)==54 and all(m['category']=='bobbers' for m in added)
assert len(after['models'])==manifest['totalModels']

release=root/'releases'/manifest['release']
assert not release.exists(),'Release already exists; inspect it before retrying'
# Hardlink unchanged files, then replace changed files atomically to preserve the old release.
shutil.copytree(previous,release,copy_function=os.link,symlinks=True)
for relative,content in contents.items():
    destination=release/'dist'/relative
    destination.parent.mkdir(parents=True,exist_ok=True)
    assert destination.parent.resolve().is_relative_to(release)
    if relative!='catalog.json' and destination.exists():
        assert destination.read_bytes()==content,'Unexpected existing float path: '+relative
    temporary=destination.with_name(destination.name+'.float-import')
    assert not temporary.exists()
    temporary.write_bytes(content)
    temporary.chmod(0o644)
    os.replace(temporary,destination)
    parent=destination.parent
    while parent!=release:
        parent.chmod(0o755)
        parent=parent.parent
release.chmod(0o755)
report={
    'release':manifest['release'],'previousRelease':str(previous),
    'gitCommit':args.commit,'payloadSha256':args.sha256,
    'catalogSha256':manifest['catalogSha256'],'modelsAdded':54,
    'totalModels':len(after['models']),'totalBobbers':manifest['totalBobbers'],
}
(release/'float-publication.json').write_text(json.dumps(report,indent=2),encoding='ascii')
assert current.resolve()==previous
assert hashlib.sha256((current/'dist/catalog.json').read_bytes()).hexdigest()==manifest['baseCatalogSha256']
pending=root/'current.float-import'
assert not pending.exists() and not pending.is_symlink()
pending.symlink_to(release,target_is_directory=True)
os.replace(pending,current)
try:
    subprocess.run(['systemctl','restart','model-library'],check=True)
    for attempt in range(5):
        try:
            with urlopen('http://127.0.0.1/catalog.json',timeout=10) as response:
                served=response.read()
            assert hashlib.sha256(served).hexdigest()==manifest['catalogSha256']
            break
        except Exception:
            if attempt==4: raise
            time.sleep(1)
    for record in manifest['files']:
        with urlopen('http://127.0.0.1/'+record['path'],timeout=20) as response:
            served=response.read()
        assert hashlib.sha256(served).hexdigest()==record['sha256'],record['path']
    report['httpFilesVerified']=len(manifest['files'])
    report['result']='published-and-verified'
except Exception:
    assert current.resolve()==release
    pending.symlink_to(previous,target_is_directory=True)
    os.replace(pending,current)
    subprocess.run(['systemctl','restart','model-library'],check=True)
    raise
(release/'float-publication.json').write_text(json.dumps(report,indent=2),encoding='ascii')
print(json.dumps(report),flush=True)
