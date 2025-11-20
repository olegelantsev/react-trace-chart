import TraceGraph, { TraceEdge, TraceServiceNode } from './components/TraceGraph';

const services: TraceServiceNode[] = [
  {
    id: 'ingress',
    label: 'Ingress Gateway',
    accentColor: '#7c3aed',
    metrics: { avgLatencyMs: 2.5, throughputRps: 1800, errorRatePct: 0.1 },
    spans: [
      {
        id: 'ingress-accept',
        label: 'Accept HTTP',
        durationMs: 2.1,
        outboundServiceId: 'auth',
        // goes specifically into the auth.verify span
        outboundSpanRef: 'auth:auth-verify'
      }
    ]
  },
  {
    id: 'auth',
    label: 'Auth Service',
    accentColor: '#2563eb',
    metrics: { avgLatencyMs: 6.2, throughputRps: 1650, errorRatePct: 0.35 },
    spans: [
      {
        id: 'auth-verify',
        label: 'Verify Token',
        durationMs: 4.2,
        outboundServiceId: 'profile',
        outboundSpanRef: 'profile:profile-read'
      },
      {
        id: 'auth-cache',
        label: 'Redis lookup',
        durationMs: 2.0
      }
    ]
  },
  {
    id: 'profile',
    label: 'Profile Service',
    accentColor: '#059669',
    metrics: { avgLatencyMs: 10.4, throughputRps: 1120, errorRatePct: 1.2 },
    spans: [
      {
        id: 'profile-read',
        label: 'Read document',
        durationMs: 8.5,
        outboundServiceId: 'billing',
        outboundSpanRef: 'billing:billing-charge'
      },
      {
        id: 'profile-aggregate',
        label: 'Aggregate preferences',
        durationMs: 3.6
      }
    ]
  },
  {
    id: 'billing',
    label: 'Billinge Service',
    accentColor: '#f97316',
    metrics: { avgLatencyMs: 18.6, throughputRps: 740, errorRatePct: 2.3 },
    spans: [
      {
        id: 'billing-charge',
        label: 'Create charge',
        durationMs: 12.5,
        outboundServiceId: 'ledger',
        status: 'error',
        outboundSpanRef: 'ledger:ledger-write'
      }
    ]
  },
  {
    id: 'ledger',
    label: 'Ledger Service',
    accentColor: '#e11d48',
    metrics: { avgLatencyMs: 24.0, throughputRps: 520, errorRatePct: 0.95 },
    spans: [
      {
        id: 'ledger-write',
        label: 'Write transaction',
        durationMs: 18.4
      }
    ]
  }
];

const edges: TraceEdge[] = [
  { from: 'ingress', to: 'auth', label: 'authn' },
  { from: 'auth', to: 'profile', label: 'user context' },
  { from: 'profile', to: 'billing', label: 'charge request' },
  { from: 'billing', to: 'ledger', label: 'ledger write' },
];

const App = () => {
  return (
    <main style={{ padding: '60px', background: '#e9ecf9', minHeight: '100vh' }}>
      <TraceGraph services={services} edges={edges} defaultExpandedIds={['auth']} />
    </main>
  );
};

export default App;

