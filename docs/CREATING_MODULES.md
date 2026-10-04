# 模组创建指南（v5）

模组 = 一份 `module.json`：事件树（故事怎么走）、变量（要记住什么）、条件（什么时候能进、能完成）、背景与投递（告诉 AI 什么）、可选的插件（侧栏小面板）。游戏按当前状态给 AI 拼提示词，AI 在回复里用指令标签推进状态。

三步：看教程模组 -> 写 `module.json` -> 校验并导入。

- **教程模组**：设置里选「修仙模组-功能展示」，调试页「模块跳转」看整棵树。每个事件、变量、插件的说明只写一句作用；结构清单在 `module/xiuxian-demo/MODULE_STRUCTURE.md`。
- **让 AI 帮你写**：把 `docs/AI写模组提示词.md` 里的提示词整段发给 AI。
- **校验**：`node tools/validate-module.mjs 你的module.json`
- 起步模板在 `module/_templates/`（`module.template.json` 是空结构，`MODULE_BUILD_RULES.md` 讲先画结构图再写 JSON 的流程）。

## 一、文件放哪

```
module/<文件夹名>/module.json     必需
module/<文件夹名>/plugins/…       可选（插件页面也能直接写进 module.json，推荐）
module/list.json                  随游戏发布的模组才需要登记
```

- 自己用：不用放进 `module/`。导入 `module.json` 即可：设置 -> 模组管理 -> 导入，或调试 -> 模组编辑 -> 导入模组。导入时有错误会拦下；在调试页导入，有提示还会让你确认。
- 随游戏发布：文件夹名只用字母、数字、`_`、`-`；在 `module/list.json` 加一项：

```json
{ "id": "模组标识", "name": "模组名称", "version": "1.0.0", "author": "作者", "description": "一句话简介", "path": "module/文件夹名", "enabled": true }
```

  测试用的模组再加 `"isTest": true`。

## 二、module.json 最外层

| 字段 | 说明 |
|---|---|
| `id` | 模组标识，必填 |
| `name`、`description`、`version` | 名称、简介、版本 |
| `timeSystem` | 时间系统，见第四节 |
| `timeUnits` | 进位：`minutesPerHour`、`hoursPerDay`、`daysPerMonth`、`monthsPerYear`，默认 60、24、30、12 |
| `info` | 根上的背景；标 `"persistent": true` 才会在所有事件里发出 |
| `variables` | 全模组可见的变量 |
| `plugins` | 全模组可见的插件 |
| `flows` | `main` 是主流程；其他名字是分流程 |

不要写 `content`（写了会被当成旧格式，主流程变成空树）。

## 三、事件

每个事件是 `flows.<流程名>.subModules` 里的一项：

| 字段 | 说明 |
|---|---|
| `id`、`name`、`type` | 标识（字母数字下划线，全模组唯一）、名称（全模组唯一，AI 按名称进入事件）、类型 |
| `note` | 给作者看的备注，不发给 AI |
| `tags` | 标签，供标签条件用 |
| `entryConditions` / `completionConditions` | 进入、完成条件，见第五节 |
| `info` | 背景：`[{ "content": "…", "condition": 单个包装, "persistent": true }]` |
| `deliveryInfo` | 投递：`[{ "title": "…", "content": "…", "condition": 单个包装 }]` |
| `queueDisplay` | `{ "before": 1, "after": 2 }`，提示词里列出之后几个、已完成几个事件的名字 |
| `linkedList` | 触发器链专用：`{ "prev": 前一个或 null, "next": 后一个或 null }` |
| `variables`、`plugins` | 这个事件及其子事件里可见的变量、插件 |
| `variableSetOnEnter` | `{ "变量标识": 值 }`；只在调试页跳转进入时生效，AI 进入事件和自动进入下一个都不触发 |
| `summary` | 子事件完成时请 AI 给这个事件写总结：`{ "enabled": true, "autoSummarize": true, "promptList": [{ "condition": [], "content": "提示" }] }` |
| `flows` | 子事件：`{ "main": { "entryEvent": null, "subModules": […] } }`，叶子事件可以不写 |

### 三种类型

- `trigger_chain` 触发器链：按 `linkedList` 顺序走，上一个完成才轮到下一个。链上的事件完成时，自动进入下一个。
- `free_trigger` 自由触发：没有顺序，条件满足就能进入。
- `timeline` 时间线：必须带 `time` 或 `time_range` 条件，到时间才能进入。

### 结构规则

- 有子事件的父事件，`main` 里至少要有一个 `trigger_chain` 子事件，否则进入后会停在父级。
- 新游戏从主流程第一个触发器链（一路进到最里面的第一个叶子）开始。
- 自由触发和时间线要和链事件放在同一个父事件下；链事件进行时它们才出现，离开这一组就不出现了。
- 要按顺序走过好几个父事件：父事件之间也用 `linkedList` 连成链，并让上一组的链尾事件 `linkedList.next` 指向下一组的链首事件（只写 `next`，下一组链首的 `prev` 写 `null`）。
- 链上排在后面的事件，上一个完成时会自动进入它，**不检查它的变量条件**。要用变量卡住进度，把条件写在上一个事件的 `completionConditions` 里，或让它做自由触发。
- 父事件的背景默认不发给子事件，要标 `persistent: true`（最多往上找 3 层）。
- 分流程：`flows` 里再放一个名字，`{ "name": "显示名", "entryEvent": "前置事件标识", "subModules": […] }`。前置事件完成后，分流程里的事件才能进入；前置事件必须放在主流程里，放在分流程自己里面就永远进不去。

## 四、时间系统

```json
"timeSystem": {
  "parameters": [
    { "id": "year", "type": "base", "systemBinding": "year" },
    { "id": "month", "type": "base", "systemBinding": "month" },
    { "id": "day", "type": "base", "systemBinding": "day" },
    { "id": "hour", "type": "base", "systemBinding": "hour" },
    { "id": "shichen", "type": "computed", "formula": "hour/2", "labels": ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"], "calculationOnly": true }
  ],
  "initialValues": { "year": 1, "month": 1, "day": 1, "hour": 8 },
  "displayFormat": "{{year}}年{{month}}月{{day}}日 {{shichen}}时"
}
```

- `base` 参数绑定系统的 `year`、`month`、`day`、`hour`、`minute`、`prefix`；AI 用 `<time|hour|add|2>` 推进，只能往前。
- `computed` 参数由「年月日时分之一 / 整数」算出名称，不能被 AI 直接改。
- 显示格式里的 `{{…}}` 必须是已定义的参数 id。

## 五、条件

条件有三层：条件组 `conditionDef` -> 组 `groups[].items[]` -> 单个条件。

```json
{ "logic": "AND", "groups": [ { "logic": "OR", "items": [
  { "itemType": "condition", "condition": { "type": "variable", "variableId": "qi", "operator": ">=", "value": 10 } },
  { "itemType": "group", "group": { "logic": "AND", "items": [ … ] } }
] } ] }
```

**四个地方的包装形状不一样，写错会被当成没有条件：**

| 位置 | 形状 |
|---|---|
| `entryConditions`、`completionConditions` | 包装数组 `[{ "type": "precondition", "conditionDef": … }]` |
| `info[].condition`、`deliveryInfo[].condition` | 单个包装 `{ "type": "display", "conditionDef": … }`，不是数组 |
| 变量的 `switchConditions[].condition` | 直接是条件组 `{ "logic", "groups" }`，不再包一层 |
| 变量的 `computeConditions[].conditionDef` | 直接是条件组 |

单个条件的类型：

| `type` | 写法 |
|---|---|
| `variable` | `variableId`、`operator`（`>= <= == != > <` 和 `in`）、`value` |
| `variable_compare` | `variableId`、`operator`、`compareVariableId` |
| `module` | `moduleId`、`state`（`entered` 或 `completed`） |
| `time` | 绝对：`{ "timeType": "absolute", "time": { "year": 1, "month": 1, "day": 2 } }`；相对：`{ "timeType": "relative", "relative": { "moduleId": "x", "state": "completed", "offset": { "hour": 2 } } }` |
| `time_range` | `timeType: "absolute"`、`start`、`end`；每天重复加 `"repeat": { "enabled": true, "interval": { "day": 1 } }`（`interval` 只能写 year、month、day 之一） |
| `tag` | `matchType`（`any` 或 `all`）、`tags`；看的是所有已进入事件（含父级）的标签 |

进入条件的合并规则：当前事件 + 所有父级 + 链上前一个事件的进入条件同时生效；同一个变量出现多次时，当前事件的优先。

## 六、变量

```json
{ "id": "qi", "name": "灵气", "type": "number", "category": "module", "initialValue": 0, "min": 0, "max": 100,
  "generalRules": "一句话说明，每回合随变量发给 AI。",
  "changeRules": [ { "name": "打坐", "operation": "add", "value": 10 } ] }
```

| 字段 | 说明 |
|---|---|
| `type` | `number`、`string`、`boolean`、`list`、`object`、`list_of_object` |
| `category` | `module` 发给 AI，AI 可改；`switch` 满足 `switchConditions` 才发；`builtin` 由 `computeConditions` 算出，不发给 AI；`temp` 暂存，不发给 AI，留给插件 |
| `initialValue` | 初始值，类型要和 `type` 一致 |
| `readonly` | `true`：发给 AI 看，但不能改 |
| `min`、`max` / `maxLength` | 数字范围 / 文字最大长度 |
| `elementType` | `list` 的元素类型：`string`、`number`、`boolean`、`object` |
| `fields` | `object`、`list_of_object` 的字段：`[{ "name": "姓名", "type": "string", "default": "" }]` |
| `changeRules` | 快捷规则：`{ "name", "operation", "value" }`，operation 用 `add subtract multiply divide set`；AI 写 `<rule|变量名|规则名>` |
| `computeConditions` | 自动计算，按顺序取第一条条件满足的：`{ "conditionDef": 条件组, "formula": "'筑基'" }`；文字结果要加引号；公式可用数字、文字、`{{变量标识}}`、四则、比较、`&&`、`||`、`? :`、`floor ceil round min max abs` |
| `switchConditions` | `[{ "type": "display", "action": "open", "condition": 条件组 }]` |

变量在定义它的事件及其子事件里可见；写在根上就是全模组可见。AI 用名称称呼变量，所以 `name` 要短且唯一，不含 `| < >`。

各类型 AI 能做的操作：

| 类型 | 操作 |
|---|---|
| number | `add subtract multiply divide set` |
| string | `set append` |
| boolean | `set`（写 true 或 false） |
| list | `append remove extend set` |
| object | `modify_item`（`field=称号,op=set,value=弟子`）、`set`（JSON） |
| list_of_object | `add_item`（`姓名=云舟,情谊=5`）、`modify_item`（`index=0,field=情谊,op=add,value=3`）、`remove_item`（序号）、`set`（JSON） |

## 七、投递

`deliveryInfo` 里的内容会一直发给 AI，直到 AI 用 `<delivery|标题|done>` 确认；确认之前，这个事件不能完成。标题在同一个事件里不能重复，不要写 `completed`。

## 八、插件

最小的显示插件，页面直接写进 `module.json`（导入单个文件也能用）：

```json
{ "id": "panel", "name": "面板", "type": "display",
  "inlineHtml": "<div><span>灵气</span> <b data-bind=\"qi\"></b></div>",
  "inlineStyle": "body{margin:0;padding:8px;background:#fff;color:#111}",
  "config": { "requiredVariables": ["qi"] } }
```

- `data-bind="变量标识"` 把变量的值显示在元素里；加 `data-bind-as="width"` 和 `data-bind-max="100"` 做进度条。
- 页面里的脚本要自己写时：用 `PluginAPI.onVars(fn)` 读变量；页面里同时有脚本和 `{{变量}}` 时，`{{` 会在载入时被替换，脚本里不要写 `{{`。
- 插件挂在哪个事件，就在该事件路径下显示；挂在根上全程显示。
- 类型一共八种：`display` 显示器、`interactive` 交互器、`display_interactive` 显示加交互器、`randomizer` 随机器、`variable_reader` 变量读取器、`variable_op` 变量操作器、`module_generator` 模块生成器、`summary` 总结器。

## 九、AI 回复里的指令

名字一律照抄提示词里写的显示名。

| 指令 | 作用 |
|---|---|
| `<var\|变量名\|操作\|值>` | 改变量 |
| `<rule\|变量名\|规则名>` | 用快捷规则改变量 |
| `<time\|参数\|add 或 set\|数值>` | 推进或设定时间 |
| `<module\|enter\|事件名>` | 进入「可进入」里的事件，当前事件算已完成 |
| `<module\|complete\|事件名>` | 完成正在进行的事件（要先确认投递、满足完成条件） |
| `<delivery\|标题\|done 或 uncompleted>` | 确认投递 |
| `<foreshadow\|标题\|描述\|触发条件>` | 记下伏笔，条件满足时再提醒 |
| `<plugin\|插件名\|内容>` | 调用交互器 |
| `<summary\|global 或 module 或 plugin\|内容>` | 记总结 |

没生效的指令，下一轮提示词里会提醒 AI，聊天里也会写明原因。

## 十、校验、导入、测试

1. **校验**：`node tools/validate-module.mjs module.json`。输出分「错误」（必须改）和「提示」（能导入，但行为可能不符合预期），每条带事件位置。`--strict` 让提示也算失败。
2. **导入**：设置 -> 模组管理 -> 导入。
3. **看树**：调试 -> 模块跳转，每个事件有「跳转」「完成」「未触发」。用「跳转」会同时把变量设到满足进入条件。
4. **看提示词**：调试 -> 提示词查看器，显示的就是下一次真正发送的内容。
5. **改**：调试 -> 模组编辑，所有字段都能点选修改，改完「导出新模组」或「覆盖原模组」。
6. **试玩**：新开游戏，用调试页作弊器改变量、改时间，看队列和提示词是否按预期变化。

## 十一、常见错误

| 现象 | 原因 |
|---|---|
| 导入后主流程是空的 | 文件里有 `content` 字段，被当成旧格式 |
| 条件不起作用 | 包装形状写错（第五节的表）；`logic` 没写 AND 或 OR；`itemType` 没写 |
| 进入父事件后停在父级 | 父事件的 `main` 里没有 `trigger_chain` |
| 走完一个阶段就停住了 | 这一组的链尾事件 `linkedList.next` 是 null，没有接到下一个阶段的链首事件 |
| 子事件里 AI 看不到父事件的背景 | 父事件的背景没标 `persistent: true` |
| 链上的事件没按变量条件卡住 | 自动进入不检查变量条件，见第三节 |
| 事件完不成 | 有没确认的投递，或完成条件没满足 |
| AI 的指令没生效 | 名字写成了内部标识，或事件不在「可进入」「可完成」里，或名字重复 |
| 分流程永远进不去 | 前置事件放在了分流程里面 |
| 文字类自动计算报错 | 公式里的文字结果没加引号（`'炼气'`） |
| 插件不显示 | 插件挂在了别的事件上；`type` 写错；页面用了文件路径但只导入了 `module.json` |
