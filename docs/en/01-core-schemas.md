English | [中文](../01-core-schemas.md)

# 01 - Core Data Structure Definitions

This document defines the complete data structure schemas of the Bulimia module system, including the time system, condition system, variable system, plugin system and file structure.

**Conventions**:
- 🔷 **Generic template**: a structure definition that can be reused directly
- 📋 **Concrete example**: a real case for demonstration, explicitly labeled "example"
- ⚠️ **Important rule**: a constraint that must be followed

---

## Core Design Principles

**[Central principle]**: The system design is generic to all modules; module implementation is defined entirely by the module. The system must not contain any concrete module content.

**[Coupling principle]**: Coupling between the system and modules is kept minimal, so modules can be developed fully independently.

**[Extensibility principle]**: Fully consider future extension needs and avoid locking the design too early.

**[Readability principle]**: Keep the design clear and easy to understand, to guide users in creating modules.

---

## Folder Structure

### 🔷 Module folder structure (generic template)

```
bulimia/
├── module/
│   ├── list.json                    # Module list index
│   ├── <story-id>/                  # A single module folder
│   │   ├── module.json              # Main module config
│   │   ├── plugins/                 # Plugin directory
│   │   │   ├── <plugin-id>/
│   │   │   │   ├── config.json      # Plugin meta config
│   │   │   │   ├── logic.js         # Plugin logic (optional)
│   │   │   │   ├── display.html     # Frontend (optional)
│   │   │   │   ├── display.css      # Styles (optional)
│   │   │   │   └── pool.json        # Random pool (optional)
│   │   └── README.md
```

### Import and export

**Export**:
- Pack the whole `<story-id>/` into a `.zip`
- File name: `<story-id>_v<version>.zip`

**Import**:
- Unzip into the `module/` directory
- Automatically update `list.json`
- Validate the `module.json` structure

**Import/export of a single sub-flow (NPC)**:
- An NPC is just an ordinary sub-flow with no special structure
- Exporting the JSON of a single flow is supported, for easy migration
- On import, ID conflict detection and variable merging are performed

---

## Common Terminology

### 🔷 [ConditionDef] - Condition definition object

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

### 🔷 [ConditionWrapper] - Condition wrapper object

```json
{
  "type": "precondition | display",
  "conditionDef": [ConditionDef]
}
```

### 🔷 [TimePoint] - Time point object

```json
{
  "year": 1,
  "month": 3,
  "day": 15,
  "hour": 0,
  "minute": 0
}
```

### 🔷 [RelativeTimePoint] - Relative time point object

```json
{
  "moduleId": "xxx",
  "state": "entered | completed",
  "offset": { "month": 1, "day": 5 }
}
```

---

## 1. Time System

### Core mechanism

⚠️ **System time**: The game has six built-in base parameters: `year, month, day, hour, minute, prefix`

**Module time parameters**:
- `base type`: bound directly to a system parameter
- `computed type`: computed through a division formula (e.g. `day/12` automatically computes the double-hour)
- `default behavior`: when `parameters` is empty, all system time parameters are used automatically

### 🔷 Time system root structure

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
    "displayFormat": "Year {{year}}, Month {{month}}, Day {{day}}, Week {{week}}"
  }
}
```

⚠️ **Important**: `initialValues` must contain **all** ids defined in parameters (both base and computed types)
- When labels exist, the initial value is the index into the list, not the concrete value

### Parameter field details

#### Common fields

| Field | Type | Required | Description |
|------|------|------|------|
| `id` | string | Yes | Parameter identifier, referenced by displayFormat |
| `type` | enum | Yes | `base` or `computed` |
| `calculationOnly` | boolean | No | Whether it is computed only and cannot be advanced manually |

#### base type only

| Field | Type | Required | Description |
|------|------|------|------|
| `systemBinding` | enum | Yes | Every system parameter in use must be bound |

⚠️ **Important**: Every system time parameter in use must be bound in parameters

#### computed type only

| Field | Type | Required | Description |
|------|------|------|------|
| `formula` | string | Yes | Format: `systemParam/divisor` (e.g. `day/12`) |
| `labels` | array | Yes | Label array; the system assigns labels automatically from the division result |

### 📋 Example 1: Gregorian calendar + double-hour + weekday

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
      "labels": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    },
    {
      "id": "shichen",
      "type": "computed",
      "formula": "day/12",
      "labels": ["Zi", "Chou", "Yin", "Mao", "Chen", "Si", "Wu", "Wei", "Shen", "You", "Xu", "Hai"]
    }
  ],
  "initialValues": { "year": 1, "month": 8, "day": 1, "week": 0, "shichen": 0 },
  "displayFormat": "Year {{year}}, Month {{month}}, Day {{day}} {{week}} {{shichen}} hour"
}
```

### 📋 Example 2: Cultivation calendar

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
      "labels": ["Zi", "Chou", "Yin", "Mao", "Chen", "Si", "Wu", "Wei", "Shen", "You", "Xu", "Hai"]
    }
  ],
  "initialValues": { "prefix": "Heavenly Origin ", "year": 5234, "month": 3, "day": 15, "shichen": 0 },
  "displayFormat": "{{prefix}}Year {{year}}, Month {{month}}, Day {{day}}, {{shichen}} double-hour"
}
```

---

## 2. Condition System

### Core mechanism

⚠️ **Nested structure**: `groups` and `items` are used to build multi-level AND/OR combinations

**Two modes**:
- `precondition`: a one-time check; time_range is not supported
- `display`: a continuous check; time must use time_range

### 🔷 Generic condition definition template

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

### Condition type details

#### 1. none - no condition

```json
{ "type": "none" }
```

#### 2. variable - variable check

```json
{
  "type": "variable",
  "variableId": "xxx",
  "operator": ">= | <= | == | != | in",
  "value": "any"
}
```

#### 3. variable_compare - comparison between variables

```json
{
  "type": "variable_compare",
  "variableId": "score",
  "operator": ">= | <= | == | !=",
  "compareVariableId": "passScore"
}
```

#### 4. module - module state

```json
{
  "type": "module",
  "moduleId": "xxx",
  "state": "entered | completed"
}
```

#### 5. time - time point check (precondition only)

**Absolute time**:
```json
{
  "type": "time",
  "timeType": "absolute",
  "time": { "year": 1, "month": 3, "day": 15 }
}
```

**Relative time**:
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

⚠️ **Note**: The condition is met when the current time has reached or passed the specified time point

#### 6. time_range - time range (display only)

```json
{
  "type": "time_range",
  "timeType": "absolute | relative",
  "start": [TimePoint] | [RelativeTimePoint],
  "end": [TimePoint] | [RelativeTimePoint]
}
```

#### 7. tag - tag check

```json
{
  "type": "tag",
  "matchType": "any | all",
  "tags": ["tag1", "tag2"]
}
```

### 📋 Full nested example

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
                  "moduleId": "makeup_exam",
                  "state": "completed"
                }
              },
              {
                "itemType": "condition",
                "condition": {
                  "type": "variable",
                  "variableId": "makeup_score",
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

## 3. Variable System

### Core mechanism

⚠️ **Scope rule**: A variable is visible only in the module that defines it and all of its child modules

**Categories and AI visibility**:
- `module`: sent to the AI by default, modifiable
- `switch`: sent when conditions are met, modifiable
- `builtin`: not sent to the AI (computed automatically)
- `temp`: not sent to the AI (plugin scratch storage)

### 🔷 Generic variable definition template

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
      "name": "Rule name",
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

### Field descriptions

| Field | Type | Required | Description |
|------|------|------|------|
| `id` | string | Yes | Variable ID |
| `name` | string | Yes | Display name |
| `type` | enum | Yes | Data type |
| `category` | enum | Yes | Variable category |
| `initialValue` | any | Yes | Initial value |
| `readonly` | boolean | No | AI read-only mode |
| `generalRules` | string | No | **General rules** (a rules description sent automatically whenever the variable is sent) |
| `changeRules` | array | No | **Operation rule list** (name + operation + value) |
| `supportedOperations` | array | No | List of supported operations |
| `switchConditions` | array | No | Switch variable conditions |
| `computeConditions` | array | No | Builtin variable computation formulas |
| `listItemType` | string | Conditional | Required for the list type |
| `objectSchema` | array | Conditional | Required for object/list_of_object |

⚠️ **generalRules vs changeRules**:
- `generalRules` (string): a general rules description, attached automatically when the variable is sent to the AI, telling the AI how the variable is generally used
- `changeRules` (list): an operation rule list; the AI calls a rule by name to quickly perform a predefined operation
- The two are **completely different parameters**, each with its own role

⚠️ **changeRules format**:
- Each rule contains: `name` (rule name) + `operation` (operation type) + `value` (operation value)
- When the AI calls a rule name, the system automatically runs the corresponding operation(value)
- For example: when the AI says "exam passed bonus", the system automatically runs `add(10)`

### 📋 Example 1: number variable

```json
{
  "id": "score",
  "name": "Score",
  "type": "number",
  "category": "module",
  "initialValue": 0,
  "generalRules": "Score records the student's academic performance, range 0-100",
  "changeRules": [
    {
      "name": "Exam passed bonus",
      "operation": "add",
      "value": 10
    },
    {
      "name": "Exam failed penalty",
      "operation": "subtract",
      "value": 5
    },
    {
      "name": "Major achievement reward",
      "operation": "add",
      "value": 20
    }
  ],
  "supportedOperations": [
    {
      "operation": "add",
      "description": "Increase score",
      "params": { "value": "number" }
    },
    {
      "operation": "subtract",
      "description": "Decrease score",
      "params": { "value": "number" }
    },
    {
      "operation": "set",
      "description": "Set score",
      "params": { "value": "number" }
    }
  ]
}
```

💡 **Usage example**:
- **AI call**: when the AI judges "exam passed", it outputs `<rule|score|Exam passed bonus>`
- **System execution**: the system automatically runs `score.add(10)`
- **Effect**: score +10
- **Benefit**: the AI does not need to remember concrete numbers, only to call a semantic rule name

### 📋 Example 2: list_of_object variable (nested schema)

```json
{
  "id": "friends",
  "name": "Friend List",
  "type": "list_of_object",
  "category": "module",
  "initialValue": [],
  "generalRules": "The friend list records everyone the player knows and their relationship status",
  "changeRules": [
    {
      "name": "Add new friend",
      "operation": "add_item",
      "value": { "name": "$name", "relation": 50, "tags": [] }
    },
    {
      "name": "Increase affection",
      "operation": "modify_item",
      "value": { "index": "$index", "field": "relation", "op": "add", "value": 10 }
    },
    {
      "name": "Decrease affection",
      "operation": "modify_item",
      "value": { "index": "$index", "field": "relation", "op": "subtract", "value": 10 }
    }
  ],
  "objectSchema": [
    {
      "id": "name",
      "name": "Name",
      "type": "string"
    },
    {
      "id": "relation",
      "name": "Affection",
      "type": "number"
    },
    {
      "id": "tags",
      "name": "Tags",
      "type": "list",
      "listItemType": "string"
    }
  ],
  "supportedOperations": [
    {
      "operation": "add_item",
      "description": "Add a friend",
      "params": { "name": "string", "relation": "number", "tags": "list" }
    },
    {
      "operation": "modify_item",
      "description": "Modify a friend field",
      "params": { "index": "number", "field": "string", "op": "add|set", "value": "any" }
    },
    {
      "operation": "remove_item",
      "description": "Remove a friend",
      "params": { "index": "number" }
    }
  ]
}
```

💡 **Operation rule support**:
- The AI calls a rule name (such as "Add new friend"), and the system runs the predefined operation and value
- `$param` in value marks a parameter the AI must provide (e.g. `$name` means the AI supplies the name)
- For example: the AI outputs `<rule|friends|Add new friend|name=Wang Wu>`, and the system runs `friends.add_item({name:"Wang Wu", relation:50, tags:[]})`

---

## 4. Plugin System

### 🔷 Generic plugin definition template

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
  
  "config": { /* type-specific config */ },
  
  "tempVariables": [
    { "id": "xxx", "name": "xxx", "type": "string" }
  ]
}
```

### Six plugin types (characteristics and frontend requirements)

| Type | User input | Sent to AI | AI returns | Frontend requirement | Description |
|------|----------|---------|---------|----------|------|
| **randomizer** | No | No | No | **None** | Only gets called and does nothing else; results are stored into variables by variable_reader etc. |
| **variable_reader** | No | No | No | **None** | Only stores variables: reads from a randomizer/builtin and writes into module variables; a variable handler is enough, no frontend needed. |
| **module_generator** | No | No | No | **None** | Generates modules, and variables are stored along; runs once when the module is entered. |
| **display** | Optional (local/save) | **Not sent to AI** | No | **Required** when user input is needed | For presentation; the user may type input to save locally or just play with it; not sent to the AI. |
| **interactive** | **Yes** | Yes | **Yes** | **Required** | Needs both user input and AI output; without a frontend it cannot receive user input. |
| **display_interactive** | No (or ignored) | Yes | **Yes** | Should have one when AI output needs to be shown | Sent to the AI, with no user input or ignored input; the AI returns content, so a frontend is needed to display it. |

#### 1. randomizer

Only called by the system/other plugins and never does anything on its own; output can be written to scratch storage and converted into variables by variable_reader. **No frontend**.

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

#### 2. variable_reader

Reads from a randomizer or builtin source → writes into module/switch variables according to a mapping. **No frontend**; storing variables is enough.

```json
{
  "type": "variable_reader",
  "config": {
    "inputSource": "randomizer-id",
    "targetVariables": [
      {
        "variableId": "xxx",
        "mapping": "mapping rule for extracting from the input"
      }
    ]
  }
}
```

#### 3. module_generator

Reads variables/randomizer results → generates sub-flow modules and registers them; variables are stored along. **No frontend**. Runs once when the module is entered.

```json
{
  "type": "module_generator",
  "config": {
    "inputSource": "randomizer-id | builtin",
    "outputFlow": "sub-flow name",
    "moduleTemplate": { /* module template */ }
  }
}
```

#### 4. display

Not sent to the AI. Reads current module variables and shows them to the user; the user can type input, save locally or play on their own (not sent to the AI). **A frontend is required when user input is needed**, otherwise input is impossible.

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

#### 5. interactive

**Needs both user input and AI output**: user input → organized into a prompt for the AI → AI replies → organized and displayed. **A frontend is required**, otherwise user input cannot be received; scratch storage alone cannot replace real interaction.

```json
{
  "type": "interactive",
  "config": {
    "promptTemplate": "AI interaction prompt template",
    "outputFormat": "AI reply format requirements",
    "blockId": "<plugin-id>",
    "userInteraction": "user input description"
  }
}
```

#### 6. display_interactive

Sent to the AI, **with no user input or with ignored user input**; the AI returns content and the plugin converts the reply into a displayable format. A frontend is needed to show the AI's returned content.

```json
{
  "type": "display_interactive",
  "config": {
    "fixedWidth": 300,
    "minHeight": 200,
    "requiredVariables": ["xxx"],
    "updatePrompt": "AI live-update prompt"
  }
}
```

### Plugin container specification

⚠️ **Uniform size**:
- Fixed width: 300px (same as the status bar)
- Variable height: minimum height + automatic expansion with content
- Proportional scaling is supported

**Provided by the system**:
- Outer frame (title bar, border)
- Dragging
- Floating window
- Minimize to the bar

---

## 5. Module Structure

### Module design guidance (design first, then write module.json)

In the design phase, it is recommended to decide the following for each module before turning it into JSON:

- **Entry conditions entryConditions**
  - Control **when the module may be entered** (use `type: precondition` for a one-time check, `type: display` for continuous visibility).
  - **System default (added automatically at implementation, no need to write it in module.json)**: for the trigger chain type, the system automatically adds "the module at linkedList.prev has state=completed"; a module writes only **additional** conditions (omit or none if there are none). The chain head (prev is null) has no such default.
  - Commonly used: `module`, `time`, `variable`; multiple conditions are combined through ConditionDef's logic + groups.
  - **[Entry condition merge rule]** (used uniformly by system evaluation and jumps): the entry conditions that actually take part in evaluation = the **current module's** entryConditions + the entryConditions of **all ancestors** (up the tree to the root) + the entryConditions of the **sequentially previous** module (trigger chains only: the module at linkedList.prev); when the same variable appears in several conditions, the **current module has the highest priority** (the current module wins).

- **Completion conditions completionConditions**
  - Control **when the module counts as completed** (used for chain advancement, entryEvent unlocking, etc.).
  - **System default (added automatically at implementation, no need to write it in module.json)**: every module is by default marked completed only after "the AI judges the event narratively complete"; a module writes only **additional** conditions (such as a variable reaching a threshold); if none are written, only the AI's judgment ends it.

- **info**
  - **Background information sent to the AI** after entering the module; there can be several entries, and each can carry a `condition` controlling when it is sent.
  - Used to describe the current situation, available actions, rule hints, etc.

- **deliveryInfo**
  - **One-time delivery**: carries title + content; the AI must confirm with `<delivery|title|done>`, after which the system sets the item's `completed` to true and it is no longer sent.
  - **System default**: when `completed` is not written on an entry, it defaults to false; modules do not write `completed: false`.
  - Suited to "task description", "guidance", "to-do" style content.

- **queueDisplay** (leaf nodes only)
  - Only the **n entries before / m entries after** the current event are shown in the queue, to avoid overly long context.

- **linkedList** (trigger_chain only)
  - `prev` / `next` give the predecessor/successor module ids on the chain; the chain head has prev null and the chain tail has next null.

- **tags**
  - A string array used by the `tag` condition type (such as "in combat", "in seclusion").

When writing a module: fill entryConditions/completionConditions according to [ConditionWrapper] and [ConditionDef]; fill info/deliveryInfo according to the fields in the table above; a timeline must contain a time/time_range condition; a trigger chain must contain linkedList.

---

### Jumps and jump value requirements (system behavior)

- **Jump**: when a specified leaf module is entered, the system completes the predecessors on the chain, enters the target and its parent chain, cancels other entered modules within the same flow, and so on (see the implementation).
- **Variable update on jump/enter**: when `updateVariables` is true (the default) on a jump or module entry, the system: (1) following the **entry condition merge rule**, collects the **variable-type entry conditions** of the target module, its parent chain and the previous module on the chain, with the current module taking priority for the same variable; for `>=` / `<=` / `=` it sets the variable so the condition is satisfied (e.g. `>= 10` means at least 10, `<= 9` means at most 9, `= 0` sets it to 0); (2) if the module has **variableSetOnEnter** configured, it then forcibly sets those variables; (3) finally it calls `updateBuiltinVariables()`. This way, when "Foundation Establishment jumps back to Mortal", the Mortal module's variableSetOnEnter can set cultivation to 0 and the realm then becomes Mortal.
- The source of the rules is explained uniformly in the system documents and module design documents; tests only verify the behavior above and do not maintain a separate set of rules.

---

### 🔷 Generic sub-module template

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

### Module field details

| Field | Type | Required | Description |
|------|------|------|------|
| `id` | string | Yes | Unique module identifier |
| `name` | string | Yes | Module display name |
| `type` | enum | Yes | `timeline` / `trigger_chain` / `free_trigger` |
| `note` | string | No | Debug note, not sent to the AI |
| `tags` | array | No | Module tags, used in condition checks |
| `entryConditions` | object | No | Entry conditions, see [ConditionWrapper] |
| `completionConditions` | object | No | Completion conditions, see [ConditionWrapper] |
| `info` | array | No | Background info array, sent to the AI according to condition |
| `deliveryInfo` | array | No | Delivery info array, requiring AI confirmation. When completed is not written on an entry, the system defaults it to false (modules do not write it); after the AI confirms with `<delivery\|title\|done>` the system sets it to true, and entries with completed=true are no longer sent |
| `queueDisplay` | object | No | Queue display config (leaf nodes / event modules only). before: number of queue entries shown before the current event; after: number shown after. Everything is sent by default |
| `linkedList` | object | Conditional | trigger_chain only; defines prev/next |
| `variables` | array | No | Module variable array |
| `variableSetOnEnter` | object | No | Variable key/values **forcibly set when entering this module** (e.g. setting `cultivation: 0` when jumping back to "Mortal", consistent with the realm). Takes part in "variable update on enter/jump" together with the merged entry conditions, after which builtin variables are recomputed |
| `plugins` | array | No | Module plugin array |
| `flows` | object | No | Sub-flow definitions (containing subModules) |
| `summary` | object | No | Module summary config; format see "Summary config format" below |

### Summary Config Schema

The **only valid format** of the summary config is given below. **Modules and sub-flows (including flow/NPC) all use the same format**, with no distinction. The summary config in module design documents (such as MODULE_STRUCTURE.md) and in `module.json` **must** use this format; the system parses and generates summaries according to it. See [03-summary-system](03-summary-system.md) for details.

**Unified format (module.summary / flow.summary are identical)**:

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

| Field | Type | Required | Description |
|------|------|------|------|
| `enabled` | boolean | Yes | Whether summaries are enabled |
| `autoSummarize` | boolean | No | Whether to automatically ask the AI to generate summaries; default true |
| `promptList` | array | Yes | List items: `condition` ([ConditionDef]) + `content` (placeholder or description); when the condition is met, that entry is used to generate/show the summary |

**Default behavior when a summary entry has no condition**: when a `promptList` entry's `condition` is empty or omitted, that entry summarizes **once each time a child module within the module is completed** (i.e. completion of every direct child module triggers one generation/display of that entry's summary).

When summaries are not enabled, the system treats the module as "no summary or enabled is false".

### Module type details

#### 1. timeline - time-triggered module

**Convention**: **a timeline must have a time-based entry condition** (`time` or `time_range`). Without a time condition it is not a timeline; mark it `free_trigger` (trigger-style) or place it in a `trigger_chain` (for things that can be done over a long period, put them in the chain's info).

**Characteristics**:
- Triggered automatically through time conditions
- `entryConditions` **must** contain a `time` or `time_range` condition
- Repeat triggering can be configured (through the periodic configuration of time_range)

⚠️ **Special requirement for timeline preconditions**:
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

**Repeat trigger configuration**:

⚠️ **repeat field**: configures the time interval of repeat triggering, using bound time parameters

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

💡 **repeat configuration notes**:
- `enabled`: whether repeating is enabled
- `interval`: repeat interval, using the time units bound by the module (such as year, month, day)
- For example: `{"month": 1}` means repeat once every 1 month

**Example 1: Monthly exam (triggers on the 1st of each month)**:
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

**Example 2: Annual major exam (triggers on January 15 each year)**:
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

#### 2. trigger_chain - trigger chain

**Convention**: **a trigger chain must have a before/after order** (`linkedList.prev`/`next`). It may have no trigger requirement (if it can be done over a long period, put it in the chain's info); unordered trigger-style content uses `free_trigger`.

**Characteristics**:
- Uses `linkedList` to define module order
- Must be completed in order (next can be entered only after prev is completed)
- prev null marks the chain start, next null marks the chain end

**Example**:
```json
{
  "id": "exam",
  "type": "trigger_chain",
  "linkedList": { "prev": "homework", "next": "result" }
}
```

#### 3. free_trigger - free trigger

**Convention**: trigger-style content without chain order uses a free trigger; it may have any entry conditions (including module, variable), and **when there is no time condition** a timeline cannot be used.

**Characteristics**:
- Can trigger as soon as entryConditions are met
- No order requirement
- Suited to optional events and random events

---

## 6. Flow (Sub-flow) Structure

### 🔷 Generic Flow definition template

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

### Flow field descriptions

| Field | Type | Required | Description |
|------|------|------|------|
| `entryEvent` | string | No | **Flow entry switch** (a module ID or null) |
| `subModules` | array | Yes | All modules within the flow |

### Flow entry switch (entryEvent)

⚠️ **Description**: The flow entry switch is a simple built-in lock that controls permission to enter a sub-flow.

**How it works**:
1. If `entryEvent` is set to some `module-id`, that module must be **completed** before other modules of the sub-flow can be entered
2. If `entryEvent` is `null`, the sub-flow has no entry lock and is directly accessible

**Benefits**:
- **Simpler configuration**: no need to write preconditions on every module inside the flow
- **Centralized management**: manage the admission conditions of a sub-flow in one place
- **Built-in feature**: handled automatically by the system, with no extra logic

### 📋 Example: entryEvent of an NPC sub-flow

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
          "name": "First Meeting with Zhang San",
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
              "content": "Meeting Zhang San for the first time"
            }
          ]
        },
        {
          "id": "daily_chat_zhang_san",
          "name": "Daily Chat with Zhang San",
          "type": "free_trigger",
          "note": "This module is protected by entryEvent; first_meet_zhang_san must be completed before it can trigger"
        }
      ]
    }
  }
}
```

💡 **Notes**:
- The `npc_zhang_san` sub-flow sets `entryEvent` to `first_meet_zhang_san`
- The user must first complete the "First Meeting with Zhang San" module before other modules in that sub-flow (such as "Daily Chat") can trigger
- This avoids repeating the `first_meet_zhang_san` completion condition in the `entryConditions` of `daily_chat_zhang_san`

---

## 7. NPC and Sub-flow Import/Export

### An NPC is a sub-flow

⚠️ **Core concept**: An NPC is a kind of sub-flow (flow).

All NPC-related features (cameo storylines, conditional appearance, conversation records, etc.) are standard capabilities of sub-flows:
- **Cameo storyline**: NPCs that conform to the data structure requirements can be imported into a module
- **Conditional appearance**: equivalent to the first event the NPC starts (entryEvent); only after this sub-flow module is completed does the NPC's sub-flow formally begin.
- **Character info**: stored in the flow's `variables`
- **Summary feature**: uses sub-flow summaries (see 03-summary-system.md)

### NPC start event (Entry Event)

💡 **Recommended format**: use `entryEvent` to set the NPC's first-meeting module

```json
{
  "flows": {
    "npc_li_si": {
      "entryEvent": "first_meet_li_si",
      "subModules": [
        {
          "id": "first_meet_li_si",
          "name": "Encounter with Li Si",
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
              "title": "Encounter",
              "content": "Met Li Si in the library"
            }
          ]
        }
      ]
    }
  }
}
```

⚠️ **Note**: `first_meet_li_si` is both the `entryEvent` (the entry lock) and the first module of that sub-flow. Once it is completed, the other modules of that NPC's sub-flow are unlocked.

### Importing and exporting a single sub-flow

💡 **The only special feature**: exporting/importing the JSON of a single sub-flow is supported, for easy NPC migration and sharing.

#### 🔷 Export format

```json
{
  "flowId": "npc_zhang_san",
  "flowName": "Zhang San",
  "sourceModule": "story-001",
  "exportDate": "2026-02-05",
  "flowData": {
    "subModules": [
      {
        "id": "first_meet",
        "name": "First Meeting with Zhang San",
        "type": "trigger_chain",
        "variables": [
          {
            "id": "relation",
            "name": "Affection",
            "type": "number",
            "initialValue": 50
          }
        ]
      }
    ]
  }
}
```

#### Import handling logic

1. **ID conflict detection**: check whether the target module already has the same flowId
2. **Variable merge strategy**:
   - If a variable with the same name exists, prompt the user to keep/overwrite/rename
   - Make sure variable scope is correct
3. **Condition dependency check**: if the imported flow references a moduleId that does not exist, give a warning
4. **Automatically add to flows**: add the imported flow to the target module's `flows` object

---

## 8. Module Modification and Runtime Behavior

### 8.1 Module modification (adding, removing and editing)

- **Adding/removing modules**: supports adding and removing entire modules in the module list (e.g. adding or removing story entries from module/list.json or an equivalent config); supports adding an "entire module" to the current module as a sub-flow or loadable package.
- **Module editing**: supports editing the config of a loaded module (such as entryConditions, info, variables, timeSystem); edits take effect after reloading or hot-updating; assertions and tests can cover post-edit behavior.

### 8.2 Timeline postponement (changing the date)

- **Semantics**: if "changing the current date" is allowed in real play, timeline entry conditions change with the date; a timeline whose time has not yet come can become enterable as the date advances (satisfied after the timeline is postponed).
- **Implementation notes**: after the time system exposes `advanceTime` / sets the current time, the queue and `_isTimelineTimeReached` are recomputed against the new time; tests and the assertion generator must support `setup.time`, `timesAtActions` and `assertions.time` to cover cases such as "before/after changing the date".

### 8.3 Interruption without completion (things get interrupted)

- **Semantics**: the current module may be left **without being completed**, treated as "things got interrupted"; the system should support marking it as interrupted and recording a summary, so it can be recalled when resuming.
- **Conventions**:
  - A module may stay at `state === 'entered'` without being completed; "mark interrupted" may then be called and **a summary is required** (e.g. `markModuleInterrupted(moduleId, { summary })`).
  - Presentation layer: when a module is entered and marked as interrupted, an **info "Interrupted, unfinished"** should be added, carrying the summary from the time of interruption, for display when play resumes.
  - Summary: on interruption, a summary is required (or generated by the AI/user) and stored in the module's interruption summary field; the next time the module is entered or shown, it can provide context such as "where we left off and why it was interrupted".
- **Runtime fields** (not written into module.json, only runtime/save data):
  - `interrupted`: boolean, whether the module is marked as interrupted and unfinished;
  - `interruptSummary`: string, the summary filled in at interruption, recalled when play resumes.

---

**Document version**: 1.0
**Last updated**: 2026-02-05
