"""正式环境：新题型体验卷换第一题为「燃尽图」双语案例题，并为其余题目补英文。

用法（本地通过 SSH 隧道连正式库，或在服务器上直连）：
    ssh -L 15432:127.0.0.1:5432 resume-prod -N &   # 隧道
    cd backend && .venv/bin/python scripts/seed_prod_trial_bilingual.py \
        --database-url "postgresql+asyncpg://kg:<密码>@127.0.0.1:15432/kg_graph" \
        [--image /tmp/burndown.png] [--dry-run]

步骤：绘燃尽图 → 上传资产 → 建案例材料 → 建双语多选子题 → 替换卷内第一题
→ 为其余题目补 translations.en（已有英文的跳过）→ 重新发布（旧版本自动 superseded）。
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
from app.models.paper_release import PaperRelease, PaperReleaseQuestion  # noqa: E402
from app.models.question import ExamPaper, Question  # noqa: E402
from app.models.user import User  # noqa: E402
from app.schemas.question_material import AssetInput, MaterialInput  # noqa: E402
from app.services import paper_release_service, question_material_service, question_service  # noqa: E402
from app.services.question_catalog_service import question_to_payload  # noqa: E402

RELEASE_ID = "pr_e0d019ca7785427c80fe444294515e8f"  # 新题型体验卷（图表·案例·连线）

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

# 既有题目的英文翻译（按题库题目标题匹配，已有英文的自动跳过）
EXISTING_ENGLISH = {
    "聊天机器人上线前的测试选择": {
        "title": "Choosing the Right Testing Before a Chatbot Launch",
        "stemParts": [{"text": (
            "A Scrum Master is overseeing the launch of a service-desk chatbot. After release, "
            "complaints arose about responses to edge-case queries. After analyzing the issue, the "
            "business decided to take the chatbot offline, disrupting workflows and facing "
            "reputational risk.\nHow could this have been avoided? (Refer to the test protocol table.)"
        )}],
        "options": [
            {"id": "A", "text": "Conduct user acceptance testing to ensure the chatbot meets stakeholder needs and expectations."},
            {"id": "B", "text": "Perform integration testing to minimize any defects between the chatbot's components."},
            {"id": "C", "text": "Execute functional testing to verify the chatbot performs the required functions."},
            {"id": "D", "text": "Run regression testing to ensure all previously working chatbot features keep working after updates."},
        ],
        "analysis": (
            "Given complaints about edge-case responses after launch, user acceptance testing (UAT) is "
            "the most critical step that could have prevented this. UAT ensures the chatbot meets "
            "stakeholder needs and expectations, including validating its behavior with real users in "
            "real-world scenarios; this step would surface edge-case issues and align the bot with "
            "business goals before go-live. The correct answer is A."
        ),
        "keyPath": {},
    },
    "案例 1：每日站会中的阻碍": {
        "title": "Case 1: Impediments in the Daily Standup",
        "stemParts": [{"text": (
            "The team's daily standup does not discuss impediments and risks. Which of the following "
            "actions by the agile coach best aligns with the spirit of the Scrum framework?"
        )}],
        "options": [
            {"id": "A", "text": "Change the standup rules to require every member to report at least one impediment, or have a private talk after the meeting."},
            {"id": "B", "text": "Raise the issue at the next retrospective and guide the team to recognize that the core purpose of the standup is to inspect progress toward the sprint goal and surface impediments, rather than a mere status report."},
            {"id": "C", "text": "Ask the Product Owner to directly question each member about their impediments during the standup, because the PO best understands business value priorities."},
            {"id": "D", "text": "Change the daily standup to twice-weekly meetings so the team has more time to do the work and feels less reporting pressure."},
        ],
        "analysis": (
            "The team has reduced the standup to one-way status reporting, ignoring the exposure of "
            "impediments and risks, so key issues may stay hidden. Option A imposes command-style "
            "management and breeds formalism; members may invent irrelevant impediments to comply. "
            "Option B is correct: the retrospective is the formal event to inspect the process and agree "
            "on improvements, and the coach should guide the team there. Option C wrongly shifts "
            "facilitation to the PO. Option D weakens the inspection cadence instead of fixing how the "
            "standup is run. The correct answer is B."
        ),
        "keyPath": {},
    },
    "案例 2：混合开发的节奏协调": {
        "title": "Case 2: Coordinating Cadence in a Hybrid Approach",
        "stemParts": [{"text": (
            "In a hybrid development approach, the agile team's iteration cadence has drifted from the "
            "predictive team's planned schedule. What should the project manager do?"
        )}],
        "options": [
            {"id": "A", "text": "Switch the agile team to a predictive development mode as well, to unify the management rhythm."},
            {"id": "B", "text": "Cancel agile development and manage everything predictively to avoid conflicts."},
            {"id": "C", "text": "Ask the agile team to work overtime to catch up with the predictive team's schedule."},
            {"id": "D", "text": "Set coordination points at the project governance level and adjust the agile iterations' goals so they align with the predictive team's actually available time."},
        ],
        "analysis": (
            "In a hybrid project, when a schedule gap appears, the project manager should respect the "
            "characteristics of each methodology and find the connection and synchronization points "
            "between them. Option A forces a single methodology and sacrifices agility; Option B discards "
            "agile value entirely; Option C overworks the team without fixing the structural mismatch. "
            "Option D is correct: governance-level coordination points align both delivery rhythms. "
            "The correct answer is D."
        ),
        "keyPath": {},
    },
    "案例 3：提前交付实时报表": {
        "title": "Case 3: Delivering the Real-Time Report Earlier",
        "stemParts": [{"text": (
            "During the iteration review, a stakeholder asks to move the \"real-time reporting\" feature "
            "live from month 9 to month 7. As the project manager (who also acts as the agile coach), "
            "what is your most appropriate response?"
        )}],
        "options": [
            {"id": "A", "text": "Agree to the request on the spot and promise to compress the schedule by adding people."},
            {"id": "B", "text": "Suggest splitting the feature into several small MVP increments so that partial reporting capability is delivered in each upcoming sprint, releasing value earlier while reducing technical risk."},
            {"id": "C", "text": "Refuse the request because the iteration review only demonstrates completed work and does not discuss future priority changes."},
            {"id": "D", "text": "Ask the stakeholder to submit a formal change request for the change control board (CCB) to review before any decision."},
        ],
        "analysis": (
            "The stakeholder asks to bring the \"real-time reporting\" feature forward by two months. "
            "Option A is inappropriate: committing on the spot bypasses product and team analysis and "
            "increases communication cost and technical debt. Option B is correct: splitting a large "
            "feature into small deliverable increments responds to the business need quickly while "
            "lowering technical risk. Option C is wrong because priority trade-offs are legitimately "
            "discussed with stakeholders at the review. Option D over-processes a routine prioritization "
            "conversation. The correct answer is B."
        ),
        "keyPath": {},
    },
    "干系人参与等级匹配": {
        "title": "Matching Stakeholder Engagement Levels",
        "stemParts": [{"text": (
            "Match each stakeholder scenario on the left with the most appropriate engagement level on "
            "the right, using each level exactly once."
        )}],
        "analysis": (
            "Correct pairings: investors → unaware; vendors → neutral; the sales team → resistant; "
            "senior management → leading.\n"
            "PMP stakeholder engagement levels: Unaware — not aware of the project or its impacts; "
            "Resistant — aware but opposed; Neutral — aware, neither supportive nor opposed; "
            "Supportive — supportive of the work; Leading — actively engaged in ensuring project success."
        ),
        "keyPath": {},
    },
}


def render_burndown_chart(image_path: str | None) -> bytes:
    if image_path:
        return Path(image_path).read_bytes()
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


async def main(database_url: str | None, image_path: str | None, dry_run: bool) -> None:
    if database_url:
        # DATABASE_URL 通过进程环境变量传入（settings 启动时读取），在此仅做提示。
        print(f"[0] 数据库：{database_url.split('@')[-1]}")
    async with AsyncSessionLocal() as db:
        admin = await db.get(User, "admin")
        if admin is None:
            raise SystemExit("正式库缺少 admin 账号？请确认连的是正式库")
        release = await db.get(PaperRelease, RELEASE_ID)
        if release is None or release.status != "published":
            raise SystemExit(f"正式体验卷不可用：{RELEASE_ID}")
        print(f"[1] 目标卷：{release.name}（v{release.version}, {release.access_level}, {release.paper_type}）")

        png = render_burndown_chart(image_path)
        asset = await question_material_service.upload_asset(
            db, admin,
            AssetInput(
                filename="burndown-chart.png", mime_type="image/png",
                data_base64=base64.b64encode(png).decode("ascii"),
                alt="燃尽图：范围增加与进度表现 / Burndown chart: scope growth vs. schedule",
            ),
        )
        material = await question_material_service.save_material(
            db, admin,
            MaterialInput(title=MATERIAL_TITLE, text=MATERIAL_TEXT, images=[{"id": asset["id"]}]),
        )
        print(f"[2] 图片资产 {asset['id']} / 案例材料 {material['id']}（rev {material['revision']}）")

        new_question = await question_service.create_question(db, admin, (await db.get(ExamPaper, release.paper_id) and None) or await _first_bank_id(db), {
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
            "material": {"id": material["id"], "revision": material["revision"]},
            "caseGroup": {"id": material["id"], "order": 1, "total": 1},
        })
        print(f"[3] 新题已建：{new_question.id}（双语多选，答案 A/D）")

        # 其余题补英文（按标题匹配；已有英文的跳过）
        from sqlalchemy import select  # noqa: E402

        patched, skipped = [], []
        for row in (
            await db.execute(
                select(PaperReleaseQuestion)
                .where(PaperReleaseQuestion.release_id == RELEASE_ID)
                .order_by(PaperReleaseQuestion.order_index)
            )
        ).scalars().all():
            qrow = await db.get(Question, row.question_id)
            if qrow is None:
                raise SystemExit(f"题目在题库中缺失：{row.question_id}（{row.snapshot.get('title')}）")
            en = (qrow.translations or {}).get("en")
            if qrow.id == new_question.id or en:
                skipped.append(qrow.title)
                continue
            translation = EXISTING_ENGLISH.get(qrow.title)
            if not translation:
                skipped.append(f"{qrow.title}（无内置翻译，需人工补充）")
                continue
            qrow.translations = {**(qrow.translations or {}), "en": translation}
            patched.append(qrow.title)
        print(f"[4] 补英文 {len(patched)} 题：{patched}")
        print(f"    跳过 {len(skipped)} 题：{skipped}")
        missing = [item for item in skipped if "无内置翻译" in item]
        if missing:
            print(f"⚠ 以下题目缺英文且无内置翻译，本次仍会发布但该题无法切换双语：{missing}")

        references, snapshots = [], []
        old_questions = (
            await db.execute(
                select(PaperReleaseQuestion)
                .where(PaperReleaseQuestion.release_id == RELEASE_ID)
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
            references.append({"order": index + 1, "questionId": question_id, "bankId": qrow.bank_id, "score": 1})
            snapshots.append({"bankId": qrow.bank_id, "questionId": question_id, "question": question_to_payload(qrow)})
        print(f"[5] 发布题目：{len(references)} 题（第 1 题已替换为燃尽图案例题）")

        payload = {
            "releaseId": "pr_" + uuid.uuid4().hex,
            "paperId": release.paper_id,
            "publishedBy": {"username": admin.username},
            "name": release.name,
            "subject": release.subject,
            "paperType": release.paper_type,
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
        print(f"[6] 已重新发布：{published.id}（v{published.version}），旧版本自动 superseded")


async def _first_bank_id(db) -> str:
    from sqlalchemy import select  # noqa: E402

    row = (await db.execute(select(Question.bank_id).limit(1))).first()
    if row is None:
        raise SystemExit("正式库题库为空？")
    return row[0]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=None, help="覆盖 DATABASE_URL（SSH 隧道场景）")
    parser.add_argument("--image", default=None, help="燃尽图 PNG 路径（默认 matplotlib 重绘）")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.database_url, args.image, args.dry_run))
