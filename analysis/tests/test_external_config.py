"""Плоский ConfigMap, дерево Consul и поля Vault для analysis. Без сети."""
import base64
import unittest

from app.external_config import (
    consul_property,
    consul_settings,
    decode_tree,
    parse_properties,
    vault_candidates,
    vault_field,
    vault_renew_at,
    vault_settings,
)


VM_YAML = """
victoriametrics:
    url: http://vm.mbrd.ru:8428
    concurrency: 8
    timeout-sec: 30
analysis:
    demo: false
"""


class ConsulTreeTests(unittest.TestCase):
    def test_yaml_document_in_prefix(self):
        entries = {"application/data": VM_YAML}
        self.assertEqual(consul_property(entries, "victoriametrics.url"), "http://vm.mbrd.ru:8428")
        self.assertEqual(consul_property(entries, "victoriametrics.concurrency"), "8")
        self.assertEqual(consul_property(entries, "victoriametrics.timeout-sec"), "30")
        self.assertEqual(consul_property(entries, "analysis.demo"), "false")

    def test_document_under_key(self):
        entries = {"victoriametrics": "url: http://vm.mbrd.ru:8428\nconcurrency: 8\n"}
        self.assertEqual(consul_property(entries, "victoriametrics.url"), "http://vm.mbrd.ru:8428")
        self.assertEqual(consul_property(entries, "victoriametrics.concurrency"), "8")

    def test_separate_keys_and_context(self):
        entries = {
            "loadtest/victoriametrics/url": "http://vm.mbrd.ru:8428",
            "application/analysis/demo": "true",
        }
        self.assertEqual(consul_property(entries, "loadtest.victoriametrics.url"), "http://vm.mbrd.ru:8428")
        self.assertEqual(consul_property(entries, "victoriametrics.url"), "http://vm.mbrd.ru:8428")
        self.assertEqual(consul_property(entries, "analysis.demo"), "true")
        self.assertEqual(consul_property(entries, "victoriametrics.bearer"), "")

    def test_decode_recurse_strips_prefix(self):
        items = [
            {"Key": "ump/loadtest-portal/", "Value": None},
            {"Key": "ump/loadtest-portal/application/data",
             "Value": base64.b64encode(VM_YAML.encode()).decode()},
            {"Key": "other/key", "Value": base64.b64encode(b"x").decode()},
        ]
        tree = decode_tree(items, "ump/loadtest-portal/")
        self.assertEqual(list(tree), ["application/data"])
        self.assertEqual(consul_property(tree, "victoriametrics.url"), "http://vm.mbrd.ru:8428")


class VaultFieldTests(unittest.TestCase):
    def test_candidates_walk_up_and_contexts(self):
        self.assertEqual(
            vault_candidates("loadtest/victoriametrics/bearer-token"),
            [
                ("loadtest/victoriametrics/bearer-token", ""),
                ("loadtest/victoriametrics", "bearer-token"),
                ("loadtest", "victoriametrics.bearer-token"),
                ("application", "victoriametrics.bearer-token"),
                ("loadtest-portal", "victoriametrics.bearer-token"),
            ],
        )

    def test_exact_path_value_or_single_field(self):
        self.assertEqual(vault_field({"value": "s3cret", "other": "x"}, "", "loadtest.internal-token"), "s3cret")
        self.assertEqual(vault_field({"token": "s3cret"}, "", "loadtest.internal-token"), "s3cret")

    def test_parent_secret_and_nested(self):
        self.assertEqual(vault_field({"bearer-token": "t"}, "bearer-token", "loadtest.victoriametrics.bearer-token"), "t")
        nested = {"victoriametrics": {"bearer-token": "t"}}
        self.assertEqual(
            vault_field(nested, "victoriametrics.bearer-token", "loadtest.victoriametrics.bearer-token"), "t"
        )

    def test_parent_secret_without_field_is_empty(self):
        self.assertEqual(vault_field({"username": "u", "url": "x"}, "bearer-token", "loadtest.vm.bearer-token"), "")

    def test_renew_at_half_lease_and_never_for_zero(self):
        self.assertEqual(vault_renew_at(0, 3600), 1800)
        self.assertEqual(vault_renew_at(0, 0), float("inf"))


class PlatformConfigTests(unittest.TestCase):
    def test_properties_skip_comments_and_quotes(self):
        parsed = parse_properties(
            """
            # comment
            discovery.consul.enabled="true"
            spring.cloud.consul.host=consul-ump-test.mbrd.ru
            empty=
            """
        )
        self.assertEqual(parsed["discovery.consul.enabled"], "true")
        self.assertEqual(parsed["spring.cloud.consul.host"], "consul-ump-test.mbrd.ru")
        self.assertEqual(parsed["empty"], "")

    def test_configmap_beats_short_duplicates(self):
        props = {
            "discovery.consul.enabled": "true",
            "consul_host": "consul-ump-test.mbrd.ru:8081",
            "consul_config_path": "ump",
            "consul_config_acl_token": "acl-fallback",
            "spring.cloud.consul.host": "consul-ump-test.mbrd.ru",
            "spring.cloud.consul.port": "8081",
            "spring.cloud.consul.config.prefix": "ump/loadtest-portal",
            "spring.cloud.consul.config.acl-token": "acl-main",
            "spring.cloud.vault.uri": "http://vault-ump-test.mbrd.ru:8081",
            "spring.cloud.vault.kv.backend": "load-producer",
            "vault_role_id": "role-fallback",
            "spring.cloud.vault.app-role.role-id": "role-main",
            "spring.cloud.vault.app-role.secret-id": "secret-main",
        }
        enabled, host, port, prefix, token = consul_settings({}, props)
        self.assertTrue(enabled)
        self.assertEqual(host, "consul-ump-test.mbrd.ru")
        self.assertEqual(port, "8081")
        self.assertEqual(prefix, "ump/loadtest-portal/")
        self.assertEqual(token, "acl-main")

        vault_on, addr, mount, role, secret = vault_settings({}, props)
        self.assertTrue(vault_on)
        self.assertEqual(addr, "http://vault-ump-test.mbrd.ru:8081")
        self.assertEqual(mount, "load-producer")
        self.assertEqual(role, "role-main")
        self.assertEqual(secret, "secret-main")

    def test_env_overrides_file_and_local_stays_off(self):
        props = {
            "spring.cloud.consul.host": "consul-ump-test.mbrd.ru",
            "spring.cloud.vault.uri": "http://vault-ump-test.mbrd.ru:8081",
        }
        enabled, host, port, prefix, _token = consul_settings(
            {"CONSUL_ENABLED": "false", "CONSUL_HOST": "localhost"}, props
        )
        self.assertFalse(enabled)
        self.assertEqual(host, "localhost")
        self.assertEqual(port, "8500")
        self.assertEqual(prefix, "loadtest/")

        vault_on, _addr, _mount, _role, _secret = vault_settings({"VAULT_ENABLED": "false"}, props)
        self.assertFalse(vault_on)

        off, _host, _port, local_prefix, _token = consul_settings({}, {})
        self.assertFalse(off)
        self.assertEqual(local_prefix, "loadtest/")

    def test_glued_host_when_spring_host_missing(self):
        enabled, host, port, prefix, _token = consul_settings(
            {}, {"consul_host": "consul-ump-test.mbrd.ru:8081", "consul_config_path": "ump"}
        )
        self.assertTrue(enabled)
        self.assertEqual(host, "consul-ump-test.mbrd.ru")
        self.assertEqual(port, "8081")
        self.assertEqual(prefix, "ump/")
