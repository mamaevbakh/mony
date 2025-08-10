import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export default function App() {
  return (
    <CopilotKit
      publicApiKey="ck_pub_b8bc3bc0d4bb904acbf9e22e0dbee161"
    >
      <div style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        background: "white", // change to transparent if you want Bubble's BG
      }}>
        <CopilotChat
          instructions="You are a helpful assistant embedded in Bubble. Be concise unless asked for details."
        />
      </div>
    </CopilotKit>
  );
}