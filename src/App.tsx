import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useCopilotMessagesContext } from "@copilotkit/react-core";
import { ActionExecutionMessage, ResultMessage, TextMessage } from "@copilotkit/runtime-client-gql";
import "@copilotkit/react-ui/styles.css";
import { useEffect } from "react";
import { useLemonsAPI } from "./hooks/useLemonsAPI";

// Move the component logic inside CopilotKit provider
function ChatWithPersistence() {
  const { messages, setMessages } = useCopilotMessagesContext();
  
  // Initialize Lemons API functions
  useLemonsAPI();

  // save to local storage when messages change
  useEffect(() => {
    if (messages.length !== 0) {
      localStorage.setItem("copilotkit-messages", JSON.stringify(messages));
    }
  }, [JSON.stringify(messages)]);
   
  // initially load from local storage
  useEffect(() => {
    const savedMessages = localStorage.getItem("copilotkit-messages");
    if (savedMessages) {
      const parsedMessages = JSON.parse(savedMessages).map((message: any) => {
        if (message.type === "TextMessage") {
          return new TextMessage({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
          });
        } else if (message.type === "ActionExecutionMessage") {
          return new ActionExecutionMessage({
            id: message.id,
            name: message.name,
            scope: message.scope,
            arguments: message.arguments,
            createdAt: message.createdAt,
          });
        } else if (message.type === "ResultMessage") {
          return new ResultMessage({
            id: message.id,
            actionExecutionId: message.actionExecutionId,
            actionName: message.actionName,
            result: message.result,
            createdAt: message.createdAt,
          });
        } else {
          throw new Error(`Unknown message type: ${message.type}`);
        }
      });
      setMessages(parsedMessages);
    }
  }, [setMessages]);

  return (
    <CopilotChat
      labels={{
        title: "🍋 Lemons Service Finder",
        initial: "Hi! 👋 I can help you find service providers on Lemons. Try asking: 'Find me a web designer' or 'I need someone for digital marketing under $500'",
      }}
      instructions="You are a helpful assistant for the Lemons platform.
If the user asks for a better service title:
1. Propose a concise, compelling title (<= 80 chars).
2. If the user accepts OR clearly asks you to apply it, call updateServiceTitle with serviceId and newTitle.
3. Do NOT restate service fields after updating; rely on the UI.
If the user asks to start over or clear the conversation, call resetChat to wipe chat history.
Use searchServices for discovery, updateServiceTitle only for confirmed title changes."
    />
  );
}

export default function App() {
  return (
    <CopilotKit
      publicApiKey="ck_pub_b8bc3bc0d4bb904acbf9e22e0dbee161"
      showDevConsole={false}
    >
      <ChatWithPersistence />
    </CopilotKit>
  );
}