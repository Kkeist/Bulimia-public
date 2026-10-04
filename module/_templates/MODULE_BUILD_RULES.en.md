# Module Construction Rules

A module should first be written as **MODULE_STRUCTURE.md** (the structure design), and then converted into `module.json` from that document. Do not write the JSON first; it becomes hard to maintain and hard to keep hierarchy and conditions consistent.

---

## 1. Workflow: Structure first, then JSON

1. **Write MODULE_STRUCTURE.md first**
   - Use a human-readable hierarchy and fields to spell out the module tree, sub-flows, and each module's id/name/type/conditions/variables/plugins/summary and so on.
   - The structure map (with anchors and back-links) and the "module descriptions" are the single source of truth.

2. **Then generate module.json from the Structure**
   - Follow section "6. Notes on generating module.json from this design" in MODULE_STRUCTURE for field mapping, conditionDef expansion, and restoring entryEvent and the tree structure.
   - After generating, use "7. Test content type coverage check" to verify that every type that needs testing is covered.

3. **When iterating**
   - Change the design only in MODULE_STRUCTURE; after that, regenerate or hand-edit module.json so the two stay consistent.

---

## 2. Sections a Structure document should contain

It is recommended to keep the same shape as the module's own MODULE_STRUCTURE.md to ease conversion and testing:

| Section | Content |
|------|------|
| **1. Structure map** | Main / each sub-flow under the root module; timelines, trigger chains and free triggers grouped; nodes carry `[name](#id)` anchors; vertical order is chain order. |
| **2. Full structure map** | Same shape as section 1, adding **variables** (ids) and **plugins** (ids) under each node; omit if none. |
| **3. Module construction rules** | Summary of design rules plus conventions for time/calendar; may reference this BUILD_RULES. |
| **4. Module descriptions** | One entry per module; for fields see the [Bulimia data structures](../docs/en/01-core-schemas.md): module id, module name, flow, type, variables, plugins, entry conditions, completion conditions, module info, delivery info, tags, queue display, linkedList, summary and so on; write "none" if absent. |
| **5. Sub-flow descriptions** | One paragraph per sub-flow (non-main): sub-flow id, **entryEvent**, entry conditions, summary. |
| **6. Notes on generating module.json from this design** | Field mapping, conditionDef expansion rules, entryEvent values, tree restoration, variable and plugin conversion. |
| **7. Test content type coverage check** | Compare against 05-test-module / 01-core-schemas and list in a table whether each type to be tested is included (module types, time/conditions, variables, plugins, flows, summary, queueDisplay and so on). |

Add `[↑ Back to structure map](#structure-map)` at the end of each module description so readers can jump back to the structure map.

---

## 3. Format templates for the structure map and module descriptions (copy into MODULE_STRUCTURE and replace the placeholders)

The format below matches the module's own MODULE_STRUCTURE. When creating a new module, copy it into your own Structure document and replace it with the real ids/names/flows.

### 3.1 Structure map (for section 1)

```
Root module [Root module name](#root_module_id) (id: `root_module_id`)

- **Main**
    - **Timelines:**
        - [Timeline node 1 name](#node1_id)
        - [Timeline node 2 name](#node2_id)
    - **Trigger chains:**
        - [Chain node 1 name](#chain1_id)
            - Main
                - **Trigger chains:**
                    - [Child chain node A](#childA_id)
                    - [Child chain node B](#childB_id)
        - [Chain node 2 name](#chain2_id)
            - Main
                - **Free triggers:**
                    - [Free node 1](#free1_id)
    - **Free triggers:**
        - [Global free node](#global_free_id)
- **Sub-flow 1 name** (sub-flow `flow_1_id`)
    - Precondition: xxx `precondition_module_id`
    - **Trigger chains:**
        - [In-flow chain 1](#f1_chain1_id)
    - **Timelines:**
        - [In-flow timeline 1](#f1_time1_id)
    - **Free triggers:**
        - [In-flow free 1](#f1_free1_id)
- **npc_flows** (if any)
    - Injected dynamically by the NPC generator; precondition: xxx `precondition_module_id`

- **Summary**: none.

[↑ Back to structure map](#structure-map)
```

Note: the `[display name](#anchor_id)` anchor corresponds to the `<a id="anchor_id"></a>` in each module description; vertical order is chain order, and no arrows are written.

### 3.2 Full structure map (for section 2; same shape as section 1 + variables/plugins)

```
Root module [Root module name](#root_module_id) (id: `root_module_id`)

- **Main**
    - **Timelines:**
        - [Timeline node 1 name](#node1_id) `node1_id`
            - **Variables**: `variable_id`. (If a plugin has temporary variables, note them here)
        - [Timeline node 2 name](#node2_id) `node2_id`
    - **Trigger chains:**
        - [Chain node 1 name](#chain1_id) `chain1_id`
            - Main
                - **Trigger chains:**
                    - [Child chain node A](#childA_id) `childA_id`
                    - [Child chain node B](#childB_id) `childB_id`
        - [Chain node 2 name](#chain2_id) `chain2_id`
            - Main
                - **Free triggers:**
                    - [Free node 1](#free1_id) `free1_id`
                        - **Variables**: xxx.
                        - **Tags**: write if any.
                        - **Plugins**: write the id if any.
    - **Free triggers:**
        - [Global free node](#global_free_id) `global_free_id`
            - **Variables**: none. (If the plugin has temporary variables, note them)
            - **Plugins**: `plugin_id`.
- **Sub-flow 1 name** (sub-flow `flow_1_id`)
    - **Trigger chains:**
        - [In-flow chain 1](#f1_chain1_id) `f1_chain1_id`
    - **Timelines:**
        - [In-flow timeline 1](#f1_time1_id) `f1_time1_id`
    - **Free triggers:**
        - [In-flow free 1](#f1_free1_id) `f1_free1_id`

- **Summary**: none.

[↑ Back to structure map](#structure-map)
```

Note: put the `` `module_id` `` in backticks after the node name; when the node has variables/plugins/tags, list them indented below it, otherwise omit.

### 3.3 Module description (single-entry template)

One entry per module. The heading is `### Module name`, and the anchor is `<a id="module_id"></a>` (matching `#module_id` in the structure map). For fields see the [Bulimia data structures](../docs/en/01-core-schemas.md); write "none" if absent.

**Field conventions**: module id, module name, flow, type, variables, plugins, module note, entry conditions, completion conditions, module info, delivery info, tags, queue display, linkedList, summary (optional).
**condition**: always `precondition` or `display`; list conditionDef items as (1) (2) …, and for multiple conditions state **logic**: AND or OR.

**Single-entry copy template** (replace the placeholders and use it module by module):

```
<a id="module_id"></a>
### Module name

- **Module id**: `module_id`
- **Module name**: Module name
- **Flow**: `main` | `sub_flow_id`
- **Type**: timeline | trigger chain | free trigger
- **Variables**
  - Variable id: `variable_id`
    - Variable name: variable name
    - Variable type: string | number | boolean | list_of_object | …
    - Variable category: module variable | switch variable | builtin variable
    - Initial value: …
    - Variable change rules: …
  (If none, write "**Variables**: none.")
- **Plugins**
  - Plugin id: `plugin_id`
    - Plugin name: plugin name
    - Plugin note: … (if it has temporary variables, state id, name, type)
    - Plugin precondition or plugin display condition: `type`: precondition/display, conditionDef: …
  (If none, write "**Plugins**: none.")
- **Module note**: for debugging only, not sent to the AI.
- **Entry conditions**
  - `type`: `precondition` (or display)
  - `conditionDef`: (1) `type`: `module`|`variable`|`time`|…, …; (2) …; **logic**: AND/OR. (If none, write "none".)
- **Completion conditions**
  - none. (Or, if present, same format as entry conditions.)
- **Module info**
  - (1) `content`: "…"; `condition`: none, or a concrete condition.
- **Delivery info**
  - none. (Or, if present, (1) `title`: "…", `content`: "…", `condition`: …; completed is a system default and is not written.)
- **Tags**: none. (Or, if present, `["tag1", "tag2"]`.)
- **Queue display**: none. (Or, for event modules only, write the two numbers before/after.)
- **linkedList**: trigger chains only; `{ "prev": "previous node id or null", "next": "next node id or null" }`.
- **Summary**: none. (Or enabled + promptList format.)

[↑ Back to structure map](#structure-map)
```

**Sub-flow description (for section 5) single-entry template**:

```
## N. Sub-flow name (flow_id)

- **Sub-flow id**: `flow_id`
- **entryEvent**: `precondition_module_id` or null.
- **Summary**: none, or summary format.
```

---

## 4. Design rules when writing a Structure

### 4.1 Trigger chains are central

- Under each module (including the root), **the main line is built around a trigger chain**: the player enters at the first node of the chain and advances in order; timelines and free triggers fire **in parallel** with the chain when their conditions are met, and do not replace it.
- If a module has **no** trigger chain beneath it, the current event within that module ends up in a **floating** state. Therefore: **every module should include a trigger chain where possible**, unless the module is "pure free exploration" with no main line.

### 4.2 What goes at the outermost level

- **Outermost trigger chain**: represents **stages/eras** (e.g. Mortal → Qi Refining → Foundation Establishment); each stage node is then subdivided into timelines/chains/free triggers.
- **Outermost timelines**: only hold global events that are **not tied to a single stage**.
- A **stage-specific timeline** must be placed in the timeline **within the corresponding stage or sub-flow module**; do not put it at the outermost level and add a "realm condition".
- The same applies to any parent and child: express ownership through hierarchy, not through "same level + a pile of conditions".

### 4.3 Hierarchy and containment

- **Parent/child relationships must be clear and effective**: a child written under a parent module means it happens within the scope of that parent.
- Within one level: timelines first, then trigger chains, then free triggers (the order may follow habit, but type groups must be clear).
- Keep the tree balanced: avoid too many siblings at one level; use the levels fully for readability and future extension.

### 4.4 Conditions and field conventions

- Every **condition** must be `precondition` or `display`, and **conditionDef** must be a code-ready structure (`type`, `variableId`, `moduleId`, `state`, `time`, `timeType`, `operator`, `value` and so on); purely natural-language descriptions are forbidden.
- **Default conditions are not written**: (1) a parent must be entered before its child can be (guaranteed by the tree); (2) trigger chain: the previous node on the chain (linkedList.prev) is completed; (3) sub-flow: the module named by entryEvent is completed. The **system** adds these automatically during evaluation; the module does **not** write them into entryConditions, only variable, time and other conditions beyond these.
- Entry/completion conditions: for multiple conditions state **logic**: AND or OR; write "none" for a single condition or none at all.
- A timeline module's entry conditions must include a **time-related** condition (`time` or `time_range`); a trigger chain must have **linkedList** (prev/next).
- List only module variables, switch variables and builtin variables; **temporary variables belong to plugins**, and are written in the plugin note rather than under module variables.
- A sub-flow must **explicitly state entryEvent** (module-id or null) in its "sub-flow description", which is used directly when generating module.json.

### 4.5 System defaults and what must not be written in a module

The following are conventions of the **system**. **Do not write any of them in a concrete module's MODULE_STRUCTURE or module.json, and do not write explanatory parentheses in a module.** Explanations belong only in these rules and in guides such as 01-core-schemas.

| Item | System behavior | In the module |
|------|----------|--------|
| **Empty entry conditions** | When there is no precondition, do not write conditionDef; do not write placeholders such as `type: none`. | Just write "none". |
| **Parent / chain predecessor / entryEvent** | The system adds automatically: (1) the parent must be entered before the child (2) the previous node on the chain is completed (3) the sub-flow's entryEvent is completed. | Do not write into entryConditions; do not write explanations such as "system default". |
| **completed of info / deliveryInfo** | Defaults to false until delivery is done. | Do not write `completed: false`. |
| **Queue display queueDisplay** | before/after is the number of queue entries shown at the current event; semantics are implemented by the system. | Write only the numbers, e.g. `before`: 2, `after`: 2; do not write explanations such as "while in this event…". |
| **condition of summary promptList** | When condition is absent, the summary is triggered per the system's convention (e.g. on child module completion). | Write only "none" or a concrete condition; do not write explanations such as "summarize once per child module completion". |
| **entryEvent** | The sub-flow entry is validated by the system. | Write only `entryEvent`: `module_id` or null; do not write explanations such as "enforced by the system" or "need not be written again". |

---

## 5. Key points from Structure to JSON

- **Field names**: map according to section 6 of the Structure (e.g. module id → id, type timeline → timeline).
- **conditionDef**: the design's (1) (2) … and logic must be expanded into 01-core-schemas' `{ logic, groups: [ { logic, items: [ { itemType: "condition", condition: { ... } } ] } ] }`.
- **Tree and flows**: uniquely determined by the structure map; the order of each flow's subModules matches the structure map; recursive child modules are expanded the same way.
- **entryEvent**: read from the sub-flow descriptions, never inferred.
