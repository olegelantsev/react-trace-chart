# Directed Trace Graph

A lightweight React + Vite playground that renders an animated left-to-right
trace visualization. Each service node can unfold into its spans, and the spans
emit animated connectors to downstream services.

## Getting Started

```bash
pnpm install   # or npm/yarn
pnpm dev
```

Open the Vite dev server URL and click on any service node to unfold its spans.
The `TraceGraph` component lives in `src/components/TraceGraph.tsx`.

