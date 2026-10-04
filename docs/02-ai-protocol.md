# 02 - AI交互协议

本文档定义Bulimia模块系统与AI的完整交互协议，包括统一的回复格式、操作指令、Prompt生成规范等。

**目标**: 提供清晰简洁的AI交互规则，让AI能够准确理解并执行系统指令。

---

## 核心设计原则

⚠️ **统一格式**: 所有AI回复使用 `<type|param1|param2|...>` 的简洁格式

**优势**:
- 简单易学：AI只需记住统一的tag格式
- 降低出错：避免复杂的JSON结构
- 自动解析：系统自动转换为标准JSON

---

## 用户输入格式（剧情 / 场外指令）

前端将用户输入分为两类，合并为一条 user 消息发给 AI：

- **剧情 / 扮演**：用户以角色身份做出的行动、对话等，视为剧情内扮演。
- **场外指令**：对 AI 或剧情走向的要求、说明，不当作角色扮演内容。

合并规则（系统自动拼接，AI 收到一条 user 消息）：

- 仅剧情：只发送剧情文本。
- 仅场外：发送 `【场外指令】\n` + 场外文本。
- 两者都有：`【剧情】\n` + 剧情 + `\n\n【场外指令】\n` + 场外。
- 两者都空：发送 `【场外指令】\n要求自动推进`，用于“空消息自动推进”。

预设与写作指导中可说明：user 消息可能包含 `【剧情】`、`【场外指令】` 两种段落，请区分对待。

---

## 一、变量操作格式

### 格式规范

```
<var|变量ID|操作|参数>
```

### 支持的操作类型

#### 1. 基础操作 (number/string类型)

```
<var|score|add|10>
<var|name|set|张三>
<var|count|subtract|5>
```

**系统自动转换为**:
```json
{
  "varId": "score",
  "operation": "add",
  "params": { "value": 10 }
}
```

#### 2. 列表操作 (list类型)

```
<var|attendance|append|2024-01-15>
<var|tags|remove|已完成>
<var|items|extend|物品A,物品B,物品C>
```

#### 3. 对象操作 (list_of_object类型)

**完整格式示例**（发送给AI）:
```
<var|friends|add_item|name=王五,relation=50,tags=新朋友>
  格式要求: add_item(name=string, relation=number, tags=list)
  
<var|friends|modify_item|index=0,field=relation,op=add,value=10>
  格式要求: modify_item(index=number, field=string, op=add|set, value=any)
  
<var|friends|remove_item|index=2>
  格式要求: remove_item(index=number)
```

**参数格式说明**:
- 使用 `key=value` 格式
- 多个参数用逗号分隔
-tags等list字段直接用逗号分隔值（系统自动转换为数组）

### 使用changeRules快捷操作

💡 **推荐方式**: 使用rule名称调用预定义操作

```
<rule|score|考试通过加分>
<rule|friends|添加新朋友|name=李四>
<rule|friends|增加好感度|index=0>
```

**格式**:
- `<rule|变量ID|规则名称|可选参数>`
- 系统根据changeRules自动执行对应的operation和value
- 如value中有`$param`占位符，AI需提供对应参数

**示例**:

变量定义：
```json
{
  "id": "score",
  "changeRules": [
    {
      "name": "考试通过加分",
      "operation": "add",
      "value": 10
    }
  ]
}
```

AI调用：
```
<rule|score|考试通过加分>
```

系统执行：
```javascript
score.add(10)
```

---

## 二、时间推进操作格式

### 设计原则

⚠️ **核心机制**: 
- AI负责填写所有时间参数内容
- 每次都是推进**确切时间**（精确到参数）
- 只有bound parameter（绑定参数）可以操作

### 格式规范

```
<time|参数ID|操作|数值>
```

### 时间推进规则

💡 **自动计算**: AI根据剧情需要推进合理的时间，系统自动计算所有参数

⚠️ **推进频率建议**:
- **常规对话**: 每次推进通常不超过1小时，如果处于剧情内，则每次推进可能<5分钟的慢速慢镜头推进。
- **主动快进**: 玩家明确要求或剧情需要时可以推进更长时间（几天、几周）
- **重要事件**: 精确时间点（如考试时间、约会时间）

**AI操作示例**:
```
<time|day|add|3>      // 推进3天
<time|hour|set|14>    // 设置为下午2点
<time|month|add|1>    // 推进1个月
```

**系统自动处理**:
1. 根据AI指定的参数进行时间推进
2. 自动计算所有绑定参数（bound parameters）的新值
3. 更新computed parameters（如weekday、season等）
4. 触发相关时间事件

### 绑定参数说明

⚠️ **只能操作绑定参数**: 
- ✅ 可操作: `year`, `month`, `day`, `hour`, `minute` (基础参数)
- ❌ 不可操作: `weekday`, `season`, `period` (计算参数，自动更新)

### 完整示例

**场景: 推进到第二天早晨**

AI操作:
```
第二天早晨，你醒来准备去学校。

<time|day|add|1>
<time|hour|set|7>
<time|minute|set|0>
```

系统计算:
```json
{
  "year": 2024,
  "month": 8,
  "day": 2,        // +1
  "hour": 7,       // set
  "minute": 0,     // set
  "weekday": 2,    // 自动计算：周二
  "season": 2,     // 自动计算：夏季
  "period": 0      // 自动计算：早晨
}
```

**场景: 推进3个月**

AI操作:
```
时光飞逝，转眼到了期末考试季节。

<time|month|add|3>
<time|day|set|15>
```

系统计算:
```json
{
  "year": 2024,
  "month": 11,     // +3
  "day": 15,       // set
  "weekday": 5,    // 自动计算：周五
  "season": 3,     // 自动计算：秋季
  "period": null   // 保持当前period
}
```

### Prompt中的时间信息

系统会在每次Prompt中显示：
1. **当前时间** (displayFormat格式)
2. **时间推进提示** (如果有变化)
3. **可操作的时间参数列表**

````markdown
```time_info
当前时间：2024年8月1日 周一 午时
[上次对话后推进了: +3天]

可操作时间参数:
- <time|day|add|数值>: 推进天数
- <time|month|add|数值>: 推进月数
- <time|hour|set|数值>: 设置小时(0-23)
```
````

### 最佳实践

💡 **推荐方式**:
1. **合理的时间跨度**: 根据剧情需要推进时间，避免过快或过慢
2. **精确时间点**: 重要事件设置精确时间 (`<time|hour|set|14>`)
3. **自然过渡**: 在叙事中说明时间推进 ("第二天早晨"、"一周后")

⚠️ **注意事项**:
- 不要试图操作computed parameters（系统会自动拒绝）
- 推进的时间要符合剧情逻辑
- 重要时间点要使用`set`而非`add`

---

## 三、模块操作格式

### 格式规范

```
<module|操作|模块ID>
```

### 支持的操作

```
<module|enter|exam>        // 进入模块
<module|complete|homework>  // 完成模块
```

**系统自动转换为**:
```json
{
  "action": "enter",
  "moduleId": "exam"
}
```

---

## 三、投递信息确认格式

### 格式规范

```
<delivery|投递信息标题|done>        // 确认完成
<delivery|投递信息标题|uncompleted>  // 标记未完成（下次仍发送）
```

⚠️ **投递信息逻辑**:
- **done之前**: 每次Prompt生成时都发送该deliveryInfo
- **done后**: 不再发送，模块可以完成
- **uncompleted**: AI认为未完成，下次仍继续发送

### 示例

**场景1: 确认完成**
```
<delivery|重要通知|done>
<delivery|期末考试安排|done>
```

**场景2: 标记未完成**
```
<delivery|作业提交|uncompleted>  // AI判断作业未完成，下次继续提示
```

**系统自动转换为**:
```json
{
  "title": "重要通知",
  "completed": true  // 或 false
}
```

---

## 四、时间线中断决策格式

### 格式规范

```
<interrupt|决策>
```

### 支持的决策

```
<interrupt|continue>   // 继续当前timeline
<interrupt|accept>     // 接受中断，进入新timeline
<interrupt|postpone>   // 推迟当前timeline（时间未到仍可触发）
<interrupt|skip>       // 跳过当前timeline（彻底错过，不再触发）
```

⚠️ **skip vs postpone**:
- `skip`: 剧情推进中剧情主动跳过（前置条件已经满足，但比如用户迟到无法参加具体事件，有其他事情冲突等等实际原因），那么相当于立即完成
- `postpone`: 时间到了但条件未满足，或因当前剧情情况需要因此推迟
- 系统默认：时间到但条件未满足 = 自动skip（通常不告诉AI）

**示例**:
```
// 场景1: 不知道比赛 → skip（不告诉AI）
// 场景2: 迟到错过 → skip（告诉AI事件，ai自己判断选择什么）
// 场景3: 条件未满足 → postpone（让ai选择推迟后的条件，改变原模块）
```

### postpone操作格式

当AI选择`postpone`时，需提供新的触发条件：

```
<interrupt|postpone|newCondition=time:day+3>             // 推迟3天
<interrupt|postpone|newCondition=variable:score>=80>    // 改为满足分数条件
<interrupt|postpone|newCondition=module:homework:completed>  // 改为完成作业后
```

**系统自动转换为**:
```json
{
  "action": "postpone",
  "newCondition": {
    "type": "time",
    "offset": { "day": 3 }
  }
}
```

系统会自动修改原模块的`entryConditions`。

**系统自动转换为**:
```json
{
  "action": "continue"  // 或 "interrupt"
}
```

---

## 五、插件回复格式

### 格式规范

```
<plugin|插件ID|参数列表>
```

### 示例

```
<plugin|chat_friend|response=很高兴见到你！,relationChange=5>
<plugin|battle_system|damage=50,critical=true>
```

**系统自动转换为**:
```json
{
  "pluginId": "chat_friend",
  "data": {
    "response": "很高兴见到你！",
    "relationChange": 5
  }
}
```

---

## 六、总结生成格式

### 格式规范

```
<summary|类型|内容>
```

### 支持的类型

```
<summary|global|本次对话的主要内容总结>
<summary|module|当前模块的关键进展>
<summary|module|父模块ID|总结内容>   （为父模块总结时，如子模块完成时总结）
<summary|plugin|插件相关的重要事件>
```

**系统自动转换为**:
```json
{
  "type": "global",
  "content": "本次对话的主要内容总结"
}
```

---

## 七、Prompt生成规范（7段式）

系统自动生成的Prompt按以下7个段落组织，按顺序发送给AI。

⚠️ **重要**: 所有段落内容都用block套起来，防止找不到具体内容。

### 段落1: 背景信息（Background）

**内容**:
- 当前时间（displayFormat格式）
- **时间变化提示**（如果自上次对话后时间推进）
- 当前模块的info内容（根据condition筛选）
- 父级模块的背景信息（根据作用域规则）

**示例**:
````markdown
```background
当前时间：2024年8月1日 周一 午时
[时间已推进: +3天]

【学期开始】
新学期开始了，你是一名高中生。

【数学课程】
这学期的数学课程难度较高，需要认真学习。
```
````

### 段落2: 交互器信息（Interactors）

**内容**:
- 当前激活的所有interactive插件prompt
- 插件的blockId和回复格式要求
- 按插件priority排序

**示例**:
````markdown
```interactors
【好友聊天】(blockId: chat_zhang_san)
你正在与张三聊天。当前好感度: 60。请以朋友的身份回复。

回复格式: <plugin|chat_zhang_san|response=你的回复,relationChange=数值>
```
````

### 段落3: 变量当前状态（Variables）

**内容**:
- 变量性质（类型、当前值、类别）
- generalRules（整体指导）
- **具体操作规则**（supportedOperations的完整格式要求）
- changeRules（可快速调用的规则名称）

**示例**:
````markdown
```variables
【变量】
分数 (number, module类别)
  当前值: 75
  规则说明: 分数用于记录学生的学业表现，范围0-100
  支持操作:
    - add(value=number): 增加分数
    - subtract(value=number): 减少分数
    - set(value=number): 设置分数
  快捷规则:
    - <rule|score|考试通过加分>
    - <rule|score|考试不通过扣分>
    - <rule|score|重大成就奖励>

好友列表 (list_of_object, module类别)
  当前值: [张三(好感度60), 李四(好感度45)]
  规则说明: 好友列表记录所有认识的人以及关系状态
  支持操作:
    - add_item(name=string, relation=number, tags=list): 添加好友
    - modify_item(index=number, field=string, op=add|set, value=any): 修改好友字段
    - remove_item(index=number): 移除好友
  快捷规则:
    - <rule|friends|添加新朋友|name=姓名>
    - <rule|friends|增加好感度|index=索引>
    - <rule|friends|降低好感度|index=索引>
```
````

### 段落4: 模块队列与可用操作（Module Queue）

队列是当前所处事件模块中用于判断位置、并让 AI 知晓进度的输出方式；队列中只包含**事件**（leaf 节点）。调试页面与 Prompt 中会用到以下五种队列：

| 序号 | 队列名称 | 说明 |
|------|----------|------|
| 1 | **当前队列** | 只要当前事件完成、所有前置条件都已满足即可进入的事件队列。 |
| 2 | **预期队列** | 当前事件完成后，仅剩变量类条件未完成的事件队列（会标注未满足的变量条目）。 |
| 3 | **可能队列** | 变量类条件已满足，但即使当前事件完成，仍需要其他事件完成作为前置条件的事件队列。 |
| 4 | **分流程队列** | 当前可触发的分流程队列（即各分流程模块的当前队列）。 |
| 5 | **已完成模块** | 当前已经完成的模块列表。 |

**Floating 状态**：当完成一个事件后当前队列为空，则进入 Floating 模式——当前显示为父级模块名，表示处于该模块内但不属于任何子事件，直到有任意条件达成才可能再进入事件。

**段落内容**:
- **当前队列**（已触发且满足进入条件的模块）
- **预期队列**（即将触发但未满足条件，标注缺少的条件）
- 仅发送已触发的模块，避免 AI 提前进入未触发模块

⚠️ **重要**: 只有满足进入/完成条件的模块才会显示操作提示

**示例**:
````markdown
```queue
【当前队列】（可立即操作）
- 作业提交 (free_trigger)
  可完成: <module|complete|homework> (需确认deliveryInfo: "作业已完成")
  
- 课外活动 (free_trigger)
  可进入: <module|enter|activity>

【预期队列】（条件未满足）
- 期中考试 (timeline, 1月15日)
  缺少条件: 时间未到
  
- 图书馆学习 (free_trigger)
  缺少条件: 好感度 >= 50 (当前: 45)
```
````

💡 **未触发的模块**: 不显示给AI，避免提前操作

### 段落5: 投递信息待办（Delivery Info）

**内容**:
- **未完成的deliveryInfo**（done之前每次都发送）
- 当前模块和父级模块的deliveryInfo
- **确认格式说明**

⚠️ **发送逻辑**:
- done之前：每次Prompt都发送
- done后：不再发送
- uncompleted：下次继续发送

**示例**:
````markdown
```delivery
【待确认投递信息】
1. 重要通知
   内容: 下周一进行期中考试
   确认格式: <delivery|重要通知|done>
   
2. 作业安排
   内容: 完成数学练习题第1-10题
   确认格式: <delivery|作业安排|done>
```
````

### 段落6: 预期进展提示（Expected Progress）

**内容**:
- 系统根据当前状态生成的行为建议
- 提示AI可以使用的操作类型

**示例**:
```
【操作提示】
你可以：
1. 调用变量规则: <rule|变量ID|规则名称|参数>
2. 进入新模块: <module|enter|模块ID>
3. 完成当前模块: <module|complete|模块ID>
4. 确认投递信息: <delivery|标题|done>
5. 回复插件: <plugin|插件ID|参数>
6. 创建伏笔/待办: <foreshadow|标题|描述|触发条件>
```

### AI创建伏笔与投递信息

💡 **核心机制**: AI可以通过创建投递信息来埋下伏笔或记录未完成事项

**使用场景**:
- **伏笔**: 对话中提到未来会发生的事情
- **待办**: 玩家表达想做但还没做的事
- **提醒**: 需要在特定条件下提醒玩家的信息

**AI操作格式**:
```
<foreshadow|标题|描述|触发条件>
```

**示例**:
```
// 场景1: NPC提到下月有重要事情
<foreshadow|与神秘人物的约定|张三提到下月1日会介绍一个重要的人给你认识|time:day>=30>

// 场景2: 玩家说想参加比赛但条件不足
<foreshadow|数学竞赛报名|需要分数达到80分才能报名参加数学竞赛|variable:score>=80>

// 场景3: 错过的剧情提醒
<foreshadow|图书馆闭馆|图书馆每周日闭馆，记得其他时间去|time:weekday!=0>
```

**系统自动转换为**:
```json
{
  "type": "conditional_delivery",
  "title": "与神秘人物的约定",
  "content": "张三提到下月1日会介绍一个重要的人给你认识",
  "condition": [
    {
      "type": "time",
      "check": "day >= 30"
    }
  ],
  "autoComplete": false
}
```

**触发后行为**:
- 条件满足后，作为deliveryInfo发送给AI
- AI可选择确认(<delivery|标题|done>)或标记未完成
- 确认后不再重复发送



### 段落7: 进程信息（Process Info）

**内容**:
- **操作总结**: 最近N次操作记录（配置化，如最近5次）
- **模块总结**: 相关模块的总结（根据作用域规则）
- **全局总结**: 压缩后的历史总结

**示例**:
```
【最近操作】
1. <rule|score|考试通过加分>
2. <module|complete|homework>
3. <delivery|重要通知|done>
4. <rule|friends|增加好感度|index=0>
5. <module|enter|exam>

【模块总结】
[数学课程] 已完成3次作业，分数从60提升到75

【全局总结】
学期开始后，主要专注于学业。与张三的关系逐渐改善。
```

---

## 八、Prompt注入深度与顺序

### 注入规则

⚠️ **深度控制**: 每个段落的内容注入有深度限制

**段落1 (背景信息)**:
- 当前模块 info: 全部发送
- 父级模块 info: 仅发送标记为"persistent"的info
- 最多回溯3层父级模块

**段落3 (变量状态)**:
- 仅发送当前作用域内的变量
- generalRules: 全部发送
- changeRules: 仅发送规则名称列表（不发送具体value）

**段落7 (进程信息)**:
- 操作总结: 配置参数控制（如最近5次）
- 模块总结: 同父级模块间互相发送，跨父级只发送父级总结
- 全局总结: 根据压缩配置发送

### 与写作指导结合

💡 **写作指导**: 使用者在调试页自己添加或导入的条目，在段落6之后、段落7之前注入；没有条目时不发送这一段。回复格式与摘要格式两段说明始终随提示词发送，解析器依赖它们。

**注入顺序** (完整):
1. 背景信息
2. 交互器信息
3. 变量当前状态
4. 可用模块操作
5. 投递信息待办
6. 预期进展提示
7. **写作指导**（使用者自己添加的条目）
8. 进程信息

---

## 九、AI回复完整示例

### 场景：学生完成考试

**AI回复**:
```
考试结束了！你发挥得不错。

<rule|score|考试通过加分>
<delivery|期中考试|done>
<summary|module|完成了期中考试，分数有所提升>
<module|complete|midterm_exam>
```

**系统解析结果**:
1. 变量操作: `score.add(10)`
2. 投递信息确认: "期中考试" 标记为已完成
3. 生成模块总结
4. 模块操作: 完成"midterm_exam"模块

### 场景：与NPC互动（插件）

**AI回复**:
```
张三微笑着对你说："很高兴见到你！最近学习怎么样？"

<plugin|chat_zhang_san|response=很高兴见到你！最近学习怎么样？,relationChange=5>
<rule|friends|增加好感度|index=0>
```

**系统解析结果**:
1. 插件回复: 记录对话内容，好感度+5
2. 变量操作: friends列表中index=0的好感度+10

---

## 十、通用规则总结

⚠️ **AI必须遵守**:

1. **统一格式**: 所有指令使用 `<type|param1|param2|...>` 格式
2. **参数分隔**: 使用竖线`|`分隔主要参数，逗号`,`分隔子参数
3. **优先使用rule**: 能用changeRules的场景优先用`<rule|...>`
4. **一次多个指令**: 可以在同一回复中输出多个tag
5. **自然语言 + 指令**: 可以混合叙事文本和指令tag

💡 **最佳实践**:
- 叙事在前，指令在后
- 每个指令单独一行（便于解析）
- 使用语义化的rule名称（而非直接操作）

---

**文档版本**: 1.0
**最后更新**: 2026-02-05
