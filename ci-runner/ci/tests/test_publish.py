import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

import publish  # noqa: E402


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(size)
        self.server.seen = (self.path, self.headers.get("X-Gitlab-Token"), body)  # type: ignore[attr-defined]
        code = getattr(self.server, "reply", 204)
        self.send_response(code)
        self.end_headers()

    def log_message(self, fmt, *args):
        return


class PublishTest(unittest.TestCase):
    def test_empty_url_skips(self):
        self.assertEqual(publish.post_verdict(Path("missing.json"), "", ""), 0)

    def test_url_without_token_fails(self):
        self.assertEqual(publish.post_verdict(Path("missing.json"), "http://portal/verdict", ""), 1)

    def test_posts_file_and_token(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        server.reply = 204  # type: ignore[attr-defined]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        path = Path(self.id().replace(".", "_") + ".json")
        try:
            path.write_text(json.dumps({"portal_run_id": "run-1", "status": "passed"}), encoding="utf-8")
            url = f"http://127.0.0.1:{server.server_address[1]}/api/runs/webhook/verdict"
            self.assertEqual(publish.post_verdict(path, url, "secret"), 0)
            seen_path, token, body = server.seen  # type: ignore[attr-defined]
            self.assertEqual(seen_path, "/api/runs/webhook/verdict")
            self.assertEqual(token, "secret")
            self.assertEqual(json.loads(body)["status"], "passed")
        finally:
            server.shutdown()
            path.unlink(missing_ok=True)

    def test_portal_error_is_failure(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        server.reply = 403  # type: ignore[attr-defined]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        path = Path(self.id().replace(".", "_") + ".json")
        try:
            path.write_text(json.dumps({"portal_run_id": "run-1", "status": "failed"}), encoding="utf-8")
            url = f"http://127.0.0.1:{server.server_address[1]}/verdict"
            self.assertEqual(publish.post_verdict(path, url, "secret"), 1)
        finally:
            server.shutdown()
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
