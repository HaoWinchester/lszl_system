"""角色权限矩阵、主题/套餐/科目等默认常量。"""

ROLES = ["admin", "teacher", "student", "viewer"]
ROLE_LABELS = {
    "admin": "管理员",
    "teacher": "教师/教研",
    "student": "学员",
    "viewer": "游客",
    "guest": "访客",
}

STATUSES = ["active", "paused", "archived"]
STATUS_LABELS = {"active": "正常", "paused": "暂停", "archived": "已归档"}

SUBJECTS = ["PMP", "CSPM", "P2", "ACP", "NPDP", "PgMP", "PfMP", "CUSTOM"]
SUBJECT_LABELS = {
    "PMP": "PMP",
    "CSPM": "CSPM",
    "P2": "P2 / PRINCE2",
    "ACP": "ACP",
    "NPDP": "NPDP",
    "PgMP": "PgMP",
    "PfMP": "PfMP",
    "CUSTOM": "自定义",
}

PERMISSION_KEYS = [
    "editGraph", "accessQuestionBank", "manageQuestionBank", "editQuestions",
    "importData", "exportData", "managePapers", "publishPapers",
    "useTraining", "useDeepRecall", "accessUserManagement", "accessSystemSettings",
    "manageUsers", "modifyRoleThemes", "viewLogs",
]
PERMISSION_LABELS = {
    "editGraph": "编辑个人知识图谱",
    "accessQuestionBank": "进入题库管理",
    "manageQuestionBank": "新建/编辑/删除题库",
    "editQuestions": "编辑题目与认知标注",
    "importData": "导入题库/数据",
    "exportData": "导出题库/数据",
    "managePapers": "组卷与维护试卷",
    "publishPapers": "发布/取消发布试卷",
    "useTraining": "参加考题训练",
    "useDeepRecall": "使用深度回忆",
    "accessUserManagement": "进入用户管理",
    "accessSystemSettings": "进入系统设置",
    "manageUsers": "新建/编辑/归档用户",
    "modifyRoleThemes": "修改角色主题",
    "viewLogs": "查看操作日志",
}

ROLE_PERMISSIONS = {
    "admin": set(PERMISSION_KEYS),
    "teacher": {
        "editGraph", "accessQuestionBank", "manageQuestionBank", "editQuestions",
        "importData", "exportData", "managePapers", "publishPapers",
        "useTraining", "useDeepRecall",
    },
    "student": {"editGraph", "useTraining", "useDeepRecall"},
    "viewer": {"useTraining", "useDeepRecall"},
}


def can(role: str, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())


DEFAULT_THEMES = {
    "admin":   {"primary_color": "#0ea5e9", "accent_color": "#0284c7", "soft_color": "#e0f2fe", "text_color": "#0c4a6e"},
    "teacher": {"primary_color": "#7c3aed", "accent_color": "#6d28d9", "soft_color": "#ede9fe", "text_color": "#4c1d95"},
    "student": {"primary_color": "#16a34a", "accent_color": "#15803d", "soft_color": "#dcfce7", "text_color": "#14532d"},
    "viewer":  {"primary_color": "#64748b", "accent_color": "#475569", "soft_color": "#f1f5f9", "text_color": "#334155"},
}

# 套餐默认（展示、实际支付金额与有效期；权益服务端校验在阶段 7 完善）。
# paymentAmountFen 是唯一的收费真值；原价和折扣只用于辅助展示，不能反推订单金额。
DEFAULT_PLANS = [
    {"planId": "free", "name": "免费学员", "shortName": "免费", "validDays": 0, "paymentAmountFen": 0, "originalPriceText": "￥0", "discountPercent": "100", "enabled": True, "recommended": False, "badgeText": "", "description": "示例体验与轻量练习", "benefitText": "示例体验与轻量练习", "usageText": "图谱卡牌≤50；回忆知识点≤30"},
    {"planId": "monthly", "name": "月度会员", "shortName": "月度", "validDays": 30, "paymentAmountFen": 2900, "originalPriceText": "￥29", "discountPercent": "100", "enabled": True, "recommended": False, "badgeText": "", "description": "短期备考", "benefitText": "完整训练与回忆", "usageText": "不限图谱/回忆"},
    {"planId": "quarterly", "name": "季度会员", "shortName": "季度", "validDays": 90, "paymentAmountFen": 7900, "originalPriceText": "￥79", "discountPercent": "100", "enabled": True, "recommended": True, "badgeText": "推荐", "description": "阶段性备考", "benefitText": "阶段性备考套餐", "usageText": "不限图谱/回忆"},
    {"planId": "half_year", "name": "半年会员", "shortName": "半年", "validDays": 180, "paymentAmountFen": 13900, "originalPriceText": "￥139", "discountPercent": "100", "enabled": True, "recommended": False, "badgeText": "", "description": "主推备考周期", "benefitText": "主推备考周期套餐", "usageText": "不限图谱/回忆"},
    {"planId": "lifetime", "name": "终身会员", "shortName": "终身", "validDays": 0, "paymentAmountFen": 39900, "originalPriceText": "￥399", "discountPercent": "100", "enabled": True, "recommended": False, "badgeText": "", "description": "长期学习", "benefitText": "长期学习与高级能力", "usageText": "不限图谱/回忆"},
]

DEFAULT_WECHAT_CONFIG = {
    "enableDemo": True,
    "enableOfficial": False,
    "autoCreateUser": True,
    "appId": "",
    "appSecret": "",
    "redirectUri": "",
    "backendExchangeUrl": "",
    "scope": "snsapi_login",
    "defaultRole": "student",
    "defaultSubject": "PMP",
}

DEFAULT_WECHAT_PAY_CONFIG = {
    "enableDemo": True,
    "mchId": "",
    "apiV3Key": "",  # APIv3 密钥（32 位），解密回调用，敏感
    "mchSerialNo": "",  # 商户 API 证书序列号
    "mchPrivateKey": "",  # apiclient_key.pem 内容，最敏感
    "wxPubKey": "",  # 微信支付公钥内容（验签）
    "wxPubKeyId": "",  # 微信支付公钥 ID
    "appId": "",  # 关联的 AppID（等网站应用）
    "notifyUrl": "",  # https://你的域名/api/v1/subscriptions/wechat-pay/notify
}
