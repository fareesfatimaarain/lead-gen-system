require("dotenv").config();

const port = process.env.PORT || 3000;

const payload = {
  message: {
    type: "end-of-call-report",
    call: {
      id: `test-call-${Date.now()}`
    },
    artifact: {
      transcript:
        "AI: Hi, this is Alex calling about your inquiry. How can I help?\nUser: We are looking for a solution this month and need pricing.\nAI: Are you the decision maker for this purchase?\nUser: Yes, I own the budget. We can move quickly if the pricing works.\nAI: Great, I can connect you with someone for pricing and next steps.",
      messages: [
        { role: "assistant", message: "Hi, this is Alex calling about your inquiry. How can I help?" },
        {
          role: "user",
          message: "We are looking for a solution this month and need pricing."
        },
        { role: "assistant", message: "Are you the decision maker for this purchase?" },
        {
          role: "user",
          message: "Yes, I own the budget. We can move quickly if the pricing works."
        }
      ]
    },
    summary:
      "The lead is the decision maker, has budget, wants pricing, and is ready to move this month."
  }
};

async function run() {
  const response = await fetch(`http://localhost:${port}/webhook/end-of-call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json();
  console.log("Webhook status:", response.status);
  console.log("Classification result:", body.classification || body);

  if (!response.ok) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Test webhook script failed:", error);
  process.exitCode = 1;
});
