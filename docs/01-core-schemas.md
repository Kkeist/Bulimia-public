# 01 - 核心数据结构定义

本文档定义Bulimia模块系统的完整数据结构Schema，包括时间系统、条件系统、变量系统、插件系统和文件结构。

**约定**:
- 🔷 **通用模板**: 可直接复用的结构定义
- 📋 **具体示例**: 演示用的实际案例，明确标注"示例"
- ⚠️ **重要规则**: 必须遵守的约束

---

## 核心设计原则

**[中心准则]**: 系统设计通用于所有模组，模组实现完全由模组定义。系统内禁止包含任何具体模组内容。

**[耦合准则]**: 系统与模组耦合度最低，模组可完全独立开发。

**[可扩展准则]**: 充分考虑未来扩展需求，避免过早锁定设计。

**[可读准则]**: 设计清晰易懂，指导用户创建模组。

---

## 文件夹结构

### 🔷 模组文件夹结构（通用模板）

```
bulimia/
├── module/
│   ├── list.json                    # 模组列表索引
│   ├── <story-id>/                  # 单个模组文件夹
│   │   ├── module.json              # 模组主配置
│   │   ├── plugins/                 # 插件目录
│   │   │   ├── <plugin-id>/
│   │   │   │   ├── config.json      # 插件元配置
│   │   │   │   ├── logic.js         # 插件逻辑（可选）
│   │   │   │   ├── display.html     # 前端（可选）
│   │   │   │   ├── display.css      # 样式（可选）
│   │   │   │   └── pool.json        # 随机池（可选）
│   │   └── README.md
```

### 导入导出

**导出**: 
- 整个 `<story-id>/` 打包为 `.zip`
- 文件名: `<story-id>_v<version>.zip`

**导入**:
- 解压到 `module/` 目录
- 自动更新 `list.json`
- 验证 `module.json` 结构

**单个分流程（NPC）导入导出**:
- NPC就是普通分流程，无特殊结构
- 支持导出单个flow的JSON，方便迁移
- 导入时进行ID冲突检测和变量合并

---

## 通用术语定义

### 🔷 [ConditionDef] - 条件定义对象

```json
{
  "logic": "AND | OR",
  "groups": [
    {
      "logic": "AND | OR",
      "items": [
        { "itemType": "condition", "condition": { ... } },
        { "itemType": "group", "group": { ... } }
      ]
    }
  ]
}
```

### 🔷 [ConditionWrapper] - 条件包装对象

```json
{
  "type": "precondition | display",
  "conditionDef": [ConditionDef]
}
```

### 🔷 [TimePoint] - 时间点对象

```json
{
  "year": 1,
  "month": 3,
  "day": 15,
  "hour": 0,
  "minute": 0
}
```

### 🔷 [RelativeTimePoint] - 相对时间点对象

```json
{
  "moduleId": "xxx",
  "state": "entered | completed",
  "offset": { "month": 1, "day": 5 }
}
```

---

## 一、时间系统

### 核心机制

⚠️ **系统时间**: 游戏内置 `year, month, day, hour, minute, prefix` 六个基础参数

**模组时间参数**:
- `base类型`: 直接绑定系统参数
- `computed类型`: 通过除法公式计算（如 `day/12` 自动计算时辰）
- `默认行为`: `parameters`为空时自动使用全部系统时间参数

### 🔷 时间系统根结构

```json
{
  "timeSystem": {
    "parameters": [
      {
        "id": "string",
        "type": "base | computed",
        "systemBinding": "year | month | day | hour | minute | prefix",
        "formula": "string",
        "labels": ["string"],
        "calculationOnly": true | false
      }
    ],
    "initialValues": { "parameterId1": value1, "parameterId2": value2 },
    "displayFormat": "{{year}}年{{month}}月{{day}}日 第{{week}}周"
  }
}
```

⚠️ **重要**: `initialValues`必须包含**所有**parameters中定义的id（包括base和computed类型）
- 当有labels时，inital是list的index而不是具体值

### 参数字段详解

#### 通用字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 参数标识，用于displayFormat引用 |
| `type` | enum | 是 | `base` 或 `computed` |
| `calculationOnly` | boolean | 否 | 是否仅计算不可手动推进 |

#### base类型专用

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `systemBinding` | enum | 是 | 必须绑定所有使用到的系统参数 |

⚠️ **重要**: 所有使用到的系统时间参数都必须在parameters中绑定

#### computed类型专用

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `formula` | string | 是 | 格式：`systemParam/divisor` (如 `day/12`) |
| `labels` | array | 是 | 标签数组，系统按除法结果自动分配 |

### 📋 示例1: 公历 + 时辰 + 星期

```json
{
  "parameters": [
    { "id": "year", "type": "base", "systemBinding": "year" },
    { "id": "month", "type": "base", "systemBinding": "month" },
    { "id": "day", "type": "base", "systemBinding": "day" },
    {
      "id": "week",
      "type": "computed",
      "formula": "day/7",
      "labels": ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    },
    {
      "id": "shichen",
      "type": "computed",
      "formula": "day/12",
      "labels": ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]
    }
  ],
  "initialValues": { "year": 1, "month": 8, "day": 1, "week": 0, "shichen": 0 },
  "displayFormat": "{{year}}年{{month}}月{{day}}日 {{week}} {{shichen}}时"
}
```

### 📋 示例2: 修真历法

```json
{
  "parameters": [
    { "id": "prefix", "type": "base", "systemBinding": "prefix" },
    { "id": "year", "type": "base", "systemBinding": "year" },
    { "id": "month", "type": "base", "systemBinding": "month" },
    { "id": "day", "type": "base", "systemBinding": "day" },
    {
      "id": "shichen",
      "type": "computed",
      "formula": "day/12",
      "labels": ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]
    }
  ],
  "initialValues": { "prefix": "天元", "year": 5234, "month": 3, "day": 15, "shichen": 0 },
  "displayFormat": "{{prefix}}{{year}}年{{month}}月{{day}}日 {{shichen}}时辰"
}
```

---

## 二、条件系统

### 核心机制

⚠️ **嵌套结构**: 使用`groups`和`items`实现多层AND/OR组合

**两种模式**:
- `precondition`: 单次判断，不支持time_range
- `display`: 持续判断，time必须使用time_range

### 🔷 条件定义通用模板

```json
{
  "logic": "AND | OR",
  "groups": [
    {
      "logic": "AND | OR",
      "items": [
        {
          "itemType": "condition",
          "condition": {
            "type": "none | variable | module | time | time_range | tag | variable_compare"
          }
        },
        {
          "itemType": "group",
          "group": {
            "logic": "AND | OR",
            "items": [...]
          }
        }
      ]
    }
  ]
}
```

### 条件类型详解

#### 1. none - 无条件

```json
{ "type": "none" }
```

#### 2. variable - 变量判断

```json
{
  "type": "variable",
  "variableId": "xxx",
  "operator": ">= | <= | == | != | in",
  "value": "any"
}
```

#### 3. variable_compare - 变量间比较

```json
{
  "type": "variable_compare",
  "variableId": "score",
  "operator": ">= | <= | == | !=",
  "compareVariableId": "passScore"
}
```

#### 4. module - 模块状态

```json
{
  "type": "module",
  "moduleId": "xxx",
  "state": "entered | completed"
}
```

#### 5. time - 时间点判断（precondition专用）

**绝对时间**:
```json
{
  "type": "time",
  "timeType": "absolute",
  "time": { "year": 1, "month": 3, "day": 15 }
}
```

**相对时间**:
```json
{
  "type": "time",
  "timeType": "relative",
  "relative": {
    "moduleId": "xxx",
    "state": "entered | completed",
    "offset": { "month": 1, "day": 5 }
  }
}
```

⚠️ **说明**: 条件满足表示当前时间已到达或超过指定时间点

#### 6. time_range - 时间区间（display专用）

```json
{
  "type": "time_range",
  "timeType": "absolute | relative",
  "start": [TimePoint] | [RelativeTimePoint],
  "end": [TimePoint] | [RelativeTimePoint]
}
```

#### 7. tag - 标签判断

```json
{
  "type": "tag",
  "matchType": "any | all",
  "tags": ["tag1", "tag2"]
}
```

### 📋 完整嵌套示例

```json
{
  "logic": "AND",
  "groups": [
    {
      "logic": "OR",
      "items": [
        {
          "itemType": "condition",
          "condition": {
            "type": "variable",
            "variableId": "score",
            "operator": ">=",
            "value": 60
          }
        },
        {
          "itemType": "group",
          "group": {
            "logic": "AND",
            "items": [
              {
                "itemType": "condition",
                "condition": {
                  "type": "module",
                  "moduleId": "补考",
                  "state": "completed"
                }
              },
              {
                "itemType": "condition",
                "condition": {
                  "type": "variable",
                  "variableId": "补考成绩",
                  "operator": ">=",
                  "value": 50
                }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

---

## 三、变量系统

### 核心机制

⚠️ **作用域规则**: 变量仅在定义它的模块及所有子模块中可见

**类别与AI可见性**:
- `module`: 默认发送给AI，可修改
- `switch`: 满足条件时发送，可修改
- `builtin`: 不发送AI（自动计算）
- `temp`: 不发送AI（插件暂存）

### 🔷 变量定义通用模板

```json
{
  "id": "string",
  "name": "string",
  "type": "number | string | boolean | list | object | list_of_object",
  "category": "module | switch | builtin | temp",
  "initialValue": "any",
  "readonly": false,
  
  "generalRules": "string",
  "changeRules": [
    {
      "name": "规则名称",
      "operation": "add | subtract | set | ...",
      "value": "any"
    }
  ],
  "supportedOperations": [
    {
      "operation": "add | subtract | multiply | divide | set | append | remove | extend | add_item | modify_item",
      "description": "string",
      "params": {}
    }
  ],
  
  "switchConditions": [
    {
      "type": "display | trigger",
      "condition": [ConditionDef],
      "action": "open | close"
    }
  ],
  
  "computeConditions": [
    {
      "conditionDef": [ConditionDef],
      "formula": "string"
    }
  ],
  
  "listItemType": "number | string | object | list_of_object",
  "objectSchema": [...]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 变量ID |
| `name` | string | 是 | 显示名称 |
| `type` | enum | 是 | 数据类型 |
| `category` | enum | 是 | 变量类别 |
| `initialValue` | any | 是 | 初始值 |
| `readonly` | boolean | 否 | AI只读模式 |
| `generalRules` | string | 否 | **通用规则**（发送变量时自动发送的规则说明） |
| `changeRules` | array | 否 | **操作规则列表**（name+operation+value） |
| `supportedOperations` | array | 否 | 支持的操作列表 |
| `switchConditions` | array | 否 | 开关变量条件 |
| `computeConditions` | array | 否 | 内置变量计算公式 |
| `listItemType` | string | 条件 | list类型时必填 |
| `objectSchema` | array | 条件 | object/list_of_object时必填 |

⚠️ **generalRules vs changeRules**:
- `generalRules` (string): 通用规则说明，发送变量给AI时自动附带，用于告诉AI该变量的一般使用规则
- `changeRules` (list): 操作规则列表，AI通过调用rule名称来快速执行预定义操作
- 两者是**完全不同的参数**，各司其职

⚠️ **changeRules格式说明**:
- 每条rule包含：`name`（规则名称）+ `operation`（操作类型）+ `value`（操作值）
- AI调用rule名称时，系统自动执行对应的operation(value)
- 例如：AI说"考试通过加分"，系统自动执行`add(10)`

### 📋 示例1: number变量

```json
{
  "id": "score",
  "name": "分数",
  "type": "number",
  "category": "module",
  "initialValue": 0,
  "generalRules": "分数用于记录学生的学业表现，范围0-100",
  "changeRules": [
    {
      "name": "考试通过加分",
      "operation": "add",
      "value": 10
    },
    {
      "name": "考试不通过扣分",
      "operation": "subtract",
      "value": 5
    },
    {
      "name": "重大成就奖励",
      "operation": "add",
      "value": 20
    }
  ],
  "supportedOperations": [
    {
      "operation": "add",
      "description": "增加分数",
      "params": { "value": "number" }
    },
    {
      "operation": "subtract",
      "description": "减少分数",
      "params": { "value": "number" }
    },
    {
      "operation": "set",
      "description": "设置分数",
      "params": { "value": "number" }
    }
  ]
}
```

💡 **使用样例**:
- **AI调用**: 当AI判断"考试通过"，AI输出`<rule|score|考试通过加分>`
- **系统执行**: 系统自动执行`score.add(10)`
- **效果**: 分数+10
- **优势**: AI无需记住具体数值，只需调用语义化的rule名称

### 📋 示例2: list_of_object变量（嵌套Schema）

```json
{
  "id": "friends",
  "name": "好友列表",
  "type": "list_of_object",
  "category": "module",
  "initialValue": [],
  "generalRules": "好友列表记录所有认识的人以及关系状态",
  "changeRules": [
    {
      "name": "添加新朋友",
      "operation": "add_item",
      "value": { "name": "$name", "relation": 50, "tags": [] }
    },
    {
      "name": "增加好感度",
      "operation": "modify_item",
      "value": { "index": "$index", "field": "relation", "op": "add", "value": 10 }
    },
    {
      "name": "降低好感度",
      "operation": "modify_item",
      "value": { "index": "$index", "field": "relation", "op": "subtract", "value": 10 }
    }
  ],
  "objectSchema": [
    {
      "id": "name",
      "name": "姓名",
      "type": "string"
    },
    {
      "id": "relation",
      "name": "好感度",
      "type": "number"
    },
    {
      "id": "tags",
      "name": "标签",
      "type": "list",
      "listItemType": "string"
    }
  ],
  "supportedOperations": [
    {
      "operation": "add_item",
      "description": "添加好友",
      "params": { "name": "string", "relation": "number", "tags": "list" }
    },
    {
      "operation": "modify_item",
      "description": "修改好友字段",
      "params": { "index": "number", "field": "string", "op": "add|set", "value": "any" }
    },
    {
      "operation": "remove_item",
      "description": "移除好友",
      "params": { "index": "number" }
    }
  ]
}
```

💡 **操作rule支持**: 
- AI调用rule名称（如"添加新朋友"），系统执行预定义的operation和value
- value中的`$param`表示AI需要提供的参数（如`$name`表示AI提供姓名）
- 例如：AI输出`<rule|friends|添加新朋友|name=王五>`，系统执行`friends.add_item({name:"王五", relation:50, tags:[]})`

---

## 四、插件系统

### 🔷 插件定义通用模板

```json
{
  "id": "string",
  "name": "string",
  "type": "randomizer | display | interactive | display_interactive | module_generator | variable_reader",
  "note": "string",
  
  "condition": {
    "type": "precondition | display | always",
    "conditionDef": [ConditionDef]
  },
  
  "enabled": true,
  
  "files": {
    "logic": "plugins/<plugin-id>/logic.js",
    "display": "plugins/<plugin-id>/display.html",
    "style": "plugins/<plugin-id>/display.css",
    "pool": "plugins/<plugin-id>/pool.json"
  },
  
  "config": { /* 类型特定配置 */ },
  
  "tempVariables": [
    { "id": "xxx", "name": "xxx", "type": "string" }
  ]
}
```

### 六种插件类型（特点与前端要求）

| 类型 | 用户输入 | 发给 AI | AI 返回 | 前端要求 | 说明 |
|------|----------|---------|---------|----------|------|
| **randomizer** | 否 | 否 | 否 | **无** | 只被调用，不做其他事；结果由 variable_reader 等存变量。 |
| **variable_reader** | 否 | 否 | 否 | **无** | 只存变量，从随机器/内置读入并写入模块变量；变量器即可，无需前端。 |
| **module_generator** | 否 | 否 | 否 | **无** | 生成模块，变量会存过去；进入模块时执行一次。 |
| **display** | 可选（本地/保存） | **不发给 AI** | 否 | 需要用户输入时**必须有** | 展示用；用户可输入保存到本地或自己玩，不发给 AI。 |
| **interactive** | **是** | 是 | **是** | **必须有** | 同时需要用户输入和 AI 输出；无前端则无法接收用户输入。 |
| **display_interactive** | 否（或无效） | 是 | **是** | 需展示 AI 返回时应有 | 发给 AI，用户不输入或输入无效；AI 会返回内容，需有前端展示。 |

#### 1. randomizer - 随机器

只被系统/其他插件调用，不主动做任何事；输出可写入暂存，由 variable_reader 转存为变量。**无前端**。

```json
{
  "type": "randomizer",
  "config": {
    "outputType": "string | object | array",
    "poolSource": "plugins/exam/pool.json",
    "tempStorage": "exam_output"
  }
}
```

#### 2. variable_reader - 变量读取器

从随机器或内置读入 → 按映射写入模块/开关变量。**无前端**；只存变量即可。

```json
{
  "type": "variable_reader",
  "config": {
    "inputSource": "randomizer-id",
    "targetVariables": [
      {
        "variableId": "xxx",
        "mapping": "从input提取的映射规则"
      }
    ]
  }
}
```

#### 3. module_generator - 模块生成器

读入变量/随机器结果 → 生成分流程模块并注册；变量会存过去。**无前端**。进入模块时执行一次。

```json
{
  "type": "module_generator",
  "config": {
    "inputSource": "randomizer-id | builtin",
    "outputFlow": "分流程名称",
    "moduleTemplate": { /* 模块模板 */ }
  }
}
```

#### 4. display - 展示器

不发给 AI。读取当前模块变量展示给用户；用户可输入、保存到本地或自己玩（不发给 AI）。**需要用户输入时必须有前端**，否则无法输入。

```json
{
  "type": "display",
  "config": {
    "fixedWidth": 300,
    "minHeight": 200,
    "requiredVariables": ["score", "name"]
  }
}
```

#### 5. interactive - 交互器

**同时需要用户输入和 AI 输出**：用户输入 → 整理成 prompt 发给 AI → AI 回复 → 整理后展示。**必须有前端**，否则无法接收用户输入；仅用暂存无法替代真实交互。

```json
{
  "type": "interactive",
  "config": {
    "promptTemplate": "AI交互prompt模板",
    "outputFormat": "AI回复格式要求",
    "blockId": "<plugin-id>",
    "userInteraction": "用户输入说明"
  }
}
```

#### 6. display_interactive - 展示交互器

发给 AI，**用户不输入或用户输入无效**；AI 会返回内容，插件负责把返回转化成可展示格式。需要前端以展示 AI 返回内容。

```json
{
  "type": "display_interactive",
  "config": {
    "fixedWidth": 300,
    "minHeight": 200,
    "requiredVariables": ["xxx"],
    "updatePrompt": "AI实时更新prompt"
  }
}
```

### 插件容器规范

⚠️ **统一尺寸**:
- 宽度固定：300px（与status bar一致）
- 高度可变：最小高度 + 内容自动扩展
- 支持等比例缩放

**系统提供**:
- 外层框架（标题栏、边框）
- 拖动功能
- 浮动窗口
- 最小化到bar

---

## 五、模块结构

### 模块设计指引（先设计再写 module.json）

设计阶段建议先定好每个模块的以下内容，再落成 JSON：

- **进入条件 entryConditions**  
  - 控制**何时可以进入**该模块（单次用 `type: precondition`，持续可见用 `type: display`）。  
  - **系统默认（实现时自动加入，module.json 内不必写）**：触发器链类型时，系统自动加入「linkedList.prev 对应模块 state=completed」；模组只写**额外**条件（无则可不写或 none）。链首（prev 为 null）无此默认。  
  - 常用：`module`、`time`、`variable`、多条件用 ConditionDef 的 logic + groups 组合。  
  - **【进入条件合并规则】**（系统判定与跳转时统一使用）：实际参与判定的进入条件 = **当前模块**的 entryConditions + **所有父级**（沿树到根）的 entryConditions + **顺序前一个**（仅触发器链：linkedList.prev 对应模块）的 entryConditions；同一变量出现多条条件时 **当前模块优先级最高**（以当前模块为准）。

- **完成条件 completionConditions**  
  - 控制**何时算该模块完成**（用于链式推进、entryEvent 解锁等）。  
  - **系统默认（实现时自动加入，module.json 内不必写）**：所有模块默认均为「AI 判定该事件在剧情上已完成」后才标记完成；模组只写**额外**条件（如变量达标），不写则仅由 AI 判定结束。

- **info**  
  - 进入模块后**发给 AI 的背景信息**，可多条，每条可带 `condition` 控制何时发送。  
  - 用于交代当前情境、可选行动、规则提示等。

- **deliveryInfo**  
  - **一次性投递**：带 title + content，需要 AI 用 `<delivery|title|done>` 确认后系统将该项 `completed` 置 true，之后不再发送。  
  - **系统默认**：每条 `completed` 未写时默认为 false，模组内不写 `completed: false`。  
  - 适合「任务说明」「指引」「待办」类内容。

- **queueDisplay**（仅叶节点）  
  - 队列中只展示当前事件**前 n / 后 m** 条，避免上下文过长。

- **linkedList**（仅 trigger_chain）  
  - `prev` / `next` 标出链上前驱/后继模块 id，链首 prev 为 null，链尾 next 为 null。

- **tags**  
  - 字符串数组，供条件类型 `tag` 使用（如「战斗中」「闭关中」）。

写 module 时：entryConditions/completionConditions 按 [ConditionWrapper] 与 [ConditionDef] 填；info/deliveryInfo 按上表字段填；时间线必须含 time/time_range 条件；触发器链必须含 linkedList。

---

### 跳转与跳转数值需求（系统行为）

- **跳转**：进入指定叶模块时，系统会完成链上前序、进入目标及父链、取消同 flow 内其它 entered 等（见实现）。
- **跳转/进入时变量更新**：当跳转或进入模块时 `updateVariables` 为 true（默认）时，系统会：（1）按 **进入条件合并规则** 收集目标模块、其父级链、链上前一模块的**变量类进入条件**，同一变量当前优先；对 `>=` / `<=` / `=` 分别将变量设到满足条件（如 `>= 10` 则至少 10，`<= 9` 则至多 9，`= 0` 则设为 0）；（2）若模块配置了 **variableSetOnEnter**，再强制设置这些变量；（3）最后调用 `updateBuiltinVariables()`。这样「筑基跳回凡人」时，凡人模块的 variableSetOnEnter 可将 cultivation 设为 0，境界随之变为凡人。  
- 规则来源在系统文档与模组设计文档中统一说明，测试只验证上述行为，不单独维护一套规则。

---

### 🔷 子模块通用模板

```json
{
  "id": "string",
  "name": "string",
  "type": "timeline | trigger_chain | free_trigger",
  "note": "string",
  "tags": ["string"],
  
  "entryConditions": [ConditionWrapper],
  "completionConditions": [ConditionWrapper],

  "summary": {
    "enabled": false,
    "autoSummarize": true,
    "promptList": [
      {
        "condition": [ConditionDef],
        "content": ""
      }
    ]
  },
  
  "info": [
    {
      "content": "string",
      "condition": [ConditionWrapper]
    }
  ],
  
  "deliveryInfo": [
    {
      "title": "string",
      "content": "string",
      "condition": [ConditionWrapper]
    }
  ],
  
  "queueDisplay": {
    "before": 3,
    "after": 5
  },
  
  "linkedList": {
    "prev": "module-id | null",
    "next": "module-id | null"
  },
  
  "variables": [],
  "plugins": [],
  "flows": {
    "main": { "subModules": [] },
    "<flow-name>": { "subModules": [] }
  }
}
```

### 模块字段详细说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 模块唯一标识 |
| `name` | string | 是 | 模块显示名称 |
| `type` | enum | 是 | `timeline` / `trigger_chain` / `free_trigger` |
| `note` | string | 否 | 调试备注，不发送给AI |
| `tags` | array | 否 | 模块标签，用于条件判断 |
| `entryConditions` | object | 否 | 进入条件，参见[ConditionWrapper] |
| `completionConditions` | object | 否 | 完成条件，参见[ConditionWrapper] |
| `info` | array | 否 | 背景信息数组，根据condition发送给AI |
| `deliveryInfo` | array | 否 | 投递信息数组，需AI确认完成。每条 completed 未写时系统默认为 false（模组不写）；AI 用 `<delivery\|title\|done>` 确认后系统置 true，completed=true 的不再发送 |
| `queueDisplay` | object | 否 | 队列显示配置（仅限叶节点/事件模块）。before: 当前事件之前显示的队列数量，after: 之后显示的数量。默认全部发送 |
| `linkedList` | object | 条件 | trigger_chain专用，定义prev/next |
| `variables` | array | 否 | 模块变量数组 |
| `variableSetOnEnter` | object | 否 | **进入本模块时**强制设置的变量键值（如跳回「凡人」时设 `cultivation: 0`，与境界一致）。与合并进入条件一起参与「进入/跳转时变量更新」，再重算内置变量 |
| `plugins` | array | 否 | 模块插件数组 |
| `flows` | object | 否 | 子流程定义（包含subModules） |
| `summary` | object | 否 | 模块总结配置，格式见下文「总结配置格式」 |

### 总结配置格式（Summary Config Schema）

总结配置的**唯一合法格式**见下文，**模块与分流程（含 flow/NPC）均使用同一格式**，无区分。模组设计文档（如 MODULE_STRUCTURE.md）与 `module.json` 中的总结配置**必须**使用此格式；系统按此格式解析与生成总结。详见 [03-summary-system](03-summary-system.md)。

**统一格式（module.summary / flow.summary 相同）**：

```json
{
  "enabled": true,
  "autoSummarize": true,
  "promptList": [
    {
      "condition": [ConditionDef],
      "content": ""
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | 是 | 是否启用总结 |
| `autoSummarize` | boolean | 否 | 是否自动请求 AI 生成总结，默认 true |
| `promptList` | array | 是 | 列表项：`condition`（[ConditionDef]）+ `content`（占位或说明）；满足 condition 时使用该条生成/展示总结 |

**总结条无 condition 时的默认行为**：某条 `promptList` 的 `condition` 为空或省略时，该条在该模块**内的每个子模块完成时各总结一次**（即每个直属子模块完成都会触发一次该条的总结生成/展示）。

不启用总结时系统按「无 summary 或 enabled 为 false」处理。

### 模块类型详解

#### 1. timeline - 时间线触发模块

**约定**：**时间线必须有时间的进入条件**（`time` 或 `time_range`）。若没有时间条件就不是时间线，应标为 `free_trigger`（触发式）或放入 `trigger_chain`（长期可做的放在链内 info）。

**特点**:
- 通过时间条件自动触发
- `entryConditions`**必须**包含 `time` 或 `time_range` 类型条件
- 可设置重复触发（通过 time_range 的周期性配置）

⚠️ **时间线前置条件特殊要求**:
```json
{
  "entryConditions": {
    "type": "precondition",
    "conditionDef": {
      "logic": "AND",
      "groups": [
        {
          "logic": "AND",
          "items": [
            {
              "itemType": "condition",
              "condition": {
                "type": "time",
                "timeType": "absolute",
                "time": { "year": 1, "month": 3, "day": 15 }
              }
            }
          ]
        }
      ]
    }
  }
}
```

**重复触发配置**:

⚠️ **repeat字段**: 配置重复触发的时间间隔，使用已绑定的时间参数

```json
{
  "type": "time_range",
  "timeType": "absolute",
  "start": { "day": 1 },
  "end": { "day": 1 },
  "repeat": {
    "enabled": true,
    "interval": { "month": 1 }
  }
}
```

💡 **repeat配置说明**:
- `enabled`: 是否启用重复
- `interval`: 重复间隔，使用模组绑定的时间单位（如year、month、day等）
- 例如：`{"month": 1}` 表示每1个月重复一次

**示例1: 月考（每月1日触发）**:
```json
{
  "type": "timeline",
  "entryConditions": {
    "type": "display",
    "conditionDef": {
      "logic": "AND",
      "groups": [
        {
          "logic": "AND",
          "items": [
            {
              "itemType": "condition",
              "condition": {
                "type": "time_range",
                "timeType": "absolute",
                "start": { "day": 1 },
                "end": { "day": 1 },
                "repeat": {
                  "enabled": true,
                  "interval": { "month": 1 }
                }
              }
            }
          ]
        }
      ]
    }
  }
}
```

**示例2: 年度大考（每年1月15日触发）**:
```json
{
  "condition": {
    "type": "time_range",
    "timeType": "absolute",
    "start": { "month": 1, "day": 15 },
    "end": { "month": 1, "day": 15 },
    "repeat": {
      "enabled": true,
      "interval": { "year": 1 }
    }
  }
}
```

#### 2. trigger_chain - 触发器链

**约定**：**触发器链必须有前后顺序**（`linkedList.prev`/`next`）。可以没有触发要求（长期可做则放在链内 info）；无顺序的触发式用 `free_trigger`。

**特点**:
- 使用`linkedList`定义模块顺序
- 必须按顺序完成（prev完成后才能进入next）
- prev为null表示链起点，next为null表示链终点

**示例**:
```json
{
  "id": "exam",
  "type": "trigger_chain",
  "linkedList": { "prev": "homework", "next": "result" }
}
```

#### 3. free_trigger - 自由触发

**约定**：触发式、无链顺序的用自由触发器；可有任意进入条件（含 module、variable），**无时间条件时**不能用 timeline。

**特点**:
- 满足entryConditions即可触发
- 无顺序要求
- 适用于可选事件、随机事件

---

## 六、Flow（分流程）结构

### 🔷 Flow定义通用模板

```json
{
  "flows": {
    "main": {
      "entryEvent": "module-id | null",
      "subModules": []
    },
    "<flow-name>": {
      "entryEvent": "module-id | null",
      "subModules": []
    }
  }
}
```

### Flow字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `entryEvent` | string | 否 | **流程前置开关**（模块ID或null） |
| `subModules` | array | 是 | 流程内的所有模块 |

### 流程前置开关（entryEvent）

⚠️ **功能说明**: 流程前置开关是一个简单的内置设定锁，用于控制分流程进入权限。

**工作机制**:
1. 如果 `entryEvent` 设置为某个 `module-id`，则必须**完成**该模块才能进入该分流程的其他模块
2. 如果 `entryEvent` 为 `null`，则该分流程无前置锁，直接可访问

**优势**:
- **简化配置**: 无需在每个流程内模块都写前置条件
- **集中管理**: 统一管理分流程的准入条件
- **内置功能**: 系统自动处理，无需额外逻辑

### 📋 示例：NPC分流程的entryEvent

```json
{
  "flows": {
    "main": {
      "entryEvent": null,
      "subModules": [...]
    },
    "npc_zhang_san": {
      "entryEvent": "first_meet_zhang_san",
      "subModules": [
        {
          "id": "first_meet_zhang_san",
          "name": "初遇张三",
          "type": "free_trigger",
          "entryConditions": {
            "type": "precondition",
            "conditionDef": {
              "logic": "AND",
              "groups": [
                {
                  "logic": "AND",
                  "items": [
                    {
                      "itemType": "condition",
                      "condition": {
                        "type": "variable",
                        "variableId": "day",
                        "operator": ">=",
                        "value": 3
                      }
                    }
                  ]
                }
              ]
            }
          },
          "info": [
            {
              "content": "第一次见到张三"
            }
          ]
        },
        {
          "id": "daily_chat_zhang_san",
          "name": "与张三日常聊天",
          "type": "free_trigger",
          "note": "此模块受entryEvent保护，必须完成first_meet_zhang_san才能触发"
        }
      ]
    }
  }
}
```

💡 **说明**: 
- `npc_zhang_san`分流程设置了`entryEvent`为`first_meet_zhang_san`
- 用户必须先完成"初遇张三"模块，才能触发该分流程中的其他模块（如"日常聊天"）
- 这样避免了在`daily_chat_zhang_san`的`entryConditions`中重复写`first_meet_zhang_san`完成条件

---

## 七、NPC与分流程导入导出

### NPC就是分流程

⚠️ **核心概念**: NPC是一种分流程（flow）。

所有NPC相关功能（客串剧情、条件出现、对话记录等）都是分流程的标准能力：
- **客串剧情**: 能够将符合数据结构要求的NPC导入到模组中
- **条件出现**: 相当于NPC启动的第一个事件（entryEvent），完成这个分流程模块之后才会正式进入NPC的分流程。
- **角色信息**: 使用flow内的`variables`存储
- **总结功能**: 使用分流程总结（见03-summary-system.md）

### NPC启动事件（Entry Event）

💡 **推荐格式**: 使用 `entryEvent` 设置NPC的首次见面模块

```json
{
  "flows": {
    "npc_li_si": {
      "entryEvent": "first_meet_li_si",
      "subModules": [
        {
          "id": "first_meet_li_si",
          "name": "邂逅李四",
          "type": "timeline",
          "entryConditions": {
            "type": "precondition",
            "conditionDef": {
              "logic": "AND",
              "groups": [
                {
                  "logic": "AND",
                  "items": [
                    {
                      "itemType": "condition",
                      "condition": {
                        "type": "time",
                        "timeType": "absolute",
                        "time": { "day": 7 }
                      }
                    }
                  ]
                }
              ]
            }
          },
          "deliveryInfo": [
            {
              "title": "邂逅",
              "content": "在图书馆遇到了李四"
            }
          ]
        }
      ]
    }
  }
}
```

⚠️ **注意**: `first_meet_li_si`既是`entryEvent`（前置锁），又是该分流程的第一个模块。完成后，该NPC分流程的其他模块才会解锁。

### 单个分流程导入导出

💡 **唯一特殊功能**: 支持导出/导入单个分流程JSON，方便NPC迁移和共享。

#### 🔷 导出格式

```json
{
  "flowId": "npc_zhang_san",
  "flowName": "张三",
  "sourceModule": "story-001",
  "exportDate": "2026-02-05",
  "flowData": {
    "subModules": [
      {
        "id": "first_meet",
        "name": "初遇张三",
        "type": "trigger_chain",
        "variables": [
          {
            "id": "relation",
            "name": "好感度",
            "type": "number",
            "initialValue": 50
          }
        ]
      }
    ]
  }
}
```

#### 导入处理逻辑

1. **ID冲突检测**: 检查目标模组是否已有相同flowId
2. **变量合并策略**: 
   - 如有同名变量，提示用户选择保留/覆盖/重命名
   - 确保变量作用域正确
3. **条件依赖检查**: 如导入的flow引用了不存在的moduleId，给出警告
4. **自动添加到flows**: 将导入的flow添加到目标模组的`flows`对象

---

## 七、模组修改与运行时行为

### 7.1 模组修改（增减与编辑）

- **增减模组**：支持在模组列表中增加、移除整个模组（如从 module/list.json 或等价配置增删故事入口）；支持将「整个模组」作为子流程或可加载包加入当前模组。
- **模组编辑**：支持对已加载模组的配置进行编辑（如 entryConditions、info、variables、timeSystem 等），编辑后需重新加载或热更后生效；断言与测试可覆盖编辑后的行为。

### 7.2 时间线推迟（修改日期）

- **语义**：正式游玩时若允许「修改当前日期」，则时间线进入条件会随日期变化；未到时间的时间线可因日期推进而变为可进入（时间线被推迟后满足）。
- **实现要点**：时间系统暴露 `advanceTime` / 设置当前时间后，队列与 `_isTimelineTimeReached` 会按新时间重算；测试与断言生成器需支持 `setup.time`、`timesAtActions` 及 `assertions.time`，以覆盖「改日前/改日后」等用例。

### 7.3 中断未完成（事情被中断）

- **语义**：当前模块可**不完成**而离开，视为「事情被中断」；系统应支持标记为中断并记录总结，便于下次继续时调取。
- **约定**：
  - 模块可保持 `state === 'entered'` 且不调用完成；此时可调用「标记中断」并**要求填写总结**（如 `markModuleInterrupted(moduleId, { summary })`）。
  - 展示层：当模块为已进入且被标记为中断时，应增加一条 **info「中断未完成」**，并附带中断时的总结内容，供续玩时展示。
  - 总结：中断时要求（或由 AI/用户）生成一段总结，存入该模块的中断总结字段，下次进入或展示该模块时可用于「上次做到哪、因何中断」等上下文。
- **运行时字段**（不写进 module.json，仅运行时/存档）：
  - `interrupted`: boolean，该模块是否被标记为中断未完成；
  - `interruptSummary`: string，中断时填写的总结，供续玩调取。

---

**文档版本**: 1.0
**最后更新**: 2026-02-05
