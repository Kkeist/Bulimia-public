# 模组设计模板

- **MODULE_BUILD_RULES.md**：模块构建规则（先写 MODULE_STRUCTURE 再生成 module.json）。
- **MODULE_STRUCTURE.template.md**：结构设计文档模板，复制到模组目录后改名为 `MODULE_STRUCTURE.md` 并替换占位。
- **module.template.json**：module.json 最小结构模板，复制到模组目录后改名为 `module.json` 并填写。

新建模组：复制上述模板到 `module/<你的模组名>/`，按 BUILD_RULES 填写 MODULE_STRUCTURE.md，再据此生成或手写 module.json。
