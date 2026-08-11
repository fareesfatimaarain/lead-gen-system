require("dotenv").config();

const { createAssistant } = require("../src/services/vapiAssistant");

createAssistant().catch((error) => {
  console.error("Setup assistant script failed:", error);
  process.exitCode = 1;
});
