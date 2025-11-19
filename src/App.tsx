import TraceGraph, { TraceEdge, TraceServiceNode, TraceSpan } from './components/TraceGraph';

const servicePalette = [
  '#7c3aed',
  '#2563eb',
  '#059669',
  '#0ea5e9',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
  '#6366f1'
];

const serviceDefinitions = [
  { id: 'edge-gateway', label: 'Edge Gateway' },
  { id: 'auth-filter', label: 'Auth Filter' },
  { id: 'session-orchestrator', label: 'Session Orchestrator' },
  { id: 'traffic-shaper', label: 'Traffic Shaper' },
  { id: 'personalization-engine', label: 'Personalization Engine' },
  { id: 'inventory-catalog', label: 'Inventory Catalog' },
  { id: 'pricing-hub', label: 'Pricing Hub' },
  { id: 'recommendation-hub', label: 'Recommendation Hub' },
  { id: 'payments-core', label: 'Payments Core' },
  { id: 'ledger-writer', label: 'Ledger Writer' }
];

const dependencyMatrix: Record<string, string[]> = {
  'edge-gateway': ['auth-filter', 'session-orchestrator', 'traffic-shaper'],
  'auth-filter': ['session-orchestrator', 'traffic-shaper', 'personalization-engine'],
  'session-orchestrator': ['traffic-shaper', 'personalization-engine', 'inventory-catalog'],
  'traffic-shaper': ['personalization-engine', 'pricing-hub', 'recommendation-hub'],
  'personalization-engine': ['pricing-hub', 'recommendation-hub', 'payments-core'],
  'inventory-catalog': ['pricing-hub', 'payments-core', 'ledger-writer'],
  'pricing-hub': ['recommendation-hub', 'payments-core', 'ledger-writer'],
  'recommendation-hub': ['payments-core', 'ledger-writer', 'auth-filter'],
  'payments-core': ['ledger-writer', 'traffic-shaper', 'personalization-engine'],
  'ledger-writer': ['auth-filter', 'session-orchestrator', 'inventory-catalog']
};

const labelLookup = Object.fromEntries(serviceDefinitions.map((svc) => [svc.id, svc.label]));

const buildServices = (): TraceServiceNode[] => {
  return serviceDefinitions.map((service, index) => {
    const accentColor = servicePalette[index % servicePalette.length];
    const dependents = dependencyMatrix[service.id];

    const spans = dependents.map((targetId, spanIndex) => {
      const status: TraceSpan['status'] =
        spanIndex === 2 && (index + spanIndex) % 4 === 0 ? 'error' : 'ok';
      return {
        id: `${service.id}-span-${spanIndex}`,
        label: `RPC → ${labelLookup[targetId]}`,
        durationMs: +(5 + Math.random() * 20).toFixed(1),
        outboundServiceId: targetId,
        status
      };
    });

    return {
      id: service.id,
      label: service.label,
      accentColor,
      spans,
      metrics: {
        avgLatencyMs: 5 + index * 2.3,
        throughputRps: 2400 - index * 120,
        errorRatePct: index % 3 === 0 ? 1.5 : 0.4 + index * 0.15
      }
    };
  });
};

const buildEdges = (): TraceEdge[] => {
  const seen = new Set<string>();
  const edges: TraceEdge[] = [];

  Object.entries(dependencyMatrix).forEach(([from, targets]) => {
    targets.forEach((to, idx) => {
      const key = `${from}->${to}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      edges.push({
        id: key,
        from,
        to,
        label: idx === 0 ? 'critical path' : idx === 1 ? 'fanout' : 'async tap'
      });
    });
  });

  return edges;
};

const services: TraceServiceNode[] = buildServices();
const edges: TraceEdge[] = buildEdges();

const App = () => {
  return (
    <main style={{ padding: '60px', background: '#e9ecf9', minHeight: '100vh' }}>
      <TraceGraph services={services} edges={edges} defaultExpandedIds={services.map((svc) => svc.id)} />
    </main>
  );
};

export default App;

