# Compatibility of module.template.json with the Loading Logic

The current **01-core-schemas format of module.json** is read through the following paths:

- **app.js**: in `buildDebugBridgeAndInitModuleJump()`, `fetch(module/<folderKey>/module.json)` → `config`, which is then passed to:
  - `TimeSystem(config.timeSystem)`
  - `VariableSystem` + `variableSystem.registerVariables(config.variables, config.id)`
  - `ModuleSystem.loadModule(config)` (the whole config is treated as the root module)
- **ModuleManager**: `loadFromModuleFolder()` / `reloadCurrentFromFolder()` fetch the same file but use `_normalizeModule(data)` to convert it into the legacy structure with `content.subModules`. If the JSON has no `content`, the result is an empty `content.subModules`. The main flow's module tree depends on the latter, so **the main flow still expects the legacy format with `content`**; the 01 format is mainly used by the debug bridge and tests.

The sections below describe, by the **debug bridge path** (TimeSystem + VariableSystem + ModuleSystem), whether each part of the template is supported.

---

## Root level

| Field | Read at | Notes |
|------|----------|------|
| `id` | GameModule.id, registerVariables(_, config.id) | Supported |
| `name` | GameModule.name | Supported |
| `version` | Not used | Metadata only |
| `description` | Not used on the 01 path; ModuleManager uses it for display | Metadata only |
| `timeSystem` | TimeSystem constructor | See below |
| `variables` | VariableSystem.registerVariables(config.variables, config.id) | Supported |
| `flows` | GameModule.flows, parseSubModules recursion | Supported |

---

## timeSystem

| Field | Read at | Notes |
|------|----------|------|
| `parameters` | TimeSystem: config.parameters.map(p => new TimeParameter(p)) | Supported; an empty array falls back to the 6 default system parameters |
| `initialValues` | TimeSystem.setInitialValues(config.initialValues) | Supported; must cover the ids of the base parameters in parameters |
| `displayFormat` | TimeSystem.displayFormat | Supported |

---

## variables[]

| Field | Read at | Notes |
|------|----------|------|
| id, name, type, category, initialValue | Variable constructor | Supported |
| generalRules, changeRules, supportedOperations | Variable constructor | Supported |
| switchConditions, computeConditions, listItemType, objectSchema | Variable constructor | Supported (see variable-system.js) |

---

## flows.* (main / other flows)

| Field | Read at | Notes |
|------|----------|------|
| `entryEvent` | module-system canEnterModule / enterModule via parent.flows[flowName].entryEvent | Supported |
| `subModules` | GameModule.parseSubModules → new GameModule(subConfig) | Supported |
| `summary` | flowData.summary in parseSubModules → flowSummaries.set(flowName, …) | Supported |

---

## Module nodes (id, name, type, …)

| Field | Read at | Notes |
|------|----------|------|
| id, name, type, note, tags | GameModule constructor | Supported |
| entryConditions, completionConditions | _normalizeConditionWrappers → ConditionEvaluator.evaluateWrappers | Supported; a single object is normalized to [wrapper]; wrapper.conditionDef must contain logic + groups |
| info | GameModule.info | Supported; info[].condition may be null and is ignored by evaluateWrapper |
| deliveryInfo | GameModule.deliveryInfo; getPendingDeliveryInfo filters by condition | Supported; a null condition means it is shown whenever it is not yet completed |
| queueDisplay | GameModule.queueDisplay | Supported |
| linkedList | GameModule.linkedList | Supported (trigger_chain) |
| variables, plugins | GameModule; registerVariables(module.variables, module.id) on enterModule | Supported |
| flows, summary | parseSubModules; _normalizeModuleSummary (promptList[].condition/conditionDef) | Supported; an empty promptList[].condition array means "unconditional" |

---

## Condition structure (conditionDef)

ConditionEvaluator requires:

- **ConditionWrapper**: `{ type: 'precondition'|'display', conditionDef }`
- **conditionDef**: `{ logic: 'AND'|'OR', groups: [ { logic, items: [ { itemType: 'condition', condition: { type, ... } } ] } ] }`

The entryConditions/completionConditions in the template are already written in this structure. Supported condition types: `variable`, `variable_compare`, `module`, `time`, `time_range`, `tag`, `none`.

---

## Conclusions

- The **debug bridge path** (fetch → TimeSystem + VariableSystem + ModuleSystem.loadModule) **supports** all the information in the current module.template.json; conditions, summaries, flow entryEvent, flow.summary and so on are all read and used correctly.
- The **main flow** (ModuleManager + content.subModules) still depends on the legacy format with `content`. If the 01 format is used directly without `content`, the main flow gets an empty tree. To let the main flow also use the 01 format, ModuleManager needs a "01 format → content tree" conversion, or it should be changed to accept only the 01 format and build content here.
- **game-engine.js** contains `this.moduleSystem.loadModules(moduleConfig.flows)`, but ModuleSystem only implements `loadModule(config)` and has no `loadModules`; initializing modules through game-engine will therefore throw. It should pass the full config and call `loadModule(config)` instead.
