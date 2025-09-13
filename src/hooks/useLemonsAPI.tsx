import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { useEffect, useState } from "react";
import { algoliasearch } from 'algoliasearch';

// Domain types
export interface Service {
  _id: string;
  title: string;
  description?: string;
  category?: string;
  price?: number;
  delivery_days?: number;
}

export interface LemonPackage {
  _id: string;
  name?: string;
  title?: string; // some Bubble apps use title for package name
  package_description?: string;
  price?: number;
  delivery?: string; // e.g., "3 days"
  revisions?: string;
  included?: string[];
}

export interface LemonUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  bio?: string;
  experience?: string;
  tagline?: string;
  skills?: string[];
}
export function useLemonsAPI() {
  // Token (consider moving to env: VITE_BUBBLE_TOKEN)
  const BUBBLE_TOKEN = (import.meta as any)?.env?.VITE_BUBBLE_TOKEN || '67205b2400911e48fdfd7e7ea9cac75c';
  const BUBBLE_BASE = "https://lemonslemons.co/version-live";
  // Optional overrides for package type/relationship
  const ENV_PACKAGE_TYPE_SLUG = (import.meta as any)?.env?.VITE_BUBBLE_PACKAGE_TYPE_SLUG as string | undefined;
  const ENV_SERVICE_PACKAGES_FIELD = (import.meta as any)?.env?.VITE_BUBBLE_SERVICE_PACKAGES_FIELD as string | undefined;

  // Allowed categories (adjust to match Bubble field options)
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
  const DEBUG = String((import.meta as any)?.env?.VITE_DEBUG_PACKAGES || '').toLowerCase() === 'true';
  const [activeUser, setActiveUser] = useState<LemonUser | null>(null);

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

  // Discover the correct Bubble data type slug for user and cache it
  const resolveUserTypeSlug = async (force = false): Promise<string | null> => {
    const cacheKey = 'lemons_user_slug';
    const cached = !force ? localStorage.getItem(cacheKey) : null;
    if (cached) return cached;
    const candidates = ['user', 'User'];
    for (const slug of candidates) {
      try {
        const url = `${BUBBLE_BASE}/api/1.1/obj/${slug}?limit=1`;
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${BUBBLE_TOKEN}`, 'Content-Type': 'application/json' } });
        if (res.ok) {
          localStorage.setItem(cacheKey, slug);
          return slug;
        }
      } catch {}
    }
    return null;
  };

  // Refresh a user by id (safe fields only)
  const refreshUserInfo = async (userId: string): Promise<LemonUser | null> => {
    const slug = await resolveUserTypeSlug();
    if (!slug) return null;
    try {
      const url = `${BUBBLE_BASE}/api/1.1/obj/${slug}/${userId}`;
      const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${BUBBLE_TOKEN}`, 'Content-Type': 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null as any);
      const u: any = data?.response ?? data ?? null;
      if (!u?._id) return null;
      // Filter to safe fields only
      const safe: LemonUser = {
        _id: u._id,
        firstName: u.firstName,
        lastName: u.lastName,
        bio: u.bio,
        experience: u.experience,
        tagline: u.tagline,
        skills: Array.isArray(u.skills) ? u.skills.map(String) : undefined,
      };
      setActiveUser(safe);
      try { window.parent?.postMessage({ type: 'USER_CHANGED', userId }, '*'); } catch {}
      return safe;
    } catch {
      return null;
    }
  };

  // Extract array of package ids from a service record
  const extractPackageIdsFromService = (svc: any): string[] => {
    // Bubble unique IDs often look like: 1707690969219x719091... (alphanumeric with an 'x'), not just hex.
    const idRegex = /^[A-Za-z0-9_-]{10,}$/;
    const pickFromArray = (v: any): string[] => Array.isArray(v)
      ? v.map(String).filter((s) => idRegex.test(s))
      : [];
    // 1) Env explicit field
    if (ENV_SERVICE_PACKAGES_FIELD && typeof svc?.[ENV_SERVICE_PACKAGES_FIELD] !== 'undefined') {
      const arr = pickFromArray(svc[ENV_SERVICE_PACKAGES_FIELD]);
      if (arr.length) return arr;
    }
    // 2) Common field names
    const candidates = ['packages', 'package_ids', 'package_list', 'packages_list', 'packages_ids'];
    for (const key of candidates) {
      if (typeof svc?.[key] !== 'undefined') {
        const arr = pickFromArray(svc[key]);
        if (arr.length) return arr;
      }
    }
    // 3) Fallback: scan all arrays of id-like strings
    for (const [, v] of Object.entries(svc || {})) {
      const arr = pickFromArray(v);
      if (arr.length >= 1) return arr;
    }
    return [];
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
        // Fetch related packages by IDs stored on the service
        let pkgs: LemonPackage[] = [];
        try {
          const pkgIds = extractPackageIdsFromService(svc);
          const slug = await resolvePackageTypeSlug();
          if (DEBUG) {
            console.debug('[lemons] package slug:', slug, 'pkgIds:', pkgIds);
          }
          if (slug && pkgIds.length) {
            // limit to 100 to avoid excessive parallel requests
            const dedup = Array.from(new Set(pkgIds));
            const ids = dedup.slice(0, 100);
            const results = await Promise.allSettled(
              ids.map(async (pid) => {
                const u = `${BUBBLE_BASE}/api/1.1/obj/${slug}/${pid}`;
                const r = await fetch(u, { method: 'GET', headers: { 'Authorization': `Bearer ${BUBBLE_TOKEN}`, 'Content-Type': 'application/json' } });
                if (!r.ok) throw new Error(String(r.status));
                const j = await r.json().catch(() => null as any);
                return (j?.response ?? j) as LemonPackage;
              }),
            );
            pkgs = results
              .filter((p): p is PromiseFulfilledResult<LemonPackage> => p.status === 'fulfilled' && !!p.value?._id)
              .map((p) => p.value);
            if (DEBUG) {
              const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
              if (failures.length) console.debug('[lemons] package fetch failures:', failures.map(f => f.reason));
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
    const uid = params.get('userId');
    if (sid) {
      // fetch the real record right away
      refreshServiceInfo(sid);
    }
    if (uid) {
      refreshUserInfo(uid);
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
      } else if (d.type === 'ACTIVE_USER' && (d.user?._id || d.userId)) {
        const id = d.user?._id || d.userId;
        if (id) refreshUserInfo(id);
      } else if (d.type === 'ACTIVE_USER_ID' && d.id) {
        refreshUserInfo(d.id);
      }
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // searchServices action (Algolia primary, Bubble fallback)
  useCopilotAction({
    name: "searchServices",
  description: "Search for services using Algolia (primary). Only apply a category filter if the user explicitly provides one.",
    parameters: [
      { name: "query", type: "string", description: "Free text to match service title/description", required: false },
      { name: "category", type: "string", description: `Category filter (one of: ${ALLOWED_CATEGORIES.join(', ')})`, required: false },
      { name: "maxPrice", type: "number", description: "Maximum price filter (applied to lowest package price)", required: false },
      { name: "maxDeliveryDays", type: "number", description: "Maximum delivery days (applied to parsed package deliveries)", required: false },
      { name: "limit", type: "number", description: "Max results to return (default: 10)", required: false },
      { name: "page", type: "number", description: "Page number (0-based)", required: false }
    ],
  handler: async ({ query, category, maxPrice, maxDeliveryDays, limit = 10, page = 0 }) => {
      try {
        // Require Algolia config
        const ALG_APP_ID = (import.meta as any)?.env?.VITE_ALGOLIA_APP_ID || 'R54SIWV9I8';
        const ALG_SEARCH_KEY = (import.meta as any)?.env?.VITE_ALGOLIA_SEARCH_KEY || '39142b31be9276bc327e0d9851e9d172';
        const ALG_INDEX = (import.meta as any)?.env?.VITE_ALGOLIA_INDEX || 'services';

        // Validate category if explicitly provided; otherwise do NOT default or infer
        let normalizedCategory: string | undefined = undefined;
        if (category) {
          const match = ALLOWED_CATEGORIES.find((c) => c.toLowerCase() === String(category).trim().toLowerCase());
          if (!match) {
            return { success: false, message: `Category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` };
          }
          normalizedCategory = match;
        }

        // Algolia-only path
        const client = algoliasearch(ALG_APP_ID, ALG_SEARCH_KEY);
        const facetFilters: string[][] = [];
        if (normalizedCategory) {
          facetFilters.push([`service_category:${normalizedCategory}`]);
        }

        const searchParams: any = {
          hitsPerPage: Math.max(1, Number(limit) || 10),
          page: Math.max(0, Number(page) || 0),
          attributesToRetrieve: [
            'objectID',
            'service_title',
            'service_description',
            'service_category',
            'service_packages',
            'service_created_date',
            'service_modified_date',
          ],
          ...(facetFilters.length ? { facetFilters } : {}),
        };

        const res: any = await client.search({
          requests: [
            {
              indexName: ALG_INDEX,
              type: 'default',
              query: query || '',
              ...searchParams,
            },
          ],
        });
        const hits: any[] = Array.isArray(res?.results?.[0]?.hits) ? res.results[0].hits : [];

        const mapped: Service[] = hits.map((h) => {
          const pkgs: any[] = Array.isArray(h.service_packages) ? h.service_packages : [];
          const prices = pkgs.map((p) => Number(p?.package_price)).filter((n) => Number.isFinite(n));
          const minPrice = prices.length ? Math.min(...prices) : 0;
          const deliveryDaysFromText = (txt?: string): number | undefined => {
            if (!txt) return undefined;
            const m = String(txt).match(/(\d+)/);
            return m ? Number(m[1]) : undefined;
          };
          const deliveries = pkgs.map((p) => deliveryDaysFromText(p?.package_delivery)).filter((n) => Number.isFinite(n)) as number[];
          const minDelivery = deliveries.length ? Math.min(...deliveries) : 0;
          return {
            _id: String(h.objectID || h._id || ''),
            title: String(h.service_title || ''),
            description: String(h.service_description || ''),
            category: h.service_category ? String(h.service_category) : undefined,
            price: minPrice,
            delivery_days: minDelivery,
          } as Service;
        });

        const filtered = mapped.filter((s) => {
          const p = s.price ?? 0;
          const d = s.delivery_days ?? 0;
          if (typeof maxPrice === 'number' && Number.isFinite(maxPrice) && p > maxPrice) return false;
          if (typeof maxDeliveryDays === 'number' && Number.isFinite(maxDeliveryDays) && d > maxDeliveryDays) return false;
          return true;
        });

        return {
          success: true,
          services: filtered,
          searchCriteria: { query, category: normalizedCategory, maxPrice, maxDeliveryDays, limit, page, provider: 'algolia' },
          displayOnly: true,
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', message: 'Sorry, I could not search services right now.' };
      }
    },
    render: ({ status, args, result }) => {
      if (status === 'executing') {
        return (
          <div style={{ padding: '16px', textAlign: 'center', backgroundColor: '#f9f8f5', borderRadius: '12px', border: '0.56px solid #e2e8d9' }}>
            <div style={{ display: 'inline-block', width: '24px', height: '24px', border: '3px solid #f3f3f3', borderTop: '3px solid #10b981', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <p style={{ marginTop: '12px', color: '#64748b', margin: '12px 0 0 0' }}>Searching for {args?.query || args?.category || 'services'}...</p>
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

  // Expose active user (safe fields only)
  useCopilotReadable({
    value: activeUser ? JSON.stringify(activeUser) : 'null',
    description: 'active_user: Current user profile with safe fields (firstName, lastName, bio, experience, tagline, skills).',
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
        const res = await fetch(`https://lemonslemons.co/version-live/api/1.1/obj/service/${resolvedId}`, {
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
          `https://lemonslemons.co/version-live/api/1.1/obj/service/${resolvedId}`,
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
          `https://lemonslemons.co/version-live/api/1.1/obj/service/${resolvedId}`,
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
      // Reuse refreshServiceInfo which now fetches packages by id list
      const res = await refreshServiceInfo(resolvedId);
      if (!res) return { success: false, message: 'Could not refresh service info.' };
      const pkgs = res.packages?.slice(0, Math.max(0, limit)) ?? [];
      return { success: true, serviceId: resolvedId, packages: pkgs };
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
                  <strong>{p.name || p.title || '(untitled package)'}</strong>
                  {typeof p.price === 'number' && <span style={{ color: '#10b981' }}>${p.price}</span>}
                </div>
                {p.package_description && (<div style={{ color: '#6b7280', marginTop: 6 }}>{p.package_description}</div>)}
                {p.delivery && (<div style={{ color: '#6b7280', marginTop: 6 }}>Delivery: {p.delivery}</div>)}
                {p.revisions && (<div style={{ color: '#6b7280', marginTop: 6 }}>Revisions: {p.revisions}</div>)}
                {Array.isArray(p.included) && p.included.length > 0 && (
                  <ul style={{ color: '#6b7280', marginTop: 6, paddingLeft: 18 }}>
                    {p.included.map((it: string, i: number) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ul>
                )}
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

  // getUserById (silent)
  useCopilotAction({
    name: 'getUserById',
    description: 'Fetch a user profile by unique id (safe fields only).',
    parameters: [
      { name: 'userId', type: 'string', description: 'Bubble unique ID (_id) of the user', required: true },
    ],
    handler: async ({ userId }: { userId: string }) => {
      const u = await refreshUserInfo(userId);
      if (!u) return { success: false, message: 'Could not fetch the user.' };
      return { success: true, user: u };
    },
    render: () => "",
  });

  // updateUser (safe fields only)
  useCopilotAction({
    name: 'updateUser',
    description: 'Update safe user fields only: firstName, lastName, bio, experience, tagline, skills. Do not include admin, email, photo, threads.',
    parameters: [
      { name: 'userId', type: 'string', description: 'Bubble unique ID (_id) of the user. If omitted, uses active_user._id.', required: false },
      { name: 'firstName', type: 'string', description: 'First name', required: false },
      { name: 'lastName', type: 'string', description: 'Last name', required: false },
      { name: 'bio', type: 'string', description: 'Professional bio', required: false },
      { name: 'experience', type: 'string', description: 'Years/summary of experience', required: false },
      { name: 'tagline', type: 'string', description: 'Professional tagline', required: false },
      { name: 'skills', type: 'string', description: 'Replace skills list; comma- or newline-separated string (e.g., "Web, UX").', required: false },
    ],
    handler: async (args: { userId?: string; firstName?: string; lastName?: string; bio?: string; experience?: string; tagline?: string; skills?: string | string[] }) => {
      const resolvedId = args.userId || activeUser?._id;
      if (!resolvedId) return { success: false, message: 'No user selected. Provide userId or select one.' };
      const body: any = {};
      const pickStr = (v: any) => (typeof v === 'string' ? v : undefined);
      if (pickStr(args.firstName)) body.firstName = String(args.firstName);
      if (pickStr(args.lastName)) body.lastName = String(args.lastName);
      if (pickStr(args.bio)) body.bio = String(args.bio);
      if (pickStr(args.experience)) body.experience = String(args.experience);
      if (pickStr(args.tagline)) body.tagline = String(args.tagline);
      const rawSkills = args.skills as any;
      if (Array.isArray(rawSkills)) {
        body.skills = rawSkills.map((s) => String(s).trim()).filter(Boolean);
      } else if (typeof rawSkills === 'string') {
        body.skills = rawSkills.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
      }
      if (!Object.keys(body).length) return { success: false, message: 'No fields provided to update.' };
      try {
        const slug = await resolveUserTypeSlug();
        if (!slug) return { success: false, message: 'User type not exposed via Data API.' };
        const url = `${BUBBLE_BASE}/api/1.1/obj/${slug}/${resolvedId}`;
        const res = await fetch(url, { method: 'PATCH', headers: { 'Authorization': `Bearer ${BUBBLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`Update failed ${res.status}: ${t}`);
        }
        const len = res.headers.get('content-length');
        if (len && len !== '0') await res.text().catch(() => '');
        try { window.parent?.postMessage({ type: 'USER_UPDATED', userId: resolvedId }, '*'); } catch {}
        await refreshUserInfo(resolvedId);
        return { success: true, userId: resolvedId, updated: body };
      } catch (e: any) {
        return { success: false, message: e?.message || 'Could not update the user.' };
      }
    },
    render: ({ status, result }) => {
      if (status === 'executing') {
        return <div style={{ padding: 12, background: '#F2E6D9', color: '#000', border: '1px solid #E4D9CD', borderRadius: 24, fontSize: 14 }}>Updating user…</div>;
      }
      if (status === 'complete' && result?.success) {
        return <div style={{ padding: 12, background: '#F2E6D9', color: '#000', border: '1px solid #E4D9CD', borderRadius: 24, fontSize: 14 }}>User updated.</div>;
      }
      if (status === 'complete' && !result?.success) {
        return <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 14, color: '#b91c1c' }}>❌ {result?.message}</div>;
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
      'Update a package in Bubble. Only updates allowed fields: name, package_description, price, delivery (text), revisions (text), included. For included, pass a comma- or newline-separated string to replace the list.',
    parameters: [
      { name: 'packageId', type: 'string', description: 'Bubble unique ID (_id) of the package to update', required: true },
      { name: 'name', type: 'string', description: 'New name/title of the package', required: false },
      { name: 'package_description', type: 'string', description: 'New description text for the package', required: false },
      { name: 'price', type: 'number', description: 'New price for the package', required: false },
      { name: 'delivery', type: 'string', description: 'New delivery text for the package (e.g., 3 days)', required: false },
  { name: 'revisions', type: 'string', description: 'Revisions policy text', required: false },
  { name: 'included', type: 'string', description: 'Replace the included list; provide a comma- or newline-separated string (e.g., "Item A, Item B").', required: false },
    ],
    handler: async (args: { packageId: string; name?: string; package_description?: string; price?: number; delivery?: string; revisions?: string; included?: string | string[] } & { [k: string]: any }) => {
      const { packageId, name, package_description, price, delivery, revisions } = args;
      const body: any = {};
      // Prefer allowed fields only
      if (typeof name === 'string') body.name = name;
      // Back-compat mapping: if caller sends title, map it to name (do NOT send title field)
      if (!body.name && typeof args?.title === 'string') body.name = String(args.title);
      if (typeof package_description === 'string') body.package_description = package_description;
      if (typeof price === 'number') body.price = price;
      if (typeof delivery === 'string') body.delivery = delivery;
      // Back-compat mapping: if caller sends delivery_days, convert to text
      if (!body.delivery && (typeof args?.delivery_days === 'number' || typeof args?.delivery_days === 'string')) {
        const dd = args.delivery_days;
        const txt = typeof dd === 'number' ? `${dd} day${dd === 1 ? '' : 's'}` : String(dd);
        body.delivery = txt;
      }
      if (typeof revisions === 'string') body.revisions = revisions;
      // included: accept string (CSV/newlines) or array
      const rawIncluded = (args as any)?.included;
      if (Array.isArray(rawIncluded)) {
        const arr = rawIncluded.map((s) => String(s).trim()).filter(Boolean);
        body.included = arr;
      } else if (typeof rawIncluded === 'string') {
        // split by newline or comma
        const arr = rawIncluded
          .split(/\r?\n|,/)
          .map((s) => s.trim())
          .filter(Boolean);
        body.included = arr;
      }
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
  return { activeService, servicePackages, refreshServiceInfo, activeUser, refreshUserInfo };
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
          {searchCriteria?.query && ` for "${searchCriteria.query}"`}
          {(!searchCriteria?.query && searchCriteria?.category) && ` in ${searchCriteria.category}`}
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
        <button onClick={() => { try { window.parent?.postMessage({ type: 'VIEW_OFFER', source: 'lemons-app', serviceId: service._id, service }, '*'); } catch (e) { console.debug('postMessage VIEW_OFFER failed', e); } }}
          style={{ backgroundColor: '#10b981', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500', marginLeft: 'auto', transition: 'background-color 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#059669'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#10b981'; }}>View offer</button>
      </div>
    </div>
  );
}

