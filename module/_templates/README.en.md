# Module Design Templates

- **MODULE_BUILD_RULES.en.md**: module construction rules (write MODULE_STRUCTURE first, then generate module.json).
- **MODULE_STRUCTURE.template.en.md**: structure design document template. Copy it into the module directory, rename it to `MODULE_STRUCTURE.md` and replace the placeholders.
- **module.template.en.json**: minimal module.json structure template. Copy it into the module directory, rename it to `module.json` and fill it in.

Creating a new module: copy the templates above into `module/<your-module-name>/`, fill in MODULE_STRUCTURE.md following BUILD_RULES, then generate or hand-write module.json from it.
