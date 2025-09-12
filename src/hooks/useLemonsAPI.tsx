import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { useEffect, useState } from "react";

// Service interface based on your Bubble fields
interface Service {
  _id: string;
  title: string;
  price: number;
  delivery_days: number;
  description: string;
  category?: string;
  "Created Date"?: string;
  "Modified Date"?: string;
}

export function useLemonsAPI() {
  // Token (consider moving to env: VITE_BUBBLE_TOKEN)
  const BUBBLE_TOKEN = (import.meta as any)?.env?.VITE_BUBBLE_TOKEN || '67205b2400911e48fdfd7e7ea9cac75c';
  const BUBBLE_BASE = "https://lemonslemons.co/version-test";

  // Allowed categories (adjust to match Bubble field options)
  // Allowed categories as provided by Bubble (case-insensitive match in handler)
  const ALLOWED_CATEGORIES = [
    'Branding & Identity',
    'Web Design',
    'Digital Marketing',
    'Content Creation',
    'Photography',
    'Video Production',
    'Writing & Copywriting',
    'Business Consulting',
    'Development',
    'Other',
  ] as const;

  // Expose categories to the LLM so it knows the allowed values
  useCopilotReadable({
    value: JSON.stringify(ALLOWED_CATEGORIES),
    description:
      'allowed_categories: JSON array of valid service categories for updates. Use these exact labels (case-insensitive).',
  });

  // Track active service (selected locally or provided by Bubble parent)
  const [activeService, setActiveService] = useState<Service | null>(null);

  // Fetch the latest service data by id and update state
  const refreshServiceInfo = async (serviceId?: string) => {
    const id = serviceId || activeService?._id;
    if (!id) return null;
    try {
      const url = `${BUBBLE_BASE}/api/1.1/obj/service/${id}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${BUBBLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
      const data = await res.json().catch(() => null as any);
      const svc: any = data?.response ?? data ?? null;
      if (svc && svc._id) {
        setActiveService(svc as Service);
        try { window.parent?.postMessage({ type: 'SERVICE_CHANGED', serviceId: id }, '*'); } catch {}
        return svc as Service;
      }
      return null;
    } catch {
      return null;
    }
  };

  // Expose active service to LLM
  useCopilotReadable({
    value: activeService ? JSON.stringify(activeService) : 'null',
    description: 'active_service: Currently selected service JSON. Prefer this as the source of truth after calling getServiceById.',
  });

  // Read serviceId from iframe query param (?serviceId=xyz) and fetch immediately
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('serviceId');
    if (sid) {
      // fetch the real record right away
      refreshServiceInfo(sid);
    }
  }, []);

  // Listen for postMessages from Bubble parent
  useEffect(() => {
    function handler(e: MessageEvent) {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      // Optionally restrict origin: if (e.origin !== 'https://your-bubble-domain') return;
      if (d.type === 'ACTIVE_SERVICE' && d.service?._id) {
        setActiveService(d.service);
      } else if (d.type === 'ACTIVE_SERVICE_ID' && d.id) {
        // fetch the real record for the provided id
        refreshServiceInfo(d.id);
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // searchServices action
  useCopilotAction({
    name: "searchServices",
    description: "Search for service providers on Lemons platform. Use this when users ask about finding professionals like web designers, developers, marketers, consultants, etc.",
    parameters: [
      { name: "serviceType", type: "string", description: "The type of service or person to search for (e.g., 'web designer', 'web developer', 'marketing', 'consulting')", required: false },
      { name: "maxPrice", type: "number", description: "Maximum price filter for services", required: false },
      { name: "maxDeliveryDays", type: "number", description: "Maximum delivery days filter", required: false },
      { name: "limit", type: "number", description: "Maximum number of results to return (default: 10)", required: false }
    ],
    handler: async ({ serviceType, maxPrice, maxDeliveryDays, limit = 10 }) => {
      try {
        const constraints: any[] = [];
        if (serviceType) {
          constraints.push({ key: 'title', constraint_type: 'text contains', value: serviceType });
        }
        if (maxPrice) constraints.push({ key: 'price', constraint_type: 'less than', value: maxPrice.toString() });
        if (maxDeliveryDays) constraints.push({ key: 'delivery_days', constraint_type: 'less than', value: maxDeliveryDays.toString() });
        const baseUrl = "https://lemonslemons.co/version-test/api/1.1/obj/service";
        const params = new URLSearchParams();
        if (constraints.length) params.append('constraints', JSON.stringify(constraints));
        params.append('limit', limit.toString());
        params.append('sort_field', 'price');
        params.append('descending', 'false');
        const url = `${baseUrl}?${params.toString()}`;
        const response = await fetch(url, {
          method: 'GET',
            headers: {
              'Authorization': `Bearer ${BUBBLE_TOKEN}`,
              'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error(`API call failed: ${response.status} ${response.statusText}`);
        const data = await response.json();
        const services: Service[] = data.response?.results || [];
        return { success: true, services, searchCriteria: { serviceType, maxPrice, maxDeliveryDays, limit }, displayOnly: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', message: 'Sorry, I could not search services right now.' };
      }
    },
    render: ({ status, args, result }) => {
      if (status === 'executing') {
        return (
          <div style={{ padding: '16px', textAlign: 'center', backgroundColor: '#f9f8f5', borderRadius: '12px', border: '0.56px solid #e2e8d9' }}>
            <div style={{ display: 'inline-block', width: '24px', height: '24px', border: '3px solid #f3f3f3', borderTop: '3px solid #10b981', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <p style={{ marginTop: '12px', color: '#64748b', margin: '12px 0 0 0' }}>Searching for {args?.serviceType || 'services'}...</p>
          </div>
        );
      }
      if (status === 'complete' && result?.success) return <ServiceResults services={result.services} searchCriteria={result.searchCriteria} activeServiceId={activeService?._id} />;
      if (status === 'complete' && !result?.success) {
        return (
          <div style={{ padding: '16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626' }}>
            ❌ {result?.message || 'It seems we are having problems, we will fix them soon!'}
          </div>
        );
      }
      return <div />;
    }
  });

  // getServiceById: fetch service and attach to context
  useCopilotAction({
    name: 'getServiceById',
    description: 'Fetch the latest service details from Bubble by unique id and attach them to context as active_service.',
    parameters: [
      { name: 'serviceId', type: 'string', description: 'Bubble unique ID (_id) of the service to fetch', required: true },
    ],
    handler: async ({ serviceId }: { serviceId: string }) => {
      const svc = await refreshServiceInfo(serviceId);
      if (!svc) {
        return { success: false, message: 'Could not fetch the service. Please check the id.' };
      }
      return { success: true, service: svc };
    },
    render: () => "",
  });

  // updateServiceTitle (serviceId optional)
  useCopilotAction({
    name: 'updateServiceTitle',
    description: 'Update the title of an existing service in Bubble once a new improved title has been chosen.',
    parameters: [
      { name: 'serviceId', type: 'string', description: 'Bubble unique ID (_id) of the service to update. If omitted, use active_service._id.', required: false },
      { name: 'newTitle', type: 'string', description: 'The new finalized title to set on the service', required: true }
    ],
    handler: async ({ serviceId, newTitle }) => {
      const resolvedId = serviceId || activeService?._id;
      if (!resolvedId) {
        return { success: false, message: 'No service selected. Please select a service or provide serviceId.' };
      }
      try {
        const res = await fetch(`https://lemonslemons.co/version-test/api/1.1/obj/service/${resolvedId}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${BUBBLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle })
        });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`Update failed ${res.status}: ${t}`);
        }
        const len = res.headers.get('content-length');
        if (len && len !== '0') { await res.text().catch(() => ''); }
        try { window.parent?.postMessage({ type: 'SERVICE_UPDATED', serviceId: resolvedId, title: newTitle }, '*'); } catch {}
        setActiveService(prev => prev && prev._id === resolvedId ? { ...prev, title: newTitle } : prev);
        return { success: true, serviceId: resolvedId, newTitle, message: `Title updated to "${newTitle}".` };
      } catch (e: any) {
        return { success: false, error: e.message || 'Unknown error', message: 'Could not update the service title.' };
      }
    },
    render: ({ status, result }) => {
      if (status === 'executing') {
        return (
          <div
            style={{
              padding: 12,
              background: '#F2E6D9',
              color: '#000000',
              border: '1px solid #E4D9CD',
              borderRadius: 24,
              fontSize: 14,
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span aria-hidden>⏳</span>
            <span>Updating title…</span>
          </div>
        );
      }
      if (status === 'complete' && result?.success) {
        return (
          <div
            style={{
              padding: 12,
              background: '#F2E6D9',
              color: '#000000',
              border: '1px solid #E4D9CD',
              borderRadius: 24,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Title set to: <strong style={{ color: 'inherit' }}>{result.newTitle}</strong>
          </div>
        );
      }
      if (status === 'complete' && !result?.success) {
        return (
          <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 14, color: '#b91c1c' }}>
            ❌ {result?.message}
          </div>
        );
      }
      return <div />;
    }
  });

  // updateServiceCategory (serviceId optional)
  useCopilotAction({
    name: 'updateServiceCategory',
    description:
      'Update the category of an existing service in Bubble. The newCategory must be one of the allowed categories.',
    parameters: [
      { name: 'serviceId', type: 'string', description: 'Bubble unique ID (_id) of the service to update. If omitted, use active_service._id.', required: false },
      { name: 'newCategory', type: 'string', description: `New category (one of: ${ALLOWED_CATEGORIES.join(', ')}). Case-insensitive.`, required: true },
    ],
    handler: async ({ serviceId, newCategory }: { serviceId?: string; newCategory: string }) => {
      const resolvedId = serviceId || activeService?._id;
      if (!resolvedId) {
        return { success: false, message: 'No service selected. Please select a service or provide serviceId.' };
      }
      // Validate category strictly (case-insensitive match to be user-friendly)
      const match = ALLOWED_CATEGORIES.find(
        (c) => c.toLowerCase() === String(newCategory).trim().toLowerCase(),
      );
      if (!match) {
        return {
          success: false,
          message: `Category must be one of: ${ALLOWED_CATEGORIES.join(', ')}`,
        };
      }
      try {
        const res = await fetch(
          `https://lemonslemons.co/version-test/api/1.1/obj/service/${resolvedId}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${BUBBLE_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ category: match }),
          },
        );
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`Update failed ${res.status}: ${t}`);
        }
        const len = res.headers.get('content-length');
        if (len && len !== '0') {
          await res.text().catch(() => '');
        }
        try {
          window.parent?.postMessage(
            { type: 'SERVICE_CATEGORY_UPDATED', serviceId: resolvedId, category: match },
            '*',
          );
        } catch {}
        setActiveService((prev) => (prev && prev._id === resolvedId ? { ...prev, category: match } : prev));
        return { success: true, serviceId: resolvedId, newCategory: match };
      } catch (e: any) {
        return {
          success: false,
          error: e.message || 'Unknown error',
          message: 'Could not update the service category.',
        };
      }
    },
    render: ({ status, result }) => {
      if (status === 'executing') {
        return (
          <div
            style={{
              padding: 12,
              background: '#F2E6D9',
              color: '#000000',
              border: '1px solid #E4D9CD',
              borderRadius: 24,
              fontSize: 14,
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span aria-hidden>⏳</span>
            <span>Updating category…</span>
          </div>
        );
      }
      if (status === 'complete' && result?.success) {
        return (
          <div
            style={{
              padding: 12,
              background: '#F2E6D9',
              color: '#000000',
              border: '1px solid #E4D9CD',
              borderRadius: 24,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Category set to: <strong style={{ color: 'inherit' }}>{result.newCategory}</strong>
          </div>
        );
      }
      if (status === 'complete' && !result?.success) {
        return (
          <div
            style={{
              padding: 12,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              fontSize: 14,
              color: '#b91c1c',
            }}
          >
            ❌ {result?.message}
          </div>
        );
      }
      return <div />;
    },
  });

  // updateServiceDescription (serviceId optional)
  useCopilotAction({
    name: 'updateServiceDescription',
    description: 'Update the description of an existing service in Bubble.',
    parameters: [
      { name: 'serviceId', type: 'string', description: 'Bubble unique ID (_id) of the service to update. If omitted, use active_service._id.', required: false },
      { name: 'newDescription', type: 'string', description: 'The new finalized description to set on the service', required: true },
    ],
    handler: async ({ serviceId, newDescription }: { serviceId?: string; newDescription: string }) => {
      const resolvedId = serviceId || activeService?._id;
      if (!resolvedId) {
        return { success: false, message: 'No service selected. Please select a service or provide serviceId.' };
      }
      try {
        const res = await fetch(
          `https://lemonslemons.co/version-test/api/1.1/obj/service/${resolvedId}`,
          {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${BUBBLE_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: newDescription }),
          },
        );
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`Update failed ${res.status}: ${t}`);
        }
        const len = res.headers.get('content-length');
        if (len && len !== '0') {
          await res.text().catch(() => '');
        }
        try {
          window.parent?.postMessage(
            { type: 'SERVICE_DESCRIPTION_UPDATED', serviceId: resolvedId },
            '*',
          );
        } catch {}
        setActiveService((prev) =>
          prev && prev._id === resolvedId ? { ...prev, description: newDescription } : prev,
        );
        return { success: true, serviceId: resolvedId };
      } catch (e: any) {
        return {
          success: false,
          error: e.message || 'Unknown error',
          message: 'Could not update the service description.',
        };
      }
    },
    render: ({ status, result }) => {
      if (status === 'executing') {
        return (
          <div
            style={{
              padding: 12,
              background: '#F2E6D9',
              color: '#000000',
              border: '1px solid #E4D9CD',
              borderRadius: 24,
              fontSize: 14,
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span aria-hidden>⏳</span>
            <span>Updating description…</span>
          </div>
        );
      }
      if (status === 'complete' && result?.success) {
        return (
          <div
            style={{
              padding: 12,
              background: '#F2E6D9',
              color: '#000000',
              border: '1px solid #E4D9CD',
              borderRadius: 24,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Description updated successfully.
          </div>
        );
      }
      if (status === 'complete' && !result?.success) {
        return (
          <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 14, color: '#b91c1c' }}>
            ❌ {result?.message}
          </div>
        );
      }
      return <div />;
    },
  });

  // Expose minimal API to callers
  return { activeService, refreshServiceInfo };
}

// --- Presentation Components ---
function ServiceResults({ services, searchCriteria, activeServiceId }: { services: Service[]; searchCriteria: any; activeServiceId?: string }) {
  if (!services || services.length === 0) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', backgroundColor: '#f9f8f5', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔍</div>
        <h3 style={{ margin: '0 0 8px 0', color: '#374151' }}>No services found</h3>
        <p style={{ color: '#64748b', margin: 0, fontSize: '14px' }}>Try adjusting your search criteria or browse all services</p>
      </div>
    );
  }
  return (
    <div style={{ margin: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <span style={{ fontSize: '24px' }}>🍋</span>
        <h3 style={{ margin: 0, color: '#2c2c2c', fontSize: '18px', fontWeight: '600' }}>
          Found {services.length} service{services.length !== 1 ? 's' : ''}
          {searchCriteria.serviceType && ` for "${searchCriteria.serviceType}"`}
        </h3>
      </div>
      {(searchCriteria.maxPrice || searchCriteria.maxDeliveryDays) && (
        <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '14px', color: '#166534' }}>
          <strong>Filters applied:</strong>
          {searchCriteria.maxPrice && ` Max price: $${searchCriteria.maxPrice}`}
          {searchCriteria.maxDeliveryDays && ` Max delivery: ${searchCriteria.maxDeliveryDays} days`}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {services.map((service: Service) => (
          <ServiceCard key={service._id} service={service} selected={service._id === activeServiceId} />
        ))}
      </div>
    </div>
  );
}

function ServiceCard({ service, selected }: { service: Service; selected?: boolean }) {
  return (
    <div style={{ border: selected ? '2px solid #fbbf24' : '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', backgroundColor: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', transition: 'all 0.2s ease', cursor: 'pointer' }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)'; }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
        <h4 style={{ margin: 0, color: '#1e293b', fontSize: '18px', fontWeight: '600', lineHeight: '1.3' }}>{service.title || '(untitled)'}</h4>
        <div style={{ fontSize: '20px', fontWeight: '700', color: '#10b981', marginLeft: '16px', flexShrink: 0 }}>${service.price}</div>
      </div>
      {service.description && (
        <p style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: '14px', lineHeight: '1.5' }}>
          {service.description.length > 200 ? `${service.description.substring(0, 200)}...` : service.description}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#6b7280', fontSize: '14px' }}>
          <span>⏱️</span>
          <span>{service.delivery_days} day{service.delivery_days !== 1 ? 's' : ''} delivery</span>
        </div>
        <button onClick={() => { console.log('Contact service provider:', service); }}
          style={{ backgroundColor: '#10b981', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500', marginLeft: 'auto', transition: 'background-color 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#059669'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#10b981'; }}>View offer</button>
      </div>
    </div>
  );
}

