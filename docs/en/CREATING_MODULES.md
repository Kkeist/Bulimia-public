English | [中文](../CREATING_MODULES.md)

# Module Creation Guide (v5)

A module = one `module.json`: an event tree (how the story goes), variables (what to remember), conditions (when an event can be entered or completed), background and delivery (what to tell the AI), and optional plugins (small sidebar panels). The game assembles a prompt for the AI from the current state, and the AI advances the state with command tags in its replies.

Three steps: look at the tutorial module -> write `module.json` -> validate and import.

- **Tutorial module**: in settings pick "Cultivation Module - Feature Showcase", and in the debug page use "Module Jump" to see the whole tree. The description of each event, variable and plugin is a single sentence about what it does; the structure list is in `module/xiuxian-demo/MODULE_STRUCTURE.md`. (When the UI language is English, the English version `module.en.json` of the tutorial module is loaded.)
- **Let an AI help you write it**: send the whole prompt in `docs/en/AI-module-writing-prompt.md` to an AI.
- **Validate**: `node tools/validate-module.mjs your-module.json`
- Starter templates are in `module/_templates/` (`module.template.json` is an empty structure, and `MODULE_BUILD_RULES.md` explains the workflow of drawing the structure map first and then writing the JSON; English versions end in `.en.md` / `.en.json`).

## 1. Where files go

```
module/<folder-name>/module.json     required
module/<folder-name>/module.en.json  optional English version, loaded when the UI language is English
module/<folder-name>/plugins/…       optional (plugin pages can also be written straight into module.json, which is recommended)
module/list.json                     only needed for modules shipped with the game
```

- For your own use: no need to put it in `module/`. Just import `module.json`: Settings -> Module Management -> Import, or Debug -> Module Edit -> Import Module. Errors found during import will block it; when importing on the debug page, any hints will also ask you to confirm.
- Shipped with the game: use only letters, digits, `_` and `-` in the folder name; add an entry to `module/list.json`:

```json
{ "id": "module-id", "name": "Module name", "version": "1.0.0", "author": "Author", "description": "One-line description", "path": "module/folder-name", "enabled": true }
```

  Optionally add `"i18n": { "en": { "name": "…", "description": "…", "author": "…" } }` to provide display text for other UI languages.

  For test modules also add `"isTest": true`.

## 2. Top level of module.json

| Field | Description |
|---|---|
| `id` | Module identifier, required |
| `name`, `description`, `version` | Name, description, version |
| `timeSystem` | Time system, see section 4 |
| `timeUnits` | Carry-over: `minutesPerHour`, `hoursPerDay`, `daysPerMonth`, `monthsPerYear`; defaults 60, 24, 30, 12 |
| `info` | Background on the root; only marked `"persistent": true` is sent in all events |
| `variables` | Variables visible across the whole module |
| `plugins` | Plugins visible across the whole module |
| `flows` | `main` is the main flow; other names are sub-flows |

Do not write `content` (if you do, it is treated as the legacy format and the main flow becomes an empty tree).

## 3. Events

Each event is one item in `flows.<flowName>.subModules`:

| Field | Description |
|---|---|
| `id`, `name`, `type` | Identifier (letters, digits, underscore; unique across the module), name (unique across the module; the AI enters events by name), type |
| `note` | A note for the author; not sent to the AI |
| `tags` | Tags, used by tag conditions |
| `entryConditions` / `completionConditions` | Entry and completion conditions, see section 5 |
| `info` | Background: `[{ "content": "…", "condition": single wrapper, "persistent": true }]` |
| `deliveryInfo` | Delivery: `[{ "title": "…", "content": "…", "condition": single wrapper }]` |
| `queueDisplay` | `{ "before": 1, "after": 2 }`; how many upcoming and completed event names are listed in the prompt |
| `linkedList` | Trigger chains only: `{ "prev": previous or null, "next": next or null }` |
| `variables`, `plugins` | Variables and plugins visible in this event and its child events |
| `variableSetOnEnter` | `{ "variableId": value }`; only takes effect when entering via a debug page jump; neither the AI entering the event nor automatic advance to the next one triggers it |
| `summary` | Ask the AI to write a summary for this event when child events complete: `{ "enabled": true, "autoSummarize": true, "promptList": [{ "condition": [], "content": "prompt" }] }` |
| `flows` | Child events: `{ "main": { "entryEvent": null, "subModules": […] } }`; leaf events may omit it |

### The three types

- `trigger_chain` trigger chain: runs in `linkedList` order; the next only gets its turn after the previous is completed. When an event on the chain completes, the next one is entered automatically.
- `free_trigger` free trigger: no order; can be entered as soon as its conditions are met.
- `timeline` timeline: must carry a `time` or `time_range` condition; can only be entered once the time arrives.

### Structure rules

- A parent event with child events must have at least one `trigger_chain` child in `main`, otherwise it stays stuck at the parent level after entering.
- A new game starts from the first trigger chain of the main flow (going all the way down to the first leaf).
- Free triggers and timelines must sit under the same parent event as the chain events; they only appear while a chain event is active, and no longer appear once you leave that group.
- To walk through several parent events in order: also link the parent events into a chain with `linkedList`, and have the tail event of the previous group point its `linkedList.next` at the head event of the next group (write only `next`; the head of the next group has `prev` set to `null`).
- For an event later on a chain, when the previous one completes it is entered automatically, **without checking its variable conditions**. To gate progress with a variable, put the condition in the previous event's `completionConditions`, or make it a free trigger.
- A parent event's background is not sent to child events by default; mark it `persistent: true` (looked up at most 3 levels up).
- Sub-flows: add another name under `flows`, `{ "name": "display name", "entryEvent": "precondition event id", "subModules": […] }`. Events in the sub-flow can only be entered after the precondition event is completed; the precondition event must be placed in the main flow — if it is inside the sub-flow itself, the sub-flow can never be entered.

## 4. Time System

```json
"timeSystem": {
  "parameters": [
    { "id": "year", "type": "base", "systemBinding": "year" },
    { "id": "month", "type": "base", "systemBinding": "month" },
    { "id": "day", "type": "base", "systemBinding": "day" },
    { "id": "hour", "type": "base", "systemBinding": "hour" },
    { "id": "shichen", "type": "computed", "formula": "hour/2", "labels": ["Zi","Chou","Yin","Mao","Chen","Si","Wu","Wei","Shen","You","Xu","Hai"], "calculationOnly": true }
  ],
  "initialValues": { "year": 1, "month": 1, "day": 1, "hour": 8 },
  "displayFormat": "Year {{year}}, Month {{month}}, Day {{day}} · {{shichen}} Hour"
}
```

- `base` parameters bind the system's `year`, `month`, `day`, `hour`, `minute`, `prefix`; the AI advances them with `<time|hour|add|2>`, forward only.
- `computed` parameters derive a name from "one of year/month/day/hour/minute / an integer" and cannot be changed directly by the AI.
- The `{{…}}` in the display format must be ids of defined parameters.

## 5. Conditions

Conditions have three layers: condition group `conditionDef` -> group `groups[].items[]` -> single condition.

```json
{ "logic": "AND", "groups": [ { "logic": "OR", "items": [
  { "itemType": "condition", "condition": { "type": "variable", "variableId": "qi", "operator": ">=", "value": 10 } },
  { "itemType": "group", "group": { "logic": "AND", "items": [ … ] } }
] } ] }
```

**The wrapper shape differs in four places; writing it wrong is treated as no condition:**

| Location | Shape |
|---|---|
| `entryConditions`, `completionConditions` | Wrapper array `[{ "type": "precondition", "conditionDef": … }]` |
| `info[].condition`, `deliveryInfo[].condition` | Single wrapper `{ "type": "display", "conditionDef": … }`, not an array |
| A variable's `switchConditions[].condition` | Directly the condition group `{ "logic", "groups" }`, with no extra wrapping |
| A variable's `computeConditions[].conditionDef` | Directly the condition group |

Single condition types:

| `type` | How to write it |
|---|---|
| `variable` | `variableId`, `operator` (`>= <= == != > <` and `in`), `value` |
| `variable_compare` | `variableId`, `operator`, `compareVariableId` |
| `module` | `moduleId`, `state` (`entered` or `completed`) |
| `time` | Absolute: `{ "timeType": "absolute", "time": { "year": 1, "month": 1, "day": 2 } }`; relative: `{ "timeType": "relative", "relative": { "moduleId": "x", "state": "completed", "offset": { "hour": 2 } } }` |
| `time_range` | `timeType: "absolute"`, `start`, `end`; to repeat daily add `"repeat": { "enabled": true, "interval": { "day": 1 } }` (`interval` may only be one of year, month, day) |
| `tag` | `matchType` (`any` or `all`), `tags`; it looks at the tags of all entered events (including parents) |

Entry condition merge rule: the entry conditions of the current event + all parents + the previous event on the chain apply simultaneously; when the same variable appears more than once, the current event's takes priority.

## 6. Variables

```json
{ "id": "qi", "name": "Qi", "type": "number", "category": "module", "initialValue": 0, "min": 0, "max": 100,
  "generalRules": "A one-sentence explanation, sent to the AI with the variable every turn.",
  "changeRules": [ { "name": "Meditate", "operation": "add", "value": 10 } ] }
```

| Field | Description |
|---|---|
| `type` | `number`, `string`, `boolean`, `list`, `object`, `list_of_object` |
| `category` | `module` is sent to the AI and the AI can change it; `switch` is sent only when `switchConditions` are met; `builtin` is computed by `computeConditions` and not sent to the AI; `temp` is scratch storage, not sent to the AI, reserved for plugins |
| `initialValue` | Initial value; its type must match `type` |
| `readonly` | `true`: sent to the AI to see, but it cannot change it |
| `min`, `max` / `maxLength` | Number range / maximum text length |
| `elementType` | Element type of a `list`: `string`, `number`, `boolean`, `object` |
| `fields` | Fields of `object` / `list_of_object`: `[{ "name": "name", "type": "string", "default": "" }]` |
| `changeRules` | Shortcut rules: `{ "name", "operation", "value" }`; operation uses `add subtract multiply divide set`; the AI writes `<rule|variableName|ruleName>` |
| `computeConditions` | Automatic computation; takes the first entry in order whose condition is met: `{ "conditionDef": condition group, "formula": "'Foundation Establishment'" }`; text results must be quoted; formulas may use numbers, text, `{{variableId}}`, arithmetic, comparison, `&&`, `\|\|`, `? :`, `floor ceil round min max abs` |
| `switchConditions` | `[{ "type": "display", "action": "open", "condition": condition group }]` |

A variable is visible in the event that defines it and its child events; written on the root it is visible across the whole module. The AI refers to variables by name, so `name` should be short and unique, and must not contain `| < >`.

Operations the AI can perform per type:

| Type | Operations |
|---|---|
| number | `add subtract multiply divide set` |
| string | `set append` |
| boolean | `set` (write true or false) |
| list | `append remove extend set` |
| object | `modify_item` (`field=title,op=set,value=disciple`), `set` (JSON) |
| list_of_object | `add_item` (`name=Yunzhou,bond=5`), `modify_item` (`index=0,field=bond,op=add,value=3`), `remove_item` (index), `set` (JSON) |

## 7. Delivery

The content in `deliveryInfo` keeps being sent to the AI until the AI confirms with `<delivery|title|done>`; until it is confirmed, the event cannot be completed. Titles must not repeat within the same event, and do not write `completed`.

## 8. Plugins

A minimal display plugin, with the page written straight into `module.json` (it also works when importing a single file):

```json
{ "id": "panel", "name": "Panel", "type": "display",
  "inlineHtml": "<div><span>Qi</span> <b data-bind=\"qi\"></b></div>",
  "inlineStyle": "body{margin:0;padding:8px;background:#fff;color:#111}",
  "config": { "requiredVariables": ["qi"] } }
```

- `data-bind="variableId"` shows the variable's value in the element; add `data-bind-as="width"` and `data-bind-max="100"` to make a progress bar.
- When you write scripts in the page yourself: use `PluginAPI.onVars(fn)` to read variables; when the page contains both scripts and `{{variable}}`, `{{` is replaced at load time, so do not write `{{` in scripts.
- A plugin is shown under the event path it is attached to; attached to the root it is shown throughout.
- There are eight types in total: `display` display, `interactive` interactor, `display_interactive` display plus interactor, `randomizer` randomizer, `variable_reader` variable reader, `variable_op` variable operator, `module_generator` module generator, `summary` summarizer.

## 9. Commands in AI Replies

Always copy names exactly as the display names written in the prompt.

| Command | Effect |
|---|---|
| `<var\|variableName\|operation\|value>` | Change a variable |
| `<rule\|variableName\|ruleName>` | Change a variable with a shortcut rule |
| `<time\|parameter\|add or set\|value>` | Advance or set the time |
| `<module\|enter\|eventName>` | Enter an event in "Enterable"; the current event counts as completed |
| `<module\|complete\|eventName>` | Complete the event in progress (delivery must be confirmed and completion conditions met first) |
| `<delivery\|title\|done or uncompleted>` | Confirm delivery |
| `<foreshadow\|title\|description\|triggerCondition>` | Record foreshadowing, reminding again when the condition is met |
| `<plugin\|pluginName\|content>` | Call an interactor |
| `<summary\|global or module or plugin\|content>` | Record a summary |

For commands that did not take effect, the next round's prompt reminds the AI, and the chat also states the reason.

## 10. Validate, Import, Test

1. **Validate**: `node tools/validate-module.mjs module.json`. The output is split into "errors" (must fix) and "hints" (importable, but behavior may not match expectations), each with the event location. `--strict` makes hints count as failures too.
2. **Import**: Settings -> Module Management -> Import.
3. **View the tree**: Debug -> Module Jump; each event has "Jump", "Complete" and "Untriggered". Using "Jump" also sets variables to satisfy the entry conditions.
4. **View the prompt**: Debug -> Prompt Viewer shows exactly what will be sent next time.
5. **Edit**: Debug -> Module Edit; every field can be edited by clicking, and after editing use "Export new module" or "Overwrite original module".
6. **Playtest**: start a new game and use the debug page cheats to change variables and time, checking that the queue and prompt change as expected.

## 11. Common Mistakes

| Symptom | Cause |
|---|---|
| The main flow is empty after import | The file has a `content` field and is treated as the legacy format |
| A condition has no effect | Wrong wrapper shape (the table in section 5); `logic` not written as AND or OR; `itemType` missing |
| Stuck at the parent level after entering a parent event | The parent event's `main` has no `trigger_chain` |
| Stops after finishing one stage | The tail event of this group has `linkedList.next` null and is not connected to the head event of the next stage |
| The AI cannot see the parent event's background in a child event | The parent's background is not marked `persistent: true` |
| An event on the chain is not gated by a variable condition | Automatic advance does not check variable conditions, see section 3 |
| An event cannot be completed | There is unconfirmed delivery, or the completion conditions are not met |
| An AI command did not take effect | The name was written as an internal identifier, or the event is not in "Enterable" / "Completable", or the name is duplicated |
| A sub-flow can never be entered | The precondition event was placed inside the sub-flow |
| Text-type automatic computation reports an error | The text result in the formula is not quoted (`'Qi Refining'`) |
| A plugin does not show | The plugin is attached to another event; `type` is wrong; the page uses a file path but only `module.json` was imported |
