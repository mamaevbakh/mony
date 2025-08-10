import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

export default function App() {
  return (
    <CopilotKit publicApiKey="ck_pub_b8bc3bc0d4bb904acbf9e22e0dbee161">
      
        <CopilotChat
        
          labels={{
            initial: "Hi! 👋 How can I assist you today?",
          }}
          instructions="You are a helpful assistant embedded in Bubble."

        />
    </CopilotKit>
  );
}