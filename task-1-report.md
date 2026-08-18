动态 storage key detector 修复记录（2026-08-17）

改动：
- frontend/scripts/runtime-removal-contract.test.mjs
  - DYNAMIC_KEY 现覆盖 localStorage/sessionStorage、global.localStorage/window.localStorage。
  - 支持对象访问与方法调用位置的 optional chaining。
  - 新增真实负向用例：global.localStorage?.setItem、window.localStorage?.getItem?.、localStorage?.setItem?.。
  - 三种形式使用动态表达式时均进入 dynamicRuntimeKey，并令 contractReport.blocked=true。
- frontend/scripts/runtime-removal-baseline.json
  - 登记扩大检测范围后发现的既有动态 storage key，确保门禁只阻断未审查新增项，未降低任何现有类别门禁。

TDD RED：
命令：node --test /Users/menghao/Documents/幻谱/佩奇老师/最新/frontend/scripts/runtime-removal-contract.test.mjs
结果：10 tests，9 pass，1 fail。新增用例按预期失败：qualified and optional storage calls with dynamic keys block the contract，false !== true。

首次 GREEN 检查：
命令：node --test /Users/menghao/Documents/幻谱/佩奇老师/最新/frontend/scripts/runtime-removal-contract.test.mjs
结果：10 tests，9 pass，1 fail。新增负向用例通过；基线门禁列出扩大检测范围后发现的既有 dynamicRuntimeKey，因此刷新 baseline。

刷新基线：
命令：WRITE_RUNTIME_REMOVAL_BASELINE=1 node --test /Users/menghao/Documents/幻谱/佩奇老师/最新/frontend/scripts/runtime-removal-contract.test.mjs
结果：10 tests，10 pass，0 fail，duration_ms 723.657875。

最终复验：
命令：node --test /Users/menghao/Documents/幻谱/佩奇老师/最新/frontend/scripts/runtime-removal-contract.test.mjs
结果：10 tests，10 pass，0 fail，duration_ms 712.044583。

约束确认：未 commit；未改 frontend/public；未改 active release。
