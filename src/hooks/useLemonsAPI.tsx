import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { useEffect, useState } from "react";

// Service interface based on your Bubble fields
interface Service {
  _id: string;
  title: string;
  price: number;
  delivery_days: number;
  description: string;
  "Created Date"?: string;
  "Modified Date"?: string;
}

export function useLemonsAPI() {
  // Token (consider moving to env: VITE_BUBBLE_TOKEN)
  const BUBBLE_TOKEN = (import.meta as any)?.env?.VITE_BUBBLE_TOKEN || '67205b2400911e48fdfd7e7ea9cac75c';

  // Track active service (selected locally or provided by Bubble parent)
  const [activeService, setActiveService] = useState<Service | null>(null);

  // Expose active service to LLM
  useCopilotReadable({
    // Some versions expect 'name'; fallback to adding as property on value object if API mismatches.
    // Using value object embedding name for robustness.
    value: activeService ? JSON.stringify(activeService) : 'null',
    description: 'active_service: Currently selected service JSON. Use its _id if user wants to update title and no explicit serviceId provided.'
  });

  // Read serviceId from iframe query param (?serviceId=xyz)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('serviceId');
    if (sid) {
      setActiveService(prev => prev?._id === sid ? prev : { _id: sid, title: '', price: 0, delivery_days: 0, description: '' });
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
        setActiveService(prev => prev?._id === d.id ? prev : { _id: d.id, title: '', price: 0, delivery_days: 0, description: '' });
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
            ✅ Service title set to: <strong style={{ color: 'inherit' }}>{result.newTitle}</strong>
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

