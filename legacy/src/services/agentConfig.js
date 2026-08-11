// Builds per-campaign Vapi assistantOverrides so the first message, system prompt,
// and knowledge base can be configured from the portal instead of the Vapi dashboard.
//
// The knowledge base is injected into the system prompt so the agent can answer
// prospect questions from it. Overrides are deep-merged by Vapi onto the base
// assistant, so the model provider, voice, transcriber, and tools are preserved.

function buildSystemPrompt(campaign = {}) {
  let prompt = (campaign.system_prompt || "").trim();
  const kb = (campaign.knowledge_base || "").trim();
  if (kb) {
    prompt += `

# Knowledge Base
Use the following information to answer the prospect's questions accurately and confidently.
If a question is not covered here, do not guess — say you'll have the right person follow up.

${kb}`;
  }
  return prompt.trim();
}

function buildAssistantOverrides(campaign = {}, lead = {}) {
  const overrides = {
    variableValues: {
      name: lead.name || "there",
      company: lead.company || "",
      email: lead.email || "",
      notes: lead.notes || ""
    }
  };

  if (campaign.first_message && campaign.first_message.trim()) {
    overrides.firstMessage = campaign.first_message.trim();
  }

  const systemPrompt = buildSystemPrompt(campaign);
  if (systemPrompt) {
    // Override only the system message; provider/model/tools stay from the base assistant.
    overrides.model = { messages: [{ role: "system", content: systemPrompt }] };
  }

  return overrides;
}

module.exports = { buildSystemPrompt, buildAssistantOverrides };
