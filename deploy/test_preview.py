import http.client
import json
import pathlib
import tempfile
import threading
import unittest
import io
import tarfile
from unittest.mock import patch


SCRIPT = pathlib.Path(__file__).with_name('install-preview.sh').read_text(encoding='ascii')
SERVER_SOURCE = SCRIPT.split("<<'PREVIEW_SERVER'\n", 1)[1].split('\nPREVIEW_SERVER\n', 1)[0]
namespace = {'__name__': 'snej_preview_test'}
exec(compile(SERVER_SOURCE, 'preview_server.py', 'exec'), namespace)


class PreviewChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name) / 'public'
        self.root.mkdir()
        (self.root / 'index.html').write_text('<h1>SnejFishing</h1>', encoding='ascii')
        (self.root / 'src').mkdir()
        (self.root / 'src' / 'main.js').write_text('export const test = true;', encoding='ascii')
        (self.root / '.env').write_text('PRIVATE', encoding='ascii')
        (self.root / 'server').mkdir()
        (self.root / 'server' / 'admin.mjs').write_text('PRIVATE', encoding='ascii')
        self.server = namespace['serve'](self.root, 'a' * 40, 0, '127.0.0.1')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.temp.cleanup()

    def request(self, path, method='GET'):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        connection.request(method, path)
        response = connection.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        connection.close()
        return result

    def test_public_game_and_javascript(self):
        status, headers, body = self.request('/')
        self.assertEqual(status, 200)
        self.assertIn(b'SnejFishing', body)
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(self.request('/src/main.js?v=new')[0], 200)
        self.assertEqual(self.request('/src/main.js')[1]['Content-Type'], 'text/javascript; charset=utf-8')

    def test_health_explicitly_not_online(self):
        status, _, body = self.request('/healthz')
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data['mode'], 'static-preview')
        self.assertFalse(data['online'])
        self.assertEqual(data['release'], 'a' * 40)

    def test_private_and_traversal_routes(self):
        for path in ['/.env', '/server/admin.mjs', '/.git/config', '/worker/index.js', '/api/profile', '/ws',
                     '/src/../.env', '/src/%2e%2e/.env', '/src/..%5c.env', '/src/main.js%00']:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_no_account_writes_or_directory_listing(self):
        self.assertEqual(self.request('/api/register', 'POST')[0], 501)
        self.assertEqual(self.request('/src/')[0], 404)
        self.assertEqual(self.request('/', 'HEAD')[2], b'')

    def test_escape_symlink_not_served(self):
        private = pathlib.Path(self.temp.name) / 'private.js'
        private.write_text('PRIVATE', encoding='ascii')
        try:
            (self.root / 'src' / 'escape.js').symlink_to(private)
        except OSError:
            self.skipTest('Host does not allow test symlinks')
        self.assertEqual(self.request('/src/escape.js')[0], 404)

    def test_script_is_pinned_and_non_destructive(self):
        self.assertIn('17707769c5b3ef886f941f0b6a892102ec276b22', SCRIPT)
        self.assertNotIn('rm -rf', SCRIPT)
        self.assertNotIn('ufw allow', SCRIPT)
        self.assertNotIn('apt install', SCRIPT)
        self.assertIn('systemd-analyze verify', SCRIPT)
        self.assertIn('trap rollback_on_failure EXIT', SCRIPT)

    def test_archive_extracts_public_files_only(self):
        archive = pathlib.Path(self.temp.name) / 'release.tar.gz'
        target = pathlib.Path(self.temp.name) / 'extracted'
        prefix = 'fish_snej-' + 'a' * 40
        with tarfile.open(archive, 'w:gz') as bundle:
            for name in ['index.html', 'styles.css', 'src/main.js', 'vendor/three.module.min.js', '.env', '.git/config', 'server/admin.mjs']:
                data = b'PUBLIC' if name in ['index.html', 'styles.css', 'src/main.js', 'vendor/three.module.min.js'] else b'PRIVATE'
                member = tarfile.TarInfo(prefix + '/' + name)
                member.size = len(data)
                bundle.addfile(member, io.BytesIO(data))
            link = tarfile.TarInfo(prefix + '/src/link.js')
            link.type = tarfile.SYMTYPE
            link.linkname = '../../private.js'
            bundle.addfile(link)
        source = SCRIPT.split("<<'EXTRACT_PUBLIC'\n", 1)[1].split('\nEXTRACT_PUBLIC\n', 1)[0]
        with patch('sys.argv', ['extract', str(archive), str(target), 'a' * 40]):
            exec(compile(source, 'extract_public.py', 'exec'), {})
        self.assertEqual(sorted(str(p.relative_to(target)).replace('\\', '/') for p in target.rglob('*') if p.is_file()),
                         ['index.html', 'src/main.js', 'styles.css', 'vendor/three.module.min.js'])

    def test_archive_traversal_is_rejected(self):
        archive = pathlib.Path(self.temp.name) / 'malicious.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            member = tarfile.TarInfo('fish_snej-' + 'a' * 40 + '/../escape.js')
            member.size = 1
            bundle.addfile(member, io.BytesIO(b'x'))
        source = SCRIPT.split("<<'EXTRACT_PUBLIC'\n", 1)[1].split('\nEXTRACT_PUBLIC\n', 1)[0]
        with patch('sys.argv', ['extract', str(archive), str(pathlib.Path(self.temp.name) / 'bad'), 'a' * 40]):
            with self.assertRaises(SystemExit):
                exec(compile(source, 'extract_public.py', 'exec'), {})


if __name__ == '__main__':
    unittest.main(verbosity=2)
