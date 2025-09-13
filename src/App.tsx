import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useCopilotMessagesContext, useCopilotChat } from "@copilotkit/react-core";
import { ActionExecutionMessage, ResultMessage, TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";
import "@copilotkit/react-ui/styles.css";
import { useEffect, useRef } from "react";
import { useLemonsAPI } from "./hooks/useLemonsAPI";

// Move the component logic inside CopilotKit provider
function ChatWithPersistence() {
  const { messages, setMessages } = useCopilotMessagesContext();
  const chat = useCopilotChat();
  // Programmatic chat API isn't available in this version; we'll use setMessages fallback.
  
  // Initialize Lemons API functions
  const { activeService, refreshServiceInfo } = useLemonsAPI() as any;
  const lastHandledMsgId = useRef<string | null>(null);

  // save to local storage when messages change
  useEffect(() => {
    if (messages.length !== 0) {
      localStorage.setItem("copilotkit-messages", JSON.stringify(messages));
    }
  }, [JSON.stringify(messages)]);

  // On every new user message: always try to attach fresh service context for this turn
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
      if (sid && refreshServiceInfo) {
        // Inject an action execution + result so context is explicitly attached in this turn
        const execId = `exec-getServiceById-${Date.now()}`;
        const now = new Date().toISOString();
        // Add ActionExecutionMessage immediately
        setMessages((prev: any[]) => [
          ...prev,
          new ActionExecutionMessage({
            id: execId,
            name: 'getServiceById',
            scope: 'default',
            arguments: { serviceId: sid },
            createdAt: now,
          }),
        ]);
        // Fetch and then add ResultMessage when done
        (async () => {
          const res = await refreshServiceInfo(sid);
          setMessages((prev: any[]) => [
            ...prev,
            new ResultMessage({
              id: `res-${execId}`,
              actionExecutionId: execId,
              actionName: 'getServiceById',
              result: JSON.stringify(res ? { success: true, service: res.service, packages: res.packages } : { success: false, message: 'Fetch failed' }),
              createdAt: new Date().toISOString(),
            }),
          ]);
        })();
      }
    }
    lastHandledMsgId.current = last?.id ?? null;
    // we rely on messages changing to re-run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeService?._id]);

  // Listen for search queries from the Bubble parent via postMessage
  useEffect(() => {
    console.debug('[Lemons iframe] Message listener mounting. App origin:', window.location.origin);
    // Notify parent that iframe is ready (optional for debugging)
    try {
      const ready = { type: 'LEMONS_IFRAME_READY', origin: window.location.origin } as const;
      try { window.top?.postMessage(ready, '*'); } catch {}
      try { window.parent?.postMessage(ready, '*'); } catch {}
    } catch (e) {
      // ignore
    }
    function handler(e: MessageEvent) {
      const d = e.data as any;
      if (!d || typeof d !== 'object') {
        console.debug('[Lemons iframe] Ignored message: not an object', e.data, 'from', e.origin);
        return;
      }
      // SEARCH_QUERY: { type: 'SEARCH_QUERY', query: string }
      if (d.type === 'SEARCH_QUERY' && typeof d.query === 'string' && d.query.trim()) {
        console.debug('[Lemons iframe] Received SEARCH_QUERY', { query: d.query }, 'from', e.origin, '→ add & submit');
        const now = new Date().toISOString();
        const q = String(d.query).trim();
        // Preferred: append via chat API (triggers assistant)
        try {
          if (chat && typeof (chat as any).appendMessage === 'function') {
            (chat as any).appendMessage(new TextMessage({ role: MessageRole.User, content: q }))
              .catch((err: any) => console.debug('[Lemons iframe] appendMessage failed', err));
            return;
          }
        } catch (err) {
          console.debug('[Lemons iframe] useCopilotChat unavailable, falling back', err);
        }
        // Fallback: append directly (may rely on auto-run in some versions)
        setMessages((prev: any[]) => [
          ...prev,
          new TextMessage({ id: `ext-q-${Date.now()}`, role: MessageRole.User as any, content: q, createdAt: now }),
        ]);
      } else {
        console.debug('[Lemons iframe] Ignored message: wrong shape', d, 'from', e.origin);
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [chat, setMessages]);
   
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
Service ID: When we say serviceId, we mean the Bubble object unique ID (_id) for a service. It is provided either via the iframe URL parameter (?serviceId=...) or by the parent app via postMessage events (ACTIVE_SERVICE / ACTIVE_SERVICE_ID).
If the user asks for a better service title:
1. Propose a concise, compelling title (<= 80 chars).
2. If the user accepts OR clearly asks you to apply it, call updateServiceTitle with serviceId and newTitle.
3. Do NOT restate service fields after updating; rely on the UI.
Whenever the user includes a service id in their message (or mentions the active service changed), first call getServiceById with that id to fetch the latest details and attach them to context as active_service and active_service_packages. Then proceed with any follow-up.
After you run any copilot action that mutates data (e.g., updateServiceTitle, updateServiceCategory, updateServiceDescription, updatePackage), call getServiceById again with the same serviceId to ensure the context reflects the server state for subsequent turns.
If the user asks to change the category, map their input to one of allowed_categories (case-insensitive). If it matches, call updateServiceCategory with serviceId and the matched label. If it doesn’t match, ask them to choose from allowed_categories.
Packages: Packages are separate Bubble records linked to a service; their description field is named package_description. Use listPackagesForService to read them, getPackageById to fetch one, and updatePackage to change fields (e.g., title, package_description, price, delivery_days). Avoid creating or deleting packages for now.
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