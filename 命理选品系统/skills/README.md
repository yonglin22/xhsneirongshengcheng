# skills（版本库归档）

`.claude/` 被项目 .gitignore 排除，故把用到的 Claude Code skill 归档在此，供任何环境激活。

## bazi —— 八字命理解读 skill（MIT，纯 Markdown）
四柱八字排盘与命理分析（大运/流年/经典引用）。触发词：算八字/排盘/命盘/看运势…

**激活**（在项目根执行）：
```bash
mkdir -p .claude/skills && cp -r 命理选品系统/skills/bazi .claude/skills/bazi
```
> 分工：**解读**用此 skill（模型）；**确定性排盘**用 `命理选品系统/契约/bazi_tcm.browser.js` 的代码（已验证）。
