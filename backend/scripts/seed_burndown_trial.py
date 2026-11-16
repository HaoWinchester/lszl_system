"""把免费体验卷的第一题替换为「燃尽图」双语案例题，并重新发布。

可移植脚本（本地/正式环境通用）：
    cd backend && .venv/bin/python scripts/seed_burndown_trial.py [--release-id pr_xxx] [--paper-id p_xxx] [--dry-run]

逻辑：matplotlib 重绘燃尽图 → 上传题目图片资产 → 创建案例材料 → 创建双语多选子题
→ 以题库权威内容重新发布该卷（第一题为新题，其余题引用原序保留，快照全部刷新）。
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.paper_release import PaperRelease  # noqa: E402
from app.models.question import ExamPaper, Question  # noqa: E402
from app.models.user import User  # noqa: E402
from app.schemas.question_material import AssetInput, MaterialInput  # noqa: E402
from app.services import question_material_service, question_service  # noqa: E402
from app.services import paper_release_service  # noqa: E402
from app.services.question_catalog_service import question_to_payload  # noqa: E402

DEFAULT_RELEASE_ID = "pr_80e4205f52f6486e868b77bb7f53cc3d"
BANK_ID = "b_e2acdfce71cf498fb9f8647e276fd700"  # 已确定题目（2026-09考试核对）·题库

STEM_ZH = "该发布计划分为 4 个迭代。从下面的燃尽图中，在第三迭代之后可以推断出什么？（选择两项）"
STEM_EN = (
    "The release plan is divided into 4 iterations. From the burndown chart below, "
    "what can be inferred after the third iteration? (Choose two)"
)
OPTIONS = [
    ("A", "第三迭代中新增了工作。", "Work was added during the third iteration."),
    ("B", "发布超前进度计划。", "The release is ahead of schedule."),
    ("C", "团队的速度（velocity）保持稳定。", "The team's velocity is stable."),
    ("D", "团队在第二迭代时超前进度。", "The team was ahead of schedule at the second iteration."),
]
ANALYSIS_ZH = (
    "第三迭代剩余工作不降反升，说明工作量扩大，例如新增范围、重新估算或缺陷增多；"
    "第二迭代实际剩余工作低于计划线，说明当时进度超前。因此选 A、D。"
)
ANALYSIS_EN = (
    "In the third iteration, remaining work rose instead of falling, indicating an increase "
    "in workload, such as added scope, re-estimation, or more defects. In the second iteration, "
    "actual remaining work was below the planned line, indicating the schedule was ahead of "
    "plan at that time. The correct answers are A and D."
)
MATERIAL_TITLE = "案例材料"
MATERIAL_TEXT = (
    "阅读以下材料，结合所给信息完成题目。\n\n"
    "燃尽图中的范围增加与进度表现：Actual（实际剩余）在第二迭代低于计划线（进度超前），"
    "但第三迭代回升并高于计划线（范围内工作增加或重新估算）。"
    "\n\nRead the material below and answer the question with the given information.\n"
    "Scope growth vs. schedule performance in a burndown chart: the actual line runs below "
    "the plan in iteration #2 (ahead of schedule), then rises above the plan in iteration #3 "
    "(scope was added or work was re-estimated)."
)


def render_burndown_chart() -> bytes:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    x = ["Start", "#1", "#2", "#3", "#4"]
    expected = [200, 150, 100, 50, 0]
    actual = [200, 180, 90, 100]
    fig, ax = plt.subplots(figsize=(6.4, 4.2), dpi=160)
    ax.plot(x, expected, marker="o", color="#1f77b4", linewidth=2, label="Expected")
    ax.plot(x[:4], actual, marker="o", color="#ff7f0e", linewidth=2, label="Actual")
    ax.set_ylim(0, 250)
    ax.set_yticks([0, 50, 100, 150, 200, 250])
    ax.grid(axis="y", color="#d9d9d9", linewidth=0.8)
    ax.legend(loc="lower left", frameon=False)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    fig.tight_layout()
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", facecolor="white")
    plt.close(fig)
    return buffer.getvalue()


async def main(release_id: str, dry_run: bool) -> None:
    async with AsyncSessionLocal() as db:
        admin = await db.get(User, "admin")
        if admin is None:
            raise SystemExit("admin 账号不存在，请先启动应用完成种子")
        release = await db.get(PaperRelease, release_id)
        if release is None:
            raise SystemExit(f"发布版本不存在：{release_id}")
        paper = await db.get(ExamPaper, release.paper_id)
        print(f"[1] 目标卷：{release.name}（paper={release.paper_id}, v{release.version}, {release.access_level}）")

        png = render_burndown_chart()
        asset = await question_material_service.upload_asset(
            db, admin,
            AssetInput(
                filename="burndown-chart.png", mime_type="image/png",
                data_base64=base64.b64encode(png).decode("ascii"),
                alt="燃尽图：范围增加与进度表现 / Burndown chart: scope growth vs. schedule",
            ),
        )
        print(f"[2] 图片资产：{asset['id']}")

        material = await question_material_service.save_material(
            db, admin,
            MaterialInput(title=MATERIAL_TITLE, text=MATERIAL_TEXT, images=[{"id": asset["id"]}]),
        )
        print(f"[3] 案例材料：{material['id']}（revision {material['revision']}）")

        new_question = await question_service.create_question(db, admin, BANK_ID, {
            "title": "燃尽图｜范围增加与进度推断（多选）",
            "type": "multiple_choice",
            "stemParts": [{"text": STEM_ZH}],
            "options": [{"id": oid, "text": zh, "trap": ""} for oid, zh, _ in OPTIONS],
            "correctOptionIds": ["A", "D"],
            "analysis": ANALYSIS_ZH,
            "translations": {"en": {
                "title": "Burndown Chart | Scope Growth and Schedule Inference (Multiple Choice)",
                "stemParts": [{"text": STEM_EN}],
                "options": [{"id": oid, "text": en} for oid, _, en in OPTIONS],
                "analysis": ANALYSIS_EN,
                "keyPath": {},
            }},
            # material/caseGroup 必须放 payload 顶层：normalize 会提取进 metadata._mixedContent
            "material": {"id": material["id"], "revision": material["revision"]},
            "caseGroup": {"id": material["id"], "order": 1, "total": 1},
        })
        print(f"[4] 新题已建：{new_question.id}（双语多选，答案 A/D）")

        from sqlalchemy import select  # noqa: E402
        from app.models.paper_release import PaperReleaseQuestion  # noqa: E402

        references, snapshots = [], []
        old_questions = (
            await db.execute(
                select(PaperReleaseQuestion)
                .where(PaperReleaseQuestion.release_id == release_id)
                .order_by(PaperReleaseQuestion.order_index)
            )
        ).scalars().all()
        replaced = False
        for index, row in enumerate(old_questions):
            question_id = row.question_id
            if index == 0 and not replaced:
                question_id = new_question.id
                replaced = True
            qrow = await db.get(Question, question_id)
            if qrow is None:
                raise SystemExit(f"原卷题目缺失：{question_id}")
            references.append({"order": index + 1, "questionId": question_id, "bankId": qrow.bank_id, "score": 1})
            snapshots.append({"bankId": qrow.bank_id, "questionId": question_id, "question": question_to_payload(qrow)})
        print(f"[6] 卷内题目：{len(references)}（第 1 题已替换为燃尽图案例题）")

        # 第一题为多选题：standard 卷不允许混合题型，显式把该卷切换为 mixed
        # （重新发布包含全部原题，题目组合对 mixed 合法；类型锁定检查据此通过）。
        paper_type = release.paper_type
        question_types = {snap["question"].get("type") for snap in snapshots}
        if paper_type == "standard" and question_types - {"single_choice"}:
            paper_type = "mixed"
            paper.paper_type = "mixed"
            await db.commit()
            print("[6b] 试卷类型：standard → mixed（因含多选题）")
        payload = {
            "releaseId": "pr_" + uuid.uuid4().hex,
            "paperId": release.paper_id,
            "publishedBy": {"username": admin.username},
            "name": release.name,
            "subject": release.subject,
            "paperType": paper_type,
            "enabledModes": list(release.enabled_modes or ["practice_mode"]),
            "accessLevel": release.access_level,
            "allowedRoles": list(release.allowed_roles or []),
            "metadata": release.metadata or {},
            "questions": references,
            "questionSnapshots": snapshots,
        }
        if dry_run:
            print("[dry-run] 发布载荷已构建，未执行发布")
            return
        published = await paper_release_service.publish_from_payload(db, admin, payload)
        print(f"[7] 已重新发布：{published.id}（v{published.version}），旧版本自动 superseded")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-id", default=DEFAULT_RELEASE_ID)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.release_id, args.dry_run))
