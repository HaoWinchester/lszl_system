"""微信支付（Native 扫码）v3 业务：下单签名、Native 下单、回调验签解密、演示模式。

凭证来自 wechat_pay_config（system_settings）：
- mchId / apiV3Key / mchSerialNo / mchPrivateKey(apiclient_key.pem) / wxPubKey / wxPubKeyId / appId / notifyUrl
"""

import base64
import json
import secrets
import time

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NATIVE_ORDER_URL = "https://api.mch.weixin.qq.com/v3/pay/transactions/native"
NATIVE_ORDER_PATH = "/v3/pay/transactions/native"


def is_ready(cfg: dict) -> bool:
    """真实模式是否凭证齐全（appId / notifyUrl 也到位）。"""
    return all(
        [
            cfg.get("mchId"),
            cfg.get("apiV3Key"),
            cfg.get("mchSerialNo"),
            cfg.get("mchPrivateKey"),
            cfg.get("appId"),
            cfg.get("notifyUrl"),
        ]
    )


def demo_code_url(order_id: str) -> str:
    """演示模式假 code_url（无法扫码，仅走通前端二维码/轮询流程）。"""
    return f"weixin://wxpay/bizpayurl?demo=1&pr={order_id}"


def _load_private_key(pem: str):
    return serialization.load_pem_private_key(pem.encode("utf-8"), password=None)


def _load_public_key(pem: str):
    return serialization.load_pem_public_key(pem.encode("utf-8"))


def _sign_b64(private_key, message: str) -> str:
    signature = private_key.sign(message.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
    return base64.b64encode(signature).decode("ascii")


def _build_authorization(method: str, path: str, body: str, cfg: dict) -> str:
    ts = str(int(time.time()))
    nonce = secrets.token_hex(16)
    message = f"{method}\n{path}\n{ts}\n{nonce}\n{body}\n"
    sig = _sign_b64(_load_private_key(cfg["mchPrivateKey"]), message)
    return (
        f'WECHATPAY2-SHA256-RSA2048 '
        f'mchid="{cfg["mchId"]}",nonce_str="{nonce}",timestamp="{ts}",'
        f'serial_no="{cfg["mchSerialNo"]}",signature="{sig}"'
    )


async def create_native_order(out_trade_no: str, description: str, amount_fen: int, cfg: dict) -> str:
    """调微信 Native 下单，返回 code_url。失败抛 ValueError。"""
    body_obj = {
        "appid": cfg["appId"],
        "mchid": cfg["mchId"],
        "description": description,
        "out_trade_no": out_trade_no,
        "notify_url": cfg["notifyUrl"],
        "amount": {"total": int(amount_fen), "currency": "CNY"},
    }
    body_str = json.dumps(body_obj, separators=(",", ":"), ensure_ascii=False)
    auth = _build_authorization("POST", NATIVE_ORDER_PATH, body_str, cfg)
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(
            NATIVE_ORDER_URL,
            content=body_str,
            headers={
                "Authorization": auth,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "kg-graph/1.0",
            },
        )
    data = r.json()
    if r.status_code != 200 or "code_url" not in data:
        raise ValueError(f"微信 Native 下单失败：{data}")
    return data["code_url"]


def verify_signature(timestamp: str, nonce: str, body: str, signature_b64: str, cfg: dict) -> bool:
    """用微信支付公钥验证回调签名。"""
    if not (cfg.get("wxPubKey") and signature_b64):
        return False
    message = f"{timestamp}\n{nonce}\n{body}\n"
    try:
        pub = _load_public_key(cfg["wxPubKey"])
        pub.verify(
            base64.b64decode(signature_b64),
            message.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except Exception:  # noqa: BLE001
        return False


def decrypt_resource(resource: dict, api_v3_key: str) -> dict:
    """用 APIv3 密钥 AES-256-GCM 解密回调 resource.ciphertext。"""
    nonce = resource["nonce"].encode("utf-8")
    ciphertext = base64.b64decode(resource["ciphertext"])
    associated_data = (resource.get("associated_data") or "").encode("utf-8")
    plain = AESGCM(api_v3_key.encode("utf-8")).decrypt(nonce, ciphertext, associated_data)
    return json.loads(plain.decode("utf-8"))
