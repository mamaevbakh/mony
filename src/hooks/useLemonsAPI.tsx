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

// Package interface based on Bubble "package" type (assumed fields)
interface LemonPackage {
  _id: string;
  title?: string;
  price?: number;
  delivery_days?: number;
  package_description?: string;
  service?: string; // reference to parent service id
}

export function useLemonsAPI() {
  // Token (consider moving to env: VITE_BUBBLE_TOKEN)
  const BUBBLE_TOKEN = (import.meta as any)?.env?.VITE_BUBBLE_TOKEN || '67205b2400911e48fdfd7e7ea9cac75c';
  const BUBBLE_BASE = "https://lemonslemons.co/version-test";
  // Optional overrides for package type/relationship
  const ENV_PACKAGE_TYPE_SLUG = (import.meta as any)?.env?.VITE_BUBBLE_PACKAGE_TYPE_SLUG as string | undefined;
  const ENV_PACKAGE_SERVICE_FIELD = (import.meta as any)?.env?.VITE_BUBBLE_PACKAGE_SERVICE_FIELD as string | undefined;
  const PACKAGE_SERVICE_FIELD = (ENV_PACKAGE_SERVICE_FIELD && ENV_PACKAGE_SERVICE_FIELD.trim()) || 'service';

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
  const [servicePackages, setServicePackages] = useState<LemonPackage[]>([]);
  const [packageTypeSlug, setPackageTypeSlug] = useState<string | null>(ENV_PACKAGE_TYPE_SLUG?.trim() || null);

  // Discover the correct Bubble data type slug for packages and cache it
  const resolvePackageTypeSlug = async (force = false): Promise<string | null> => {
    if (!force && packageTypeSlug) return packageTypeSlug;
    if (!force && !ENV_PACKAGE_TYPE_SLUG) {
      const cached = localStorage.getItem('lemons_package_slug');
      if (cached) {
        setPackageTypeSlug(cached);
        return cached;
      }
    }
    // If explicitly provided via env, trust it
    if (ENV_PACKAGE_TYPE_SLUG && ENV_PACKAGE_TYPE_SLUG.trim()) {
      setPackageTypeSlug(ENV_PACKAGE_TYPE_SLUG.trim());
      localStorage.setItem('lemons_package_slug', ENV_PACKAGE_TYPE_SLUG.trim());
      return ENV_PACKAGE_TYPE_SLUG.trim();
    }
    // Probe common candidates
    const candidates = ['package', 'packages', 'service_package', 'service-packages', 'Package'];
    for (const slug of candidates) {
      try {
        const url = `${BUBBLE_BASE}/api/1.1/obj/${slug}?limit=1`;
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${BUBBLE_TOKEN}`, 'Content-Type': 'application/json' } });
        if (res.ok) {
          setPackageTypeSlug(slug);
          localStorage.setItem('lemons_package_slug', slug);
          return slug;
        }
      } catch {}
    }
    // Not found
    setPackageTypeSlug(null);
    return null;
  };

  // Fetch the latest service data by id and update state
  const refreshServiceInfo = async (
    serviceId?: string,
  ): Promise<{ service: Service; packages: LemonPackage[] } | null> => {
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
        // Fetch related packages for this service (assumes the field key is "service")
        let pkgs: LemonPackage[] = [];
        try {
          const slug = await resolvePackageTypeSlug();
          if (slug) {
            const constraints = [{ key: PACKAGE_SERVICE_FIELD, constraint_type: 'equals', value: id }];
            const p = new URLSearchParams();
            p.append('constraints', JSON.stringify(constraints));
            p.append('limit', '100');
            const pkgUrl = `${BUBBLE_BASE}/api/1.1/obj/${slug}?${p.toString()}`;
            const pres = await fetch(pkgUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${BUBBLE_TOKEN}`,
                'Content-Type': 'application/json',
              },
            });
            if (pres.ok) {
              const pdata = await pres.json().catch(() => null as any);
              pkgs = (pdata?.response?.results ?? pdata?.results ?? []) as LemonPackage[];
            }
          }
        } catch {}
        setServicePackages(pkgs);
        try { window.parent?.postMessage({ type: 'SERVICE_CHANGED', serviceId: id }, '*'); } catch {}
        return { service: svc as Service, packages: pkgs };
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
        // Also refresh packages for this active service id
        refreshServiceInfo(d.service._id);
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
      const res = await refreshServiceInfo(serviceId);
      if (!res) {
        return { success: false, message: 'Could not fetch the service. Please check the id.' };
      }
      return { success: true, service: res.service, packages: res.packages };
    },
    render: () => "",
  });

  // Expose active packages to the LLM for context
  useCopilotReadable({
    value: servicePackages && servicePackages.length ? JSON.stringify(servicePackages) : '[]',
    description:
      'active_service_packages: Array of packages for the currently active service. The package description field is package_description.',
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
        // Ensure fresh server state after mutation
        await refreshServiceInfo(resolvedId);
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
        // Ensure fresh server state after mutation
        await refreshServiceInfo(resolvedId);
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
        // Ensure fresh server state after mutation
        await refreshServiceInfo(resolvedId);
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

  // listPackagesForService
  useCopilotAction({
    name: 'listPackagesForService',
    description:
      'List packages attached to a service. Use this to read the available packages. If serviceId is omitted, use active_service._id.',
    parameters: [
      { name: 'serviceId', type: 'string', description: 'Bubble unique ID (_id) of the parent service. If omitted, uses active_service._id.', required: false },
      { name: 'limit', type: 'number', description: 'Max number of packages to return (default 20).', required: false },
    ],
    handler: async ({ serviceId, limit = 20 }: { serviceId?: string; limit?: number }) => {
      const resolvedId = serviceId || activeService?._id;
      if (!resolvedId) {
        return { success: false, message: 'No service selected. Please provide serviceId or select a service.' };
      }
      try {
        const slug = await resolvePackageTypeSlug();
        if (!slug) {
          return { success: false, message: 'Packages type not found on Bubble API. Set VITE_BUBBLE_PACKAGE_TYPE_SLUG or expose the data type via Data API.' };
        }
        const constraints = [{ key: PACKAGE_SERVICE_FIELD, constraint_type: 'equals', value: resolvedId }];
        const p = new URLSearchParams();
        p.append('constraints', JSON.stringify(constraints));
        p.append('limit', String(limit));
        const url = `${BUBBLE_BASE}/api/1.1/obj/${slug}?${p.toString()}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${BUBBLE_TOKEN}`, 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
        const data = await res.json();
        const pkgs: LemonPackage[] = data?.response?.results || [];
        // keep state in sync
        if (activeService?._id === resolvedId) setServicePackages(pkgs);
        return { success: true, serviceId: resolvedId, packages: pkgs };
      } catch (e: any) {
        return { success: false, message: e?.message || 'Could not list packages. Ensure the data type slug and privacy rules are correct.' };
      }
    },
    render: ({ status, result }) => {
      if (status === 'executing') {
        return (
          <div style={{ padding: 12, background: '#F2E6D9', color: '#000000', border: '1px solid #E4D9CD', borderRadius: 24, fontSize: 14 }}>Loading packages…</div>
        );
      }
      if (status === 'complete' && result?.success) {
        const pkgs = result.packages as LemonPackage[];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pkgs?.length ? pkgs.map((p) => (
              <div key={p._id} style={{ padding: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{p.title || '(untitled package)'}</strong>
                  {typeof p.price === 'number' && <span style={{ color: '#10b981' }}>${p.price}</span>}
                </div>
                {p.package_description && (<div style={{ color: '#6b7280', marginTop: 6 }}>{p.package_description}</div>)}
                <div style={{ color: '#6b7280', marginTop: 6 }}>
                  {typeof p.delivery_days === 'number' ? `${p.delivery_days} day${p.delivery_days === 1 ? '' : 's'} delivery` : ''}
                </div>
              </div>
            )) : (
              <div style={{ padding: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12 }}>No packages found.</div>
            )}
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

  // getPackageById (silent render to avoid extra bubbles)
  useCopilotAction({
    name: 'getPackageById',
    description: 'Fetch a package by its Bubble unique ID (_id).',
    parameters: [
      { name: 'packageId', type: 'string', description: 'Bubble unique ID (_id) of the package', required: true },
    ],
    handler: async ({ packageId }: { packageId: string }) => {
      try {
        const slug = await resolvePackageTypeSlug();
        if (!slug) {
          return { success: false, message: 'Packages type not found on Bubble API. Set VITE_BUBBLE_PACKAGE_TYPE_SLUG or expose the data type via Data API.' };
        }
        const url = `${BUBBLE_BASE}/api/1.1/obj/${slug}/${packageId}`;
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${BUBBLE_TOKEN}`, 'Content-Type': 'application/json' } });
        if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
        const data = await res.json();
        const pkg: LemonPackage = data?.response ?? data;
        if (pkg?._id) {
          // update state if it belongs to the active service
          setServicePackages((prev) => {
            const idx = prev.findIndex((p) => p._id === pkg._id);
            if (idx >= 0) {
              const copy = prev.slice();
              copy[idx] = { ...prev[idx], ...pkg };
              return copy;
            }
            return [...prev, pkg];
          });
          return { success: true, package: pkg };
        }
        return { success: false, message: 'Package not found' };
      } catch (e: any) {
        return { success: false, message: e?.message || 'Could not fetch the package.' };
      }
    },
    render: () => "",
  });

  // updatePackage (read/update only: update selected fields)
  useCopilotAction({
    name: 'updatePackage',
    description:
      'Update a package in Bubble. Only updates the provided fields. For description use the field package_description.',
    parameters: [
      { name: 'packageId', type: 'string', description: 'Bubble unique ID (_id) of the package to update', required: true },
      { name: 'title', type: 'string', description: 'New title/name of the package', required: false },
      { name: 'package_description', type: 'string', description: 'New description text for the package', required: false },
      { name: 'price', type: 'number', description: 'New price for the package', required: false },
      { name: 'delivery_days', type: 'number', description: 'New delivery days for the package', required: false },
    ],
    handler: async (args: { packageId: string; title?: string; package_description?: string; price?: number; delivery_days?: number }) => {
      const { packageId, title, package_description, price, delivery_days } = args;
      const body: any = {};
      if (typeof title === 'string') body.title = title;
      if (typeof package_description === 'string') body.package_description = package_description;
      if (typeof price === 'number') body.price = price;
      if (typeof delivery_days === 'number') body.delivery_days = delivery_days;
      if (!Object.keys(body).length) {
        return { success: false, message: 'No fields provided to update.' };
      }
      try {
        const slug = await resolvePackageTypeSlug();
        if (!slug) {
          return { success: false, message: 'Packages type not found on Bubble API. Set VITE_BUBBLE_PACKAGE_TYPE_SLUG or expose the data type via Data API.' };
        }
        const url = `${BUBBLE_BASE}/api/1.1/obj/${slug}/${packageId}`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${BUBBLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`Update failed ${res.status}: ${t}`);
        }
        const len = res.headers.get('content-length');
        if (len && len !== '0') await res.text().catch(() => '');
        try { window.parent?.postMessage({ type: 'PACKAGE_UPDATED', packageId }, '*'); } catch {}
        // Refresh packages and service context after mutation
        const sid = activeService?._id;
        if (sid) await refreshServiceInfo(sid);
        return { success: true, packageId, updated: body };
      } catch (e: any) {
        return { success: false, message: e?.message || 'Could not update the package.' };
      }
    },
    render: ({ status, result }) => {
      if (status === 'executing') {
        return (
          <div style={{ padding: 12, background: '#F2E6D9', color: '#000000', border: '1px solid #E4D9CD', borderRadius: 24, fontSize: 14 }}>Updating package…</div>
        );
      }
      if (status === 'complete' && result?.success) {
        return (
          <div style={{ padding: 12, background: '#F2E6D9', color: '#000000', border: '1px solid #E4D9CD', borderRadius: 24, fontSize: 14 }}>Package updated.</div>
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
  return { activeService, servicePackages, refreshServiceInfo };
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

