"""Resolve an IP only from the transport or an explicitly trusted proxy."""

from ipaddress import ip_address, ip_network

from fastapi import Request

from app.core.config import settings


def normalize_ip(value: str) -> str:
    address = ip_address(value.strip())
    return str(getattr(address, "ipv4_mapped", None) or address)


def client_ip(request: Request) -> str | None:
    try:
        peer = normalize_ip(request.client.host) if request.client else None
    except ValueError:
        return None
    if peer is None:
        return None
    trusted = any(ip_address(peer) in ip_network(cidr) for cidr in settings.TRUSTED_PROXY_CIDRS)
    if trusted and request.headers.get("x-real-ip"):
        try:
            return normalize_ip(request.headers["x-real-ip"])
        except ValueError:
            # Never lock the shared proxy address because its forwarding is bad.
            return None
    return peer
