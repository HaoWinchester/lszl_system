"""微信支付生产凭证只允许从部署环境读取的回归测试。"""

from app.services import system_service
from app.services import subscription_service
from app.services import wechat_pay_service


def test_public_wechat_pay_config_excludes_all_secret_material() -> None:
    config = {
        "enableDemo": False,
        "mchId": "1115389574",
        "apiV3Key": "a" * 32,
        "mchSerialNo": "7A4E4B6E8A04843F94F5B680AEE1E5343F232066",
        "mchPrivateKey": "-----BEGIN PRIVATE KEY-----private-----END PRIVATE KEY-----",
        "wxPubKey": "-----BEGIN PUBLIC KEY-----public-----END PUBLIC KEY-----",
        "wxPubKeyId": "PUB_KEY_ID_0111153895742026071700191588001800",
        "appId": "wx2d8ea5212f8d9f4f",
        "notifyUrl": "https://lszl.aihuanpu.com/api/v1/subscriptions/wechat-pay/notify",
    }

    result = system_service.public_wechat_pay_config(config)

    assert result == {
        "enableDemo": False,
        "mchId": "1115389574",
        "mchSerialNo": "7A4E4B6E8A04843F94F5B680AEE1E5343F232066",
        "wxPubKeyId": "PUB_KEY_ID_0111153895742026071700191588001800",
        "appId": "wx2d8ea5212f8d9f4f",
        "notifyUrl": "https://lszl.aihuanpu.com/api/v1/subscriptions/wechat-pay/notify",
        "ready": True,
    }


def test_payment_credentials_are_loaded_from_environment_and_pem_files(tmp_path) -> None:
    private_key = tmp_path / "apiclient_key.pem"
    public_key = tmp_path / "wechatpay_pub.pem"
    private_key.write_text("private-pem", encoding="utf-8")
    public_key.write_text("public-pem", encoding="utf-8")

    result = system_service.wechat_pay_environment_overrides(
        {
            "WECHAT_PAY_ENABLE_DEMO": "false",
            "WECHAT_PAY_MCH_ID": "1115389574",
            "WECHAT_PAY_API_V3_KEY": "a" * 32,
            "WECHAT_PAY_MCH_SERIAL_NO": "7A4E4B6E8A04843F94F5B680AEE1E5343F232066",
            "WECHAT_PAY_MCH_PRIVATE_KEY_FILE": str(private_key),
            "WECHAT_PAY_WX_PUBLIC_KEY_FILE": str(public_key),
            "WECHAT_PAY_WX_PUBLIC_KEY_ID": "PUB_KEY_ID_0111153895742026071700191588001800",
            "WECHAT_PAY_APP_ID": "wx2d8ea5212f8d9f4f",
            "WECHAT_PAY_NOTIFY_URL": "https://lszl.aihuanpu.com/api/v1/subscriptions/wechat-pay/notify",
        }
    )

    assert result == {
        "enableDemo": False,
        "mchId": "1115389574",
        "apiV3Key": "a" * 32,
        "mchSerialNo": "7A4E4B6E8A04843F94F5B680AEE1E5343F232066",
        "mchPrivateKey": "private-pem",
        "wxPubKey": "public-pem",
        "wxPubKeyId": "PUB_KEY_ID_0111153895742026071700191588001800",
        "appId": "wx2d8ea5212f8d9f4f",
        "notifyUrl": "https://lszl.aihuanpu.com/api/v1/subscriptions/wechat-pay/notify",
    }


def test_payment_callback_amount_must_equal_order_amount() -> None:
    assert subscription_service.payment_amount_matches(2900, 2900)
    assert not subscription_service.payment_amount_matches(2900, 2901)
    assert not subscription_service.payment_amount_matches(2900, None)


def test_native_payment_amount_uses_the_visible_plan_price_and_discount() -> None:
    assert subscription_service._configured_plan_amount_fen(
        {"originalPriceText": "￥39.9 / 月", "discountPercent": "80"}
    ) == 3190
    assert subscription_service._configured_plan_amount_fen(
        {"originalPriceText": "119.9", "discountPercent": "75"}
    ) == 8990


def test_native_out_trade_no_never_exceeds_wechat_limit() -> None:
    order_id = subscription_service.native_out_trade_no()

    assert len(order_id) <= 32
    assert order_id.isalnum()


def test_native_payment_qr_is_a_png() -> None:
    image = wechat_pay_service.native_qrcode_png("weixin://wxpay/bizpayurl?pr=payment-token")

    assert image.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(image) > 100
