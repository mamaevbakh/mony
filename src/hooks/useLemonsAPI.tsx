import { useCopilotAction } from "@copilotkit/react-core";

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
  useCopilotAction({
    name: "searchServices",
    description: "Search for service providers on Lemons platform. Use this when users ask about finding professionals like web designers, developers, marketers, consultants, etc.",
    parameters: [
      {
        name: "serviceType",
        type: "string",
        description: "The type of service to search for (e.g., 'web design', 'development', 'marketing', 'consulting')",
        required: false,
      },
      {
        name: "maxPrice",
        type: "number",
        description: "Maximum price filter for services",
        required: false,
      },
      {
        name: "maxDeliveryDays",
        type: "number",
        description: "Maximum delivery days filter",
        required: false,
      },
      {
        name: "limit",
        type: "number",
        description: "Maximum number of results to return (default: 10)",
        required: false,
      }
    ],
    handler: async ({ serviceType, maxPrice, maxDeliveryDays, limit = 10 }) => {
      try {
        // Build constraints for Bubble API
        const constraints: any[] = [];
        
        // Add service type constraint if provided
        if (serviceType) {
          constraints.push({
            key: "title",
            constraint_type: "text contains",
            value: serviceType
          });
          // Also search in description
          constraints.push({
            key: "description", 
            constraint_type: "text contains",
            value: serviceType
          });
        }
        
        // Add price constraint if provided
        if (maxPrice) {
          constraints.push({
            key: "price",
            constraint_type: "less than",
            value: maxPrice.toString()
          });
        }
        
        // Add delivery days constraint if provided
        if (maxDeliveryDays) {
          constraints.push({
            key: "delivery_days",
            constraint_type: "less than",
            value: maxDeliveryDays.toString()
          });
        }

        // Build API URL with parameters
        const baseUrl = "https://lemonslemons.co/version-test/api/1.1/obj/service";
        const params = new URLSearchParams();
        
        if (constraints.length > 0) {
          params.append("constraints", JSON.stringify(constraints));
        }
        
        params.append("limit", limit.toString());
        params.append("sort_field", "price"); // Sort by price
        params.append("descending", "false"); // Ascending order

        const url = `${baseUrl}?${params.toString()}`;

        // Call the Lemons Bubble API with bearer token
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer 67205b2400911e48fdfd7e7ea9cac75c',
            'Content-Type': 'application/json',
          }
        });

        if (!response.ok) {
          throw new Error(`API call failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const services: Service[] = data.response?.results || [];

        return {
          success: true,
          services,
          totalFound: services.length,
          searchCriteria: {
            serviceType,
            maxPrice,
            maxDeliveryDays,
            limit
          },
          message: `Found ${services.length} service${services.length !== 1 ? 's' : ''}${serviceType ? ` for "${serviceType}"` : ''}`
        };

      } catch (error) {
        console.error('Lemons API Error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          message: `Sorry, I couldn't search for services right now. Please try again later.`
        };
      }
    },
    render: ({ status, args, result }) => {
      if (status === "executing") {
        return (
          <div style={{ 
            padding: '20px', 
            textAlign: 'center',
            backgroundColor: '#f8fafc',
            borderRadius: '12px',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ 
              display: 'inline-block', 
              width: '24px', 
              height: '24px', 
              border: '3px solid #f3f3f3',
              borderTop: '3px solid #10b981',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}></div>
            <p style={{ marginTop: '12px', color: '#64748b', margin: '12px 0 0 0' }}>
              🍋 Searching for {args?.serviceType || 'services'}...
            </p>
          </div>
        );
      }

      if (status === "complete" && result?.success) {
        return <ServiceResults services={result.services} searchCriteria={result.searchCriteria} />;
      }

      if (status === "complete" && !result?.success) {
        return (
          <div style={{ 
            padding: '16px', 
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#dc2626'
          }}>
            ❌ {result?.message || 'Failed to search services'}
          </div>
        );
      }

      return <div></div>; // Return empty div instead of null
    }
  });
}

// Service Results Component
function ServiceResults({ services, searchCriteria }: { 
  services: Service[], 
  searchCriteria: any 
}) {
  if (!services || services.length === 0) {
    return (
      <div style={{ 
        padding: '20px', 
        textAlign: 'center', 
        backgroundColor: '#f8fafc',
        borderRadius: '12px',
        border: '1px solid #e2e8f0'
      }}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔍</div>
        <h3 style={{ margin: '0 0 8px 0', color: '#374151' }}>No services found</h3>
        <p style={{ color: '#64748b', margin: 0, fontSize: '14px' }}>
          Try adjusting your search criteria or browse all services
        </p>
      </div>
    );
  }

  return (
    <div style={{ margin: '20px 0' }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px',
        marginBottom: '16px'
      }}>
        <span style={{ fontSize: '24px' }}>🍋</span>
        <h3 style={{ 
          margin: 0, 
          color: '#1e293b',
          fontSize: '18px',
          fontWeight: '600'
        }}>
          Found {services.length} service{services.length !== 1 ? 's' : ''}
          {searchCriteria.serviceType && ` for "${searchCriteria.serviceType}"`}
        </h3>
      </div>
      
      {/* Search criteria summary */}
      {(searchCriteria.maxPrice || searchCriteria.maxDeliveryDays) && (
        <div style={{ 
          marginBottom: '16px',
          padding: '12px',
          backgroundColor: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '8px',
          fontSize: '14px',
          color: '#166534'
        }}>
          <strong>Filters applied:</strong>
          {searchCriteria.maxPrice && ` Max price: $${searchCriteria.maxPrice}`}
          {searchCriteria.maxDeliveryDays && ` Max delivery: ${searchCriteria.maxDeliveryDays} days`}
        </div>
      )}
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {services.map((service: Service) => (
          <ServiceCard key={service._id} service={service} />
        ))}
      </div>
    </div>
  );
}

// Individual Service Card Component
function ServiceCard({ service }: { service: Service }) {
  return (
    <div style={{
      border: '1px solid #e2e8f0',
      borderRadius: '16px',
      padding: '20px',
      backgroundColor: '#ffffff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      transition: 'all 0.2s ease',
      cursor: 'pointer'
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.15)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
    }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
        <h4 style={{ 
          margin: 0, 
          color: '#1e293b', 
          fontSize: '18px',
          fontWeight: '600',
          lineHeight: '1.3'
        }}>
          {service.title}
        </h4>
        
        <div style={{
          fontSize: '20px',
          fontWeight: '700',
          color: '#10b981',
          marginLeft: '16px',
          flexShrink: 0
        }}>
          ${service.price}
        </div>
      </div>
      
      {service.description && (
        <p style={{ 
          margin: '0 0 16px 0', 
          color: '#64748b', 
          fontSize: '14px',
          lineHeight: '1.5'
        }}>
          {service.description.length > 200 
            ? `${service.description.substring(0, 200)}...` 
            : service.description
          }
        </p>
      )}
      
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '16px',
        paddingTop: '12px',
        borderTop: '1px solid #f1f5f9'
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px',
          color: '#6b7280',
          fontSize: '14px'
        }}>
          <span>⏱️</span>
          <span>{service.delivery_days} day{service.delivery_days !== 1 ? 's' : ''} delivery</span>
        </div>
        
        <button
          onClick={() => {
            // You can implement contact functionality here
            console.log('Contact service provider:', service);
          }}
          style={{
            backgroundColor: '#10b981',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            marginLeft: 'auto',
            transition: 'background-color 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#059669';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#10b981';
          }}
        >
          Contact Provider
        </button>
      </div>
    </div>
  );
}
