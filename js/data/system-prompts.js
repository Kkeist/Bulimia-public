/**
 * 系统内置通用 prompt 模板（无任何模组内容，仅格式与占位符）
 * 占位符由调用方替换：{{worldBookText}} {{npcInfo}} {{replyTag}} {{replyFormat}} {{user}} 等
 */
const SYSTEM_PROMPTS = {
    /** 变量块：系统只发送可修改的变量与可用操作，不向 AI 发送「禁止/只能」类表述。{{operationsList}} 由调用方按模组 timeUnits 等生成可用操作列表；{{rulesSection}} 为可修改变量及规则。 */
    variable_operations_instruction: I18n.pick({
        zh: `<variables> 块内每行：变量名\\t操作(参数)。可用的变量操作如下：
{{operationsList}}
{{rulesSection}}`,
        en: `Each line inside the <variables> block: variable name\\toperation(parameter). The available variable operations are:
{{operationsList}}
{{rulesSection}}`
    }),

    /** 可修改的变量及规则（仅占位符 {{rulesText}}，只包含可修改项）。 */
    variable_change_rules_section: I18n.pick({
        zh: `
## 可修改的变量及规则
{{rulesText}}`,
        en: `
## Modifiable variables and rules
{{rulesText}}`
    }),

    /** 投递信息：自然融入剧情；完成后须在 <delivery_completed> 块内写「投递标题\t完成」。{{deliveryList}} 由调用方注入待投递条目（标题、正文）。 */
    delivery_info_instruction: I18n.pick({
        zh: `以下为需要在本轮或后续剧情中自然透露的**投递信息**。不要生硬复读，用符合剧情与语气的叙述融入。完成后须在回复的 <delivery_completed> 和 </delivery_completed> 块内写：该投递标题\\t完成；未完成则写 标题\\t未完成。

【投递信息列表】
{{deliveryList}}`,
        en: `Below is the **delivery information** that should be revealed naturally in this turn or in later story. Do not repeat it stiffly; weave it into the narration in a way that fits the plot and tone. When done, inside the <delivery_completed> and </delivery_completed> block of your reply write: the delivery title\\tdone; if not done, write title\\tnot done.

[Delivery list]
{{deliveryList}}`
    }),

    npc_intro: I18n.pick({
        zh: `请根据下面提供的 NPC 信息，在剧情中自然地引入该角色（通过相遇、对话、他人提及等方式），不要机械念稿。

【NPC 信息】
{{npcInfo}}`,
        en: `Based on the NPC information below, introduce this character naturally into the story (through an encounter, dialogue, being mentioned by others, etc.). Do not recite it mechanically.

[NPC info]
{{npcInfo}}`
    }),

    /** 时间线事件（默认）：将事件内容自然融入本轮剧情 */
    timeline_event: I18n.pick({
        zh: `以下为当前时间线触发的剧情事件，请在回复中自然融入，不要机械复读。

【事件】
{{eventContent}}`,
        en: `Below is the story event triggered by the current timeline. Weave it naturally into your reply; do not repeat it mechanically.

[Event]
{{eventContent}}`
    }),

    /** 交互器回复（通用）：按模组提供的前情提要/要求生成回复，使用模组内的 prompt 作为「以下要求」 */
    interactor_reply: I18n.pick({
        zh: `与以下角色互动时，请按照以下要求给出回复，并在回复中单独写出 **<{{replyTag}}>** 块，块内每行格式：**{{replyFormat}}**。系统会解析该块并写入交互记录。

【以下要求】（由模组提供）
{{interactorRequirement}}

【本次交互对象】
{{pendingTargets}}

【暂存消息】
{{pendingMessages}}`,
        en: `When interacting with the following characters, reply according to the requirements below, and write a separate **<{{replyTag}}>** block in your reply; each line inside the block uses the format: **{{replyFormat}}**. The system will parse this block and write it into the interaction log.

[Requirements below] (provided by the module)
{{interactorRequirement}}

[Interaction targets this time]
{{pendingTargets}}

[Queued messages]
{{pendingMessages}}`
    }),

    random_pool_generate: I18n.pick({
        zh: `{{randomPoolUsage}}

【随机结果】
{{randomSeed}}

请按上述要求生成并输出，系统会解析并存回。`,
        en: `{{randomPoolUsage}}

[Random result]
{{randomSeed}}

Generate and output according to the requirements above; the system will parse it and store it back.`
    }),

    /** 模组未提供开场白时使用的系统预设 */
    opening_default: I18n.pick({
        zh: `用户发送了「开始游戏」作为第一条消息。请根据以下模组介绍写一段开场白。要求：1）用叙述体，把 {{user}} 自然带入当前世界；2）长度适中，一段到两段；3）不要复读介绍，用具体场景或细节开场；4）正文用 <content> 包裹。

【模组介绍】
{{introText}}`,
        en: `The user sent "Start game" as the first message. Write an opening based on the module introduction below. Requirements: 1) use a narrative style that naturally brings {{user}} into the current world; 2) moderate length, one to two paragraphs; 3) do not repeat the introduction, open with concrete scenes or details; 4) wrap the body text in <content>.

[Module introduction]
{{introText}}`
    }),

    /** 模组通用规则（已清空，待重构后恢复） */
    bulimia_main_instruction: ''
};

/**
 * 根据 id 取模板并替换占位符
 * @param {string} id - delivery_info_instruction | npc_intro | interactor_reply | variable_operations_instruction（可传 rulesSection）| opening_default 等
 * @param {Record<string, string>} data - 占位符键值
 */
function getSystemPrompt(id, data = {}) {
    const tpl = SYSTEM_PROMPTS[id];
    if (!tpl) return '';
    let out = tpl;
    for (const [k, v] of Object.entries(data)) {
        out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v ?? ''));
    }
    return out;
}

if (typeof window !== 'undefined') {
    window.SYSTEM_PROMPTS = SYSTEM_PROMPTS;
    window.getSystemPrompt = getSystemPrompt;
}
