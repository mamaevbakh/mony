import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useCopilotMessagesContext } from "@copilotkit/react-core";
import { ActionExecutionMessage, ResultMessage, TextMessage } from "@copilotkit/runtime-client-gql";
import "@copilotkit/react-ui/styles.css";
import { useEffect, useRef } from "react";
import { useLemonsAPI } from "./hooks/useLemonsAPI";

// Move the component logic inside CopilotKit provider
function ChatWithPersistence() {
  const { messages, setMessages } = useCopilotMessagesContext();
  
  // Initialize Lemons API functions
  const { activeService, refreshServiceInfo } = useLemonsAPI() as any;
  const lastHandledMsgId = useRef<string | null>(null);

  // save to local storage when messages change
  useEffect(() => {
    if (messages.length !== 0) {
      localStorage.setItem("copilotkit-messages", JSON.stringify(messages));
    }
  }, [JSON.stringify(messages)]);

  // On every new user message: if it contains a service id, refresh latest data
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    const last = messages[messages.length - 1] as any;
    if (!last || last.id === lastHandledMsgId.current) return;
    // Only react to human/user messages
    if (last?.type === "TextMessage" && (last.role === "user" || last.role === "human")) {
      const text: string = last.content || "";
      // naive service id detection: 32-char or 24-char hex-ish bubble ids
      const idMatch = text.match(/[a-f0-9]{24,36}/i);
      const sid = idMatch?.[0] || activeService?._id;
      if (sid) {
        // fire and forget; keep chat responsive
        refreshServiceInfo?.(sid);
      }
    }
    lastHandledMsgId.current = last?.id ?? null;
    // we rely on messages changing to re-run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeService?._id]);
   
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
Whenever the user includes a service id in their message (or mentions the active service changed), first call getServiceById with that id to fetch the latest details and attach them to context as active_service. Then proceed with any follow-up.
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