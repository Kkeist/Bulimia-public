# module.template.json 与读取逻辑兼容性说明

当前 **module.json 的 01-core-schemas 格式** 由以下路径读取：

- **app.js**：`buildDebugBridgeAndInitModuleJump()` 中 `fetch(module/<folderKey>/module.json)` → `config`，再交给：
  - `TimeSystem(config.timeSystem)`
  - `VariableSystem` + `variableSystem.registerVariables(config.variables, config.id)`
  - `ModuleSystem.loadModule(config)`（整份 config 作为根模块）
- **ModuleManager**：`loadFromModuleFolder()` / `reloadCurrentFromFolder()` 会 fetch 同一文件，但用 `_normalizeModule(data)` 转成「带 content.subModules」的旧结构；若 JSON 无 `content`，会得到空的 `content.subModules`，主流程的模块树依赖的是后者，因此**主流程目前仍预期使用带 content 的旧格式**，01 格式主要供调试桥 + 测试使用。

以下按 **调试桥路径**（TimeSystem + VariableSystem + ModuleSystem）说明模板中各部分是否被支持。

---

## 根级

| 字段 | 读取位置 | 说明 |
|------|----------|------|
| `id` | GameModule.id, registerVariables(_, config.id) | 支持 |
| `name` | GameModule.name | 支持 |
| `version` | 未使用 | 仅元数据 |
| `description` | 未在 01 路径使用；ModuleManager 用做显示 | 仅元数据 |
| `timeSystem` | TimeSystem 构造函数 | 见下 |
| `variables` | VariableSystem.registerVariables(config.variables, config.id) | 支持 |
| `flows` | GameModule.flows，parseSubModules 递归 | 支持 |

---

## timeSystem

| 字段 | 读取位置 | 说明 |
|------|----------|------|
| `parameters` | TimeSystem：config.parameters.map(p => new TimeParameter(p)) | 支持；空数组会回退为默认 6 个系统参数 |
| `initialValues` | TimeSystem.setInitialValues(config.initialValues) | 支持；需覆盖 parameters 里 base 参数的 id |
| `displayFormat` | TimeSystem.displayFormat | 支持 |

---

## variables[]

| 字段 | 读取位置 | 说明 |
|------|----------|------|
| id, name, type, category, initialValue | Variable 构造函数 | 支持 |
| generalRules, changeRules, supportedOperations | Variable 构造函数 | 支持 |
| switchConditions, computeConditions, listItemType, objectSchema | Variable 构造函数 | 支持（见 variable-system.js） |

---

## flows.* (main / 其他 flow)

| 字段 | 读取位置 | 说明 |
|------|----------|------|
| `entryEvent` | module-system canEnterModule / enterModule 中 parent.flows[flowName].entryEvent | 支持 |
| `subModules` | GameModule.parseSubModules → new GameModule(subConfig) | 支持 |
| `summary` | parseSubModules 中 flowData.summary → flowSummaries.set(flowName, …) | 支持 |

---

## 模块节点 (id, name, type, …)

| 字段 | 读取位置 | 说明 |
|------|----------|------|
| id, name, type, note, tags | GameModule 构造函数 | 支持 |
| entryConditions, completionConditions | _normalizeConditionWrappers → ConditionEvaluator.evaluateWrappers | 支持；单对象会规范为 [wrapper]，wrapper.conditionDef 需含 logic + groups |
| info | GameModule.info | 支持；info[].condition 可为 null，evaluateWrapper 时忽略 |
| deliveryInfo | GameModule.deliveryInfo，getPendingDeliveryInfo 用 condition 过滤 | 支持；condition 为 null 表示始终未完成则展示 |
| queueDisplay | GameModule.queueDisplay | 支持 |
| linkedList | GameModule.linkedList | 支持（trigger_chain） |
| variables, plugins | GameModule，enterModule 时 registerVariables(module.variables, module.id) | 支持 |
| flows, summary | parseSubModules；_normalizeModuleSummary(promptList[].condition/conditionDef) | 支持；promptList[].condition 空数组视为「无条件」 |

---

## 条件结构 (conditionDef)

ConditionEvaluator 要求：

- **ConditionWrapper**：`{ type: 'precondition'|'display', conditionDef }`
- **conditionDef**：`{ logic: 'AND'|'OR', groups: [ { logic, items: [ { itemType: 'condition', condition: { type, ... } } ] } ] }`

模板中的 entryConditions/completionConditions 已按该结构书写，condition 的 type 支持：`variable`、`variable_compare`、`module`、`time`、`time_range`、`tag`、`none`。

---

## 结论

- **调试桥路径**（fetch → TimeSystem + VariableSystem + ModuleSystem.loadModule）**支持**当前 module.template.json 中的全部信息；条件、总结、分流程 entryEvent、flow.summary 等均被正确读取和使用。
- **主流程**（ModuleManager + content.subModules）目前仍依赖「带 content 的旧格式」；若直接用 01 格式且无 content，主流程会得到空树。若要让主流程也走 01 格式，需要在 ModuleManager 中增加「01 格式 → content 树」的转换，或统一改为只认 01 格式并在此处构建 content。
- **game-engine.js** 中有 `this.moduleSystem.loadModules(moduleConfig.flows)`，而 ModuleSystem 仅实现 `loadModule(config)`，无 `loadModules`；若通过 game-engine 初始化模块，此处会报错，需改为传入完整 config 并调用 `loadModule(config)`。
