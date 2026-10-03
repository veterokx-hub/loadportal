"""Ограничения исходящего fetch: схема, metadata, внутренние DNS compose.

RFC1918 не режем — портал разбирает корпоративные OpenAPI во внутренней сети.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException

ALLOWED_SCHEMES = {"http", "https"}
BLOCKED_HOSTS = {
    "postgres",
    "constructor",
    "orchestrator",
    "frontend",
    "jmeter-builder",
    "k6-generator",
    "gatling-generator",
    "analyzer",
    "metadata.google.internal",
    "metadata.goog",
    "kubernetes.default",
    "kubernetes.default.svc",
    "kubernetes.default.svc.cluster.local",
}


def assert_safe_fetch_url(url: str) -> None:
    if not url or not url.strip():
        raise HTTPException(status_code=400, detail="Нужно указать url или content")
    parts = urlparse(url.strip())
    scheme = (parts.scheme or "").lower()
    if scheme not in ALLOWED_SCHEMES:
        raise HTTPException(status_code=400, detail="URL только http/https")
    host = (parts.hostname or "").strip().lower()
    if not host:
        raise HTTPException(status_code=400, detail="URL не разрешён")
    if host in BLOCKED_HOSTS or host.endswith(".cluster.local"):
        raise HTTPException(status_code=400, detail="URL не разрешён")
    for ip in _resolve(host):
        if _blocked_ip(ip):
            raise HTTPException(status_code=400, detail="URL не разрешён")


def _resolve(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        parsed = ipaddress.ip_address(host)
        return [parsed]
    except ValueError:
        pass
    found: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    try:
        for family, _, _, _, sockaddr in socket.getaddrinfo(host, None):
            addr = sockaddr[0]
            try:
                found.append(ipaddress.ip_address(addr))
            except ValueError:
                continue
    except socket.gaierror:
        # Имя не резолвится здесь — analyzer всё равно получит ошибку коннекта.
        return []
    return found


def _blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if ip.is_unspecified or ip.is_multicast or ip.is_reserved or ip.is_link_local:
        return True
    if ip.version == 6 and ip in ipaddress.ip_network("fd00:ec2::/64"):
        return True
    return False
