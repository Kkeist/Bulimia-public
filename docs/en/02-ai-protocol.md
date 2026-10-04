English | [中文](../02-ai-protocol.md)

# 02 - AI Interaction Protocol

This document defines the complete interaction protocol between the Bulimia module system and the AI, including the unified reply format, operation commands, Prompt generation specification and more.

**Goal**: Provide clear and concise AI interaction rules so the AI can accurately understand and execute system commands.

---

## Core Design Principles

⚠️ **Unified format**: All AI replies use the concise `<type|param1|param2|...>` format

**Benefits**:
- Simple to learn: the AI only needs to remember one tag format
- Fewer errors: avoids complex JSON structures
- Automatic parsing: the system automatically converts tags into standard JSON

---

## User Input Format (Story / Out-of-character Instructions)

The frontend splits user input into two kinds and merges them into one user message sent to the AI:

- **Story / roleplay**: actions, dialogue, etc. the user performs in character; treated as in-story roleplay.
- **Out-of-character instructions**: requests or explanations addressed to the AI or about the direction of the story; not treated as roleplay content.

Merge rules (concatenated automatically by the system; the AI receives a single user message):

- Story only: only the story text is sent.
- Out-of-character only: `【场外指令】\n` + the out-of-character text is sent (`【场外指令】` = "Out-of-character instructions" section marker).
- Both: `【剧情】\n` + story + `\n\n【场外指令】\n` + out-of-character text (`【剧情】` = "Story" section marker).
- Both empty: `【场外指令】\n要求自动推进` is sent ("Please advance automatically"), used for "empty message auto-advance".

In presets and writing guidance you can explain that a user message may contain the two paragraph kinds `【剧情】` (story) and `【场外指令】` (out-of-character), and that they should be treated differently. (Note: these section markers are protocol strings; their exact localized text is defined by the implementation.)

---

## 1. Variable Operation Format

### Format specification

```
<var|variableID|operation|param>
```

### Supported operation types

#### 1. Basic operations (number/string types)

```
<var|score|add|10>
<var|name|set|Zhang San>
<var|count|subtract|5>
```

**Automatically converted by the system to**:
```json
{
  "varId": "score",
  "operation": "add",
  "params": { "value": 10 }
}
```

#### 2. List operations (list type)

```
<var|attendance|append|2024-01-15>
<var|tags|remove|Completed>
<var|items|extend|ItemA,ItemB,ItemC>
```

#### 3. Object operations (list_of_object type)

**Full format example** (as sent to the AI):
```
<var|friends|add_item|name=Wang Wu,relation=50,tags=new friend>
  Format requirement: add_item(name=string, relation=number, tags=list)
  
<var|friends|modify_item|index=0,field=relation,op=add,value=10>
  Format requirement: modify_item(index=number, field=string, op=add|set, value=any)
  
<var|friends|remove_item|index=2>
  Format requirement: remove_item(index=number)
```

**Parameter format notes**:
- Use the `key=value` format
- Separate multiple parameters with commas
- List fields such as tags use comma-separated values directly (the system converts them to arrays automatically)

### Shortcut operations with changeRules

💡 **Recommended**: call predefined operations by rule name

```
<rule|score|Exam passed bonus>
<rule|friends|Add new friend|name=Li Si>
<rule|friends|Increase affection|index=0>
```

**Format**:
- `<rule|variableID|ruleName|optionalParams>`
- The system automatically runs the corresponding operation and value according to changeRules
- If the value contains a `$param` placeholder, the AI must supply the corresponding parameter

**Example**:

Variable definition:
```json
{
  "id": "score",
  "changeRules": [
    {
      "name": "Exam passed bonus",
      "operation": "add",
      "value": 10
    }
  ]
}
```

AI call:
```
<rule|score|Exam passed bonus>
```

System execution:
```javascript
score.add(10)
```

---

## 2. Time Advancement Operation Format

### Design principles

⚠️ **Core mechanism**:
- The AI fills in all time parameter content
- Each time, an **exact amount of time** is advanced (down to the parameter)
- Only bound parameters can be operated on

### Format specification

```
<time|parameterID|operation|value>
```

### Time advancement rules

💡 **Automatic calculation**: The AI advances a reasonable amount of time according to the story, and the system automatically computes all parameters

⚠️ **Advancement frequency recommendations**:
- **Regular dialogue**: each advance usually does not exceed 1 hour; within a scene, each advance may be a slow-motion advance of <5 minutes.
- **Active fast-forward**: when the player explicitly asks or the story requires, longer spans (days, weeks) may be advanced
- **Important events**: exact time points (such as exam time, date time)

**AI operation examples**:
```
<time|day|add|3>      // advance 3 days
<time|hour|set|14>    // set to 2 PM
<time|month|add|1>    // advance 1 month
```

**Handled automatically by the system**:
1. Advances time according to the parameter the AI specified
2. Automatically computes new values of all bound parameters
3. Updates computed parameters (such as weekday, season)
4. Triggers related time events

### Bound parameter notes

⚠️ **Only bound parameters can be operated on**:
- ✅ Operable: `year`, `month`, `day`, `hour`, `minute` (base parameters)
- ❌ Not operable: `weekday`, `season`, `period` (computed parameters, updated automatically)

### Full examples

**Scenario: advance to the next morning**

AI operation:
```
The next morning, you wake up and get ready for school.

<time|day|add|1>
<time|hour|set|7>
<time|minute|set|0>
```

System calculation:
```json
{
  "year": 2024,
  "month": 8,
  "day": 2,        // +1
  "hour": 7,       // set
  "minute": 0,     // set
  "weekday": 2,    // computed: Tuesday
  "season": 2,     // computed: summer
  "period": 0      // computed: morning
}
```

**Scenario: advance 3 months**

AI operation:
```
Time flies, and before you know it the final exam season has arrived.

<time|month|add|3>
<time|day|set|15>
```

System calculation:
```json
{
  "year": 2024,
  "month": 11,     // +3
  "day": 15,       // set
  "weekday": 5,    // computed: Friday
  "season": 3,     // computed: autumn
  "period": null   // keep current period
}
```

### Time information in the Prompt

The system shows the following in every Prompt:
1. **Current time** (in displayFormat)
2. **Time advancement hint** (if it changed)
3. **List of operable time parameters**

````markdown
```time_info
Current time: Monday, August 1, 2024, Wu hour
[Advanced since last conversation: +3 days]

Operable time parameters:
- <time|day|add|value>: advance days
- <time|month|add|value>: advance months
- <time|hour|set|value>: set the hour (0-23)
```
````

### Best practices

💡 **Recommended**:
1. **Reasonable time spans**: advance time as the story requires, avoiding going too fast or too slow
2. **Exact time points**: set exact times for important events (`<time|hour|set|14>`)
3. **Natural transitions**: state the time advancement in the narration ("the next morning", "a week later")

⚠️ **Notes**:
- Do not try to operate on computed parameters (the system rejects this automatically)
- The advanced time must fit the story logic
- Use `set` rather than `add` for important time points

---

## 3. Module Operation Format

### Format specification

```
<module|operation|moduleID>
```

### Supported operations

```
<module|enter|exam>        // enter a module
<module|complete|homework>  // complete a module
```

**Automatically converted by the system to**:
```json
{
  "action": "enter",
  "moduleId": "exam"
}
```

---

## 3b. Delivery Info Confirmation Format

### Format specification

```
<delivery|deliveryInfoTitle|done>        // confirm completed
<delivery|deliveryInfoTitle|uncompleted>  // mark uncompleted (still sent next time)
```

⚠️ **Delivery info logic**:
- **Before done**: the deliveryInfo is sent every time a Prompt is generated
- **After done**: no longer sent, and the module may be completed
- **uncompleted**: the AI considers it unfinished, and it continues to be sent next time

### Examples

**Scenario 1: confirm completed**
```
<delivery|Important Notice|done>
<delivery|Final Exam Schedule|done>
```

**Scenario 2: mark uncompleted**
```
<delivery|Homework Submission|uncompleted>  // the AI judges the homework unfinished and keeps reminding next time
```

**Automatically converted by the system to**:
```json
{
  "title": "Important Notice",
  "completed": true  // or false
}
```

---

## 4. Timeline Interruption Decision Format

### Format specification

```
<interrupt|decision>
```

### Supported decisions

```
<interrupt|continue>   // continue the current timeline
<interrupt|accept>     // accept the interruption, enter the new timeline
<interrupt|postpone>   // postpone the current timeline (can still trigger once its time comes)
<interrupt|skip>       // skip the current timeline (missed entirely, never triggers again)
```

⚠️ **skip vs postpone**:
- `skip`: the story actively skips it during progression (preconditions are already met, but, e.g., the user is late and cannot attend the specific event, or there is a conflicting matter, or similar real reasons); this is equivalent to completing it immediately
- `postpone`: the time has come but conditions are not met, or the current story situation requires postponing
- System default: time reached but conditions not met = automatic skip (usually the AI is not told)

**Examples**:
```
// Scenario 1: unaware of the match → skip (the AI is not told)
// Scenario 2: late and missed it → skip (the AI is told about the event and decides by itself)
// Scenario 3: conditions not met → postpone (let the AI choose the condition after postponement, changing the original module)
```

### postpone operation format

When the AI chooses `postpone`, it must provide a new trigger condition:

```
<interrupt|postpone|newCondition=time:day+3>             // postpone 3 days
<interrupt|postpone|newCondition=variable:score>=80>    // change to a score condition
<interrupt|postpone|newCondition=module:homework:completed>  // change to after homework is completed
```

**Automatically converted by the system to**:
```json
{
  "action": "postpone",
  "newCondition": {
    "type": "time",
    "offset": { "day": 3 }
  }
}
```

The system automatically modifies the original module's `entryConditions`.

**Automatically converted by the system to**:
```json
{
  "action": "continue"  // or "interrupt"
}
```

---

## 5. Plugin Reply Format

### Format specification

```
<plugin|pluginID|paramList>
```

### Examples

```
<plugin|chat_friend|response=Nice to meet you!,relationChange=5>
<plugin|battle_system|damage=50,critical=true>
```

**Automatically converted by the system to**:
```json
{
  "pluginId": "chat_friend",
  "data": {
    "response": "Nice to meet you!",
    "relationChange": 5
  }
}
```

---

## 6. Summary Generation Format

### Format specification

```
<summary|type|content>
```

### Supported types

```
<summary|global|summary of the main content of this conversation>
<summary|module|key progress of the current module>
<summary|module|parentModuleID|summary content>   (when summarizing for a parent module, e.g. at child module completion)
<summary|plugin|important plugin-related events>
```

**Automatically converted by the system to**:
```json
{
  "type": "global",
  "content": "summary of the main content of this conversation"
}
```

---

## 7. Prompt Generation Specification (7 Sections)

The Prompt generated automatically by the system is organized into the following 7 sections, sent to the AI in order.

⚠️ **Important**: The content of every section is wrapped in a block, so specific content can always be found.

### Section 1: Background

**Content**:
- Current time (in displayFormat)
- **Time change hint** (if time advanced since the last conversation)
- The current module's info content (filtered by condition)
- Parent modules' background info (according to scope rules)

**Example**:
````markdown
```background
Current time: Monday, August 1, 2024, Wu hour
[Time advanced: +3 days]

[Semester Start]
A new semester has begun, and you are a high school student.

[Math Course]
This semester's math course is quite difficult and requires serious study.
```
````

### Section 2: Interactors

**Content**:
- Prompts of all currently active interactive plugins
- Each plugin's blockId and reply format requirements
- Sorted by plugin priority

**Example**:
````markdown
```interactors
[Friend Chat] (blockId: chat_zhang_san)
You are chatting with Zhang San. Current affection: 60. Please reply as a friend.

Reply format: <plugin|chat_zhang_san|response=your reply,relationChange=value>
```
````

### Section 3: Current Variable State (Variables)

**Content**:
- Variable nature (type, current value, category)
- generalRules (overall guidance)
- **Concrete operation rules** (the full format requirements of supportedOperations)
- changeRules (rule names that can be called quickly)

**Example**:
````markdown
```variables
[Variables]
Score (number, module category)
  Current value: 75
  Rules: Score records the student's academic performance, range 0-100
  Supported operations:
    - add(value=number): increase score
    - subtract(value=number): decrease score
    - set(value=number): set score
  Shortcut rules:
    - <rule|score|Exam passed bonus>
    - <rule|score|Exam failed penalty>
    - <rule|score|Major achievement reward>

Friend List (list_of_object, module category)
  Current value: [Zhang San (affection 60), Li Si (affection 45)]
  Rules: The friend list records everyone the player knows and their relationship status
  Supported operations:
    - add_item(name=string, relation=number, tags=list): add a friend
    - modify_item(index=number, field=string, op=add|set, value=any): modify a friend field
    - remove_item(index=number): remove a friend
  Shortcut rules:
    - <rule|friends|Add new friend|name=Name>
    - <rule|friends|Increase affection|index=Index>
    - <rule|friends|Decrease affection|index=Index>
```
````

### Section 4: Module Queue and Available Operations (Module Queue)

The queue is how the current event module determines position and lets the AI know the progress; the queue contains only **events** (leaf nodes). The debug page and the Prompt use the following five queues:

| No. | Queue name | Description |
|------|----------|------|
| 1 | **Current queue** | Events that can be entered as soon as the current event is completed, with all preconditions already met. |
| 2 | **Expected queue** | Events for which, after the current event is completed, only variable-type conditions remain unmet (the unmet variable items are annotated). |
| 3 | **Possible queue** | Events whose variable conditions are met, but which would still need other events completed as preconditions even after the current event is completed. |
| 4 | **Sub-flow queue** | The sub-flows that can currently trigger (i.e. each sub-flow module's current queue). |
| 5 | **Completed modules** | The list of modules already completed. |

**Floating state**: When the current queue is empty after an event is completed, the system enters Floating mode: the current display is the parent module's name, meaning you are inside that module but not in any child event, until some condition is met and an event can be entered again.

**Section content**:
- **Current queue** (modules that have triggered and meet entry conditions)
- **Expected queue** (about to trigger but conditions unmet, annotating the missing conditions)
- Only triggered modules are sent, to prevent the AI from entering untriggered modules early

⚠️ **Important**: Only modules that meet entry/completion conditions show operation hints

**Example**:
````markdown
```queue
[Current queue] (can be acted on immediately)
- Homework Submission (free_trigger)
  Can complete: <module|complete|homework> (requires confirming deliveryInfo: "Homework completed")
  
- Extracurricular Activity (free_trigger)
  Can enter: <module|enter|activity>

[Expected queue] (conditions not met)
- Midterm Exam (timeline, January 15)
  Missing condition: time not reached
  
- Library Study (free_trigger)
  Missing condition: affection >= 50 (current: 45)
```
````

💡 **Untriggered modules**: not shown to the AI, to avoid premature operations

### Section 5: Pending Delivery Info (Delivery Info)

**Content**:
- **Uncompleted deliveryInfo** (sent every time until done)
- The deliveryInfo of the current module and parent modules
- **Confirmation format notes**

⚠️ **Sending logic**:
- Before done: sent with every Prompt
- After done: no longer sent
- uncompleted: continues to be sent next time

**Example**:
````markdown
```delivery
[Delivery info awaiting confirmation]
1. Important Notice
   Content: The midterm exam will be held next Monday
   Confirmation format: <delivery|Important Notice|done>
   
2. Homework Assignment
   Content: Complete math exercises 1-10
   Confirmation format: <delivery|Homework Assignment|done>
```
````

### Section 6: Expected Progress Hints (Expected Progress)

**Content**:
- Behavior suggestions generated by the system from the current state
- Hints about the operation types the AI may use

**Example**:
```
[Operation hints]
You may:
1. Call a variable rule: <rule|variableID|ruleName|params>
2. Enter a new module: <module|enter|moduleID>
3. Complete the current module: <module|complete|moduleID>
4. Confirm delivery info: <delivery|title|done>
5. Reply to a plugin: <plugin|pluginID|params>
6. Create foreshadowing/to-do: <foreshadow|title|description|triggerCondition>
```

### AI-created foreshadowing and delivery info

💡 **Core mechanism**: The AI can plant foreshadowing or record unfinished matters by creating delivery info

**Use cases**:
- **Foreshadowing**: something mentioned in dialogue that will happen in the future
- **To-do**: something the player wants to do but has not yet done
- **Reminder**: information that must remind the player under specific conditions

**AI operation format**:
```
<foreshadow|title|description|triggerCondition>
```

**Examples**:
```
// Scenario 1: an NPC mentions something important next month
<foreshadow|Agreement with a Mysterious Person|Zhang San mentioned he will introduce an important person to you on the 1st of next month|time:day>=30>

// Scenario 2: the player wants to join a competition but doesn't qualify yet
<foreshadow|Math Competition Registration|A score of 80 is required to register for the math competition|variable:score>=80>

// Scenario 3: a reminder about missed story content
<foreshadow|Library Closed|The library is closed every Sunday; remember to go on other days|time:weekday!=0>
```

**Automatically converted by the system to**:
```json
{
  "type": "conditional_delivery",
  "title": "Agreement with a Mysterious Person",
  "content": "Zhang San mentioned he will introduce an important person to you on the 1st of next month",
  "condition": [
    {
      "type": "time",
      "check": "day >= 30"
    }
  ],
  "autoComplete": false
}
```

**Behavior after triggering**:
- Once the condition is met, it is sent to the AI as deliveryInfo
- The AI may confirm (<delivery|title|done>) or mark it uncompleted
- After confirmation it is no longer sent repeatedly



### Section 7: Process Info (Process Info)

**Content**:
- **Operation summary**: the most recent N operation records (configurable, e.g. the last 5)
- **Module summaries**: summaries of related modules (according to scope rules)
- **Global summary**: the compressed history summary

**Example**:
```
[Recent operations]
1. <rule|score|Exam passed bonus>
2. <module|complete|homework>
3. <delivery|Important Notice|done>
4. <rule|friends|Increase affection|index=0>
5. <module|enter|exam>

[Module summaries]
[Math Course] Completed 3 homework assignments; score rose from 60 to 75

[Global summary]
Since the semester began, the focus has mainly been on studies. The relationship with Zhang San has gradually improved.
```

---

## 8. Prompt Injection Depth and Order

### Injection rules

⚠️ **Depth control**: The content injected into each section has a depth limit

**Section 1 (Background)**:
- Current module info: all sent
- Parent module info: only info marked "persistent" is sent
- Traces back at most 3 levels of parent modules

**Section 3 (Variable state)**:
- Only variables within the current scope are sent
- generalRules: all sent
- changeRules: only the list of rule names is sent (concrete values are not sent)

**Section 7 (Process info)**:
- Operation summary: controlled by a config parameter (e.g. the last 5)
- Module summaries: sibling modules under the same parent send to each other; across parents only the parent's summary is sent
- Global summary: sent according to the compression config

### Combining with writing guidance

💡 **Writing guidance**: Entries the user adds or imports on the debug page are injected after section 6 and before section 7; when there are no entries, this part is not sent. The two notes on reply format and summary format are always sent with the prompt, because the parser depends on them.

**Injection order** (complete):
1. Background
2. Interactors
3. Current variable state
4. Available module operations
5. Pending delivery info
6. Expected progress hints
7. **Writing guidance** (entries added by the user)
8. Process info

---

## 9. Full AI Reply Examples

### Scenario: a student finishes an exam

**AI reply**:
```
The exam is over! You did quite well.

<rule|score|Exam passed bonus>
<delivery|Midterm Exam|done>
<summary|module|Completed the midterm exam; score improved>
<module|complete|midterm_exam>
```

**System parsing result**:
1. Variable operation: `score.add(10)`
2. Delivery info confirmation: "Midterm Exam" marked completed
3. Generate a module summary
4. Module operation: complete the "midterm_exam" module

### Scenario: interacting with an NPC (plugin)

**AI reply**:
```
Zhang San smiles and says to you: "Nice to meet you! How have your studies been lately?"

<plugin|chat_zhang_san|response=Nice to meet you! How have your studies been lately?,relationChange=5>
<rule|friends|Increase affection|index=0>
```

**System parsing result**:
1. Plugin reply: records the conversation, affection +5
2. Variable operation: affection of index=0 in the friends list +10

---

## 10. Summary of General Rules

⚠️ **The AI must follow**:

1. **Unified format**: all commands use the `<type|param1|param2|...>` format
2. **Parameter separation**: use the vertical bar `|` to separate main parameters and the comma `,` to separate sub-parameters
3. **Prefer rules**: wherever changeRules apply, prefer `<rule|...>`
4. **Multiple commands at once**: multiple tags may be output in one reply
5. **Natural language + commands**: narrative text and command tags may be mixed

💡 **Best practices**:
- Narration first, commands after
- Put each command on its own line (easier to parse)
- Use semantic rule names (rather than operating directly)

---

**Document version**: 1.0
**Last updated**: 2026-02-05
