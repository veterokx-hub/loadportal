"""Парсеры спецификаций и фильтр исходящего fetch. Без сети."""
import json
import unittest

from fastapi import HTTPException

from app.fetch_guard import assert_safe_fetch_url
from app.models import ParamLocation, SourceType
from app.openapi_parser import parse_openapi
from app.postman_parser import parse_postman

OPENAPI = """
openapi: "3.0.3"
info:
  title: Shop
servers:
  - url: https://shop.example/v1
paths:
  /items/{id}:
    get:
      operationId: getItem
      summary: Get item
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: ok
"""

POSTMAN = json.dumps(
    {
        "info": {"name": "Demo"},
        "item": [
            {
                "name": "List",
                "request": {
                    "method": "GET",
                    "url": "https://shop.example/v1/items",
                },
            }
        ],
    }
)


class ParseTests(unittest.TestCase):
    def test_openapi_path_param(self):
        draft = parse_openapi(OPENAPI)
        self.assertEqual(draft.name, "Shop")
        self.assertEqual(draft.source_type, SourceType.OPENAPI)
        self.assertEqual(draft.base_url, "https://shop.example/v1")
        self.assertEqual(len(draft.requests), 1)
        req = draft.requests[0]
        self.assertEqual(req.method, "GET")
        self.assertEqual(req.path, "/items/{id}")
        path_params = [p for p in req.params if p.location == ParamLocation.PATH]
        self.assertEqual([p.name for p in path_params], ["id"])
        self.assertTrue(path_params[0].required)

    def test_postman_absolute_url(self):
        draft = parse_postman(POSTMAN)
        self.assertEqual(draft.name, "Demo")
        self.assertEqual(draft.source_type, SourceType.POSTMAN)
        self.assertEqual(draft.base_url, "https://shop.example")
        self.assertEqual(draft.requests[0].method, "GET")
        self.assertEqual(draft.requests[0].path, "/v1/items")


class FetchGuardTests(unittest.TestCase):
    def test_rejects_empty_scheme_and_internal_names(self):
        with self.assertRaises(HTTPException) as empty:
            assert_safe_fetch_url("  ")
        self.assertEqual(empty.exception.status_code, 400)

        for url in (
            "file:///etc/passwd",
            "http://postgres/spec",
            "http://kubernetes.default.svc.cluster.local/",
            "http://169.254.169.254/latest/meta-data",
            "http://0.0.0.0/",
        ):
            with self.assertRaises(HTTPException):
                assert_safe_fetch_url(url)

    def test_allows_public_literal(self):
        assert_safe_fetch_url("http://1.1.1.1/openapi.json")


if __name__ == "__main__":
    unittest.main()
