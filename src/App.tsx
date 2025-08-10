import { useMemo } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export default function App() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const userId = q.get("userId") ?? "guest";
  const caseId = q.get("caseId") ?? "";

  const instructions = `You are a helpful assistant embedded in a Bubble app.
User: ${userId}
Case: ${caseId || "N/A"}
Be concise unless asked for detail.`;

  return (
    <CopilotKit
      publicApiKey="ck_pub_b8bc3bc0d4bb904acbf9e22e0dbee161"  // <-- put your Copilot Cloud public key
    >
      {/* Floating launcher + chat panel */}
      <CopilotPopup
        instructions={instructions}
        labels={{ title: "Copilot", initial: "Hello! How can I help?" }}
        defaultOpen={true}
        />
    </CopilotKit>
  );
}