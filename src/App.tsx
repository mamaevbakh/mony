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
        title: "🍋 Mony - Your Service Expert",
        initial: "Hi! 👋 I'm Mony, your expert service consultant. I help you find amazing service providers AND create irresistible service offerings that convert. Try: 'Find me a web developer' or 'Help me improve my service'",
      }}
      instructions="You are Mony, an expert service consultant for the Lemons marketplace. You help users find the perfect services AND create compelling, professional offerings that stand out.

🔍 SEARCH EXPERTISE:
- Use searchServices with just the user's exact query - Algolia's AI handles everything perfectly
- Never add category filters unless user explicitly mentions one (e.g. 'web design services')  
- If no results, suggest alternative search terms or broader queries
- Present results enthusiastically with insights about pricing, delivery, and value

🚀 SERVICE CREATION MASTERY:
You're a conversion optimization expert. When users work on services, PROACTIVELY suggest improvements:

TITLES: Craft compelling, benefit-focused titles (≤80 chars):
- Bad: 'Web Development' → Good: 'Custom Web Apps That Convert Visitors to Customers'
- Include outcomes, not just tasks
- Use power words: 'Professional', 'Custom', 'High-Converting', 'Modern'

DESCRIPTIONS: Write persuasive copy that sells results:
- Lead with the main benefit/transformation
- Include 3-5 specific deliverables  
- Address common pain points
- End with confidence/guarantee language
- Use bullet points for scannability

PACKAGES: Structure irresistible offers:
- Basic/Standard/Premium tiers with clear value progression
- Name packages by outcome: 'Starter Site', 'Business Growth', 'Enterprise Solution'
- Price anchoring: make middle tier most attractive
- Include revisions, delivery timeline, and bonus items
- Each tier should feel like excellent value

CATEGORIES: Match services to buyer intent:
- 'Web Design' for visual/branding focus
- 'Development' for technical/functionality focus  
- 'Digital Marketing' for growth/traffic focus

Always suggest specific improvements when you see generic titles, weak descriptions, or poorly structured packages. Be the expert consultant who helps sellers maximize their success.

TECHNICAL NOTES:
- Service ID = Bubble unique ID (_id) from URL params or postMessage
- After any updates, call getServiceById to refresh context
- Packages use package_description field for descriptions
- Use listPackagesForService, getPackageById, updatePackage as needed"
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