import { defineConfig } from "deepsec/config";
import { generatedMatchersPlugin } from "./generated-matchers.js";

export default defineConfig({
  defaultModel: "claude-opus-4-8", // <deepsec:default-model>
  defaultAgent: "claude-agent-sdk", // <deepsec:default-agent>
  ai: {"mode":"direct","provider":"anthropic","apiKeyEnv":"DEEPSEC_ANTHROPIC_API_KEY"}, // <deepsec:model-route>
  projects: [
    { id: "voco", root: ".." },
    // <deepsec:projects-insert-above>
  ],
  plugins: [generatedMatchersPlugin],
});
