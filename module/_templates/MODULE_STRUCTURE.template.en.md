# [Module Name] Structure Design

For field names see the [Bulimia data structures](../docs/en/01-core-schemas.md). For construction rules see [MODULE_BUILD_RULES.en.md](./MODULE_BUILD_RULES.en.md).

---

<a id="structure-map"></a>

## 1. Structure Map

Root module [Module Name](#root_module_id) (id: `root_module_id`)

- **Main**
    - **Timelines:**
        - [Timeline node 1 name](#node1_id)
    - **Trigger chains:**
        - [Chain node 1 name](#chain1_id)
            - Main
                - **Trigger chains:**
                    - [Child chain node A](#childA_id)
                    - [Child chain node B](#childB_id)
    - **Free triggers:**
        - [Free node 1](#free1_id)
- **Sub-flow 1 name** (sub-flow `flow_1_id`)
    - Precondition: xxx `precondition_module_id`
    - **Trigger chains:**
        - [In-flow chain 1](#f1_chain1_id)

- **Summary**: none.

[↑ Back to structure map](#structure-map)

---

## 2. Full Structure Map (same shape as section 1 + variables/plugins)

Root module [Module Name](#root_module_id) (id: `root_module_id`)

- **Main**
    - **Timelines:**
        - [Timeline node 1 name](#node1_id) `node1_id`
    - **Trigger chains:**
        - [Chain node 1 name](#chain1_id) `chain1_id`
            - Main
                - **Trigger chains:**
                    - [Child chain node A](#childA_id) `childA_id`
                    - [Child chain node B](#childB_id) `childB_id`
    - **Free triggers:**
        - [Free node 1](#free1_id) `free1_id`
- **Sub-flow 1 name** (sub-flow `flow_1_id`)
    - **Trigger chains:**
        - [In-flow chain 1](#f1_chain1_id) `f1_chain1_id`

- **Summary**: none.

[↑ Back to structure map](#structure-map)

---

## 3. Module Construction Rules

See [module/_templates/MODULE_BUILD_RULES.en.md](./MODULE_BUILD_RULES.en.md).

---

## 4. Module Descriptions

<a id="root_module_id"></a>
### Module Name (root module)

- **Module id**: `root_module_id`
- **Module name**: Module Name
- **Flow**: main (may be omitted when the root has no flow field)
- **Type**: none (root node)
- **Variables**: none.
- **Plugins**: none.
- **Entry conditions**: none.
- **Completion conditions**: none.
- **Module info**: none, or (1) `content`: "…"; `condition`: none.
- **Delivery info**: none.
- **Summary**: none.

[↑ Back to structure map](#structure-map)

---

<a id="node1_id"></a>
### Timeline node 1 name

- **Module id**: `node1_id`
- **Module name**: Timeline node 1 name
- **Flow**: `main`
- **Type**: timeline
- **Variables**: none.
- **Plugins**: none.
- **Entry conditions**: `type`: `precondition`, `conditionDef`: (1) `type`: `time` or `time_range`, … (a timeline must contain a time condition).
- **Completion conditions**: none.
- **Module info**: (1) `content`: "…"; `condition`: none.
- **Delivery info**: none.
- **linkedList**: none (timelines have no linkedList).
- **Summary**: none.

[↑ Back to structure map](#structure-map)

---

<a id="chain1_id"></a>
### Chain node 1 name

- **Module id**: `chain1_id`
- **Module name**: Chain node 1 name
- **Flow**: `main`
- **Type**: trigger chain
- **Variables**: none.
- **Plugins**: none.
- **Entry conditions**: none, or for non-head nodes, conditions other than prev.
- **Completion conditions**: none.
- **Module info**: (1) `content`: "…"; `condition`: none.
- **Delivery info**: none.
- **linkedList**: `{ "prev": null, "next": "childA_id" }` (chain head).
- **Summary**: none.

[↑ Back to structure map](#structure-map)

---

<a id="childA_id"></a>
### Child chain node A

- **Module id**: `childA_id`
- **Module name**: Child chain node A
- **Flow**: `main`
- **Type**: trigger chain
- **Variables**: none.
- **Plugins**: none.
- **Entry conditions**: none (on a chain, prev is the default).
- **Completion conditions**: none.
- **Module info**: (1) `content`: "…"; `condition`: none.
- **Delivery info**: none.
- **linkedList**: `{ "prev": "chain1_id", "next": "childB_id" }`.
- **Summary**: none.

[↑ Back to structure map](#structure-map)

---

<a id="childB_id"></a>
### Child chain node B

- **Module id**: `childB_id`
- **Module name**: Child chain node B
- **Flow**: `main`
- **Type**: trigger chain
- **Variables**: none.
- **Plugins**: none.
- **Entry conditions**: none.
- **Completion conditions**: none.
- **Module info**: (1) `content`: "…"; `condition`: none.
- **Delivery info**: none.
- **linkedList**: `{ "prev": "childA_id", "next": null }` (chain tail).
- **Summary**: none.

[↑ Back to structure map](#structure-map)

---

<a id="free1_id"></a>
### Free node 1

- **Module id**: `free1_id`
- **Module name**: Free node 1
- **Flow**: `main`
- **Type**: free trigger
- **Variables**: none.
- **Plugins**: none.
- **Entry conditions**: (1) `type`: `module`|`variable`|…; write "none" if there are none.
- **Completion conditions**: none.
- **Module info**: (1) `content`: "…"; `condition`: none.
- **Delivery info**: none.
- **Summary**: none.

[↑ Back to structure map](#structure-map)

---

## 5. Sub-flow Descriptions

### Sub-flow 1 name (flow_1_id)

- **Sub-flow id**: `flow_1_id`
- **entryEvent**: `precondition_module_id` or null (enforced by the system; the entryConditions of modules inside the flow need not repeat "precondition module completed").
- **Summary**: none.

---

<a id="f1_chain1_id"></a>
### In-flow chain 1

- **Module id**: `f1_chain1_id`
- **Module name**: In-flow chain 1
- **Flow**: `flow_1_id`
- **Type**: trigger chain
- **Variables**: none.
- **Plugins**: none.
- **Entry conditions**: none (already constrained by the sub-flow's entryEvent).
- **Completion conditions**: none.
- **Module info**: (1) `content`: "…"; `condition`: none.
- **Delivery info**: none.
- **linkedList**: `{ "prev": null, "next": null }`.
- **Summary**: none.

[↑ Back to structure map](#structure-map)

---
