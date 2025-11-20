import { useCallback, useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import './TraceGraph.css';

export type TraceSpan = {
  id: string;
  label: string;
  outboundServiceId?: string;
  outboundSpanRef?: string;
  durationMs?: number;
  status?: 'ok' | 'error';
};

export type TraceServiceNode = {
  id: string;
  label: string;
  spans: TraceSpan[];
  accentColor?: string;
  metrics?: {
    avgLatencyMs?: number;
    errorRatePct?: number;
    throughputRps?: number;
  };
};

export type TraceEdge = {
  id?: string;
  from: string;
  to: string;
  label?: string;
};

type TraceGraphProps = {
  services: TraceServiceNode[];
  edges?: TraceEdge[];
  defaultExpandedIds?: string[];
  onExpandedChange?(expandedIds: string[]): void;
};

type Box = {
  centerX: number;
  centerY: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type GeometryState = {
  services: Record<string, Box>;
  spans: Record<string, Box>;
  viewport: { width: number; height: number } | null;
};

const initialGeometry: GeometryState = {
  services: {},
  spans: {},
  viewport: null
};

const buildCurvePath = (start: { x: number; y: number }, end: { x: number; y: number }) => {
  const deltaX = Math.max(Math.abs(end.x - start.x) * 0.5, 60);
  return `M ${start.x} ${start.y} C ${start.x + deltaX} ${start.y}, ${end.x - deltaX} ${end.y}, ${end.x} ${end.y}`;
};

const makeSpanKey = (serviceId: string, spanId: string) => `${serviceId}:${spanId}`;

const TraceGraph = ({ services, edges = [], defaultExpandedIds = [], onExpandedChange }: TraceGraphProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const serviceRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const spanRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpandedIds));
  const [geometry, setGeometry] = useState<GeometryState>(initialGeometry);

  // new: absolute positions + drag state (pointer-based so services can be dropped anywhere)
  const [positions, setPositions] = useState<Record<string, { left: number; top: number }>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // keep service refs in sync with services prop (no ordering state needed)
  useEffect(() => {
    // ensure we at least have position keys for new services once geometry is measured
    if (!geometry.viewport) return;

    setPositions((prev) => {
      // if we already have positions for any service, only seed missing ones from measured boxes
      const existingKeys = Object.keys(prev);
      if (existingKeys.length > 0) {
        const next = { ...prev };
        let changed = false;
        services.forEach((s) => {
          if (next[s.id]) return;
          const box = geometry.services[s.id];
          if (!box) return;
          next[s.id] = { left: Math.max(8, Math.round(box.left)), top: Math.max(8, Math.round(box.top)) };
          changed = true;
        });
        return changed ? next : prev;
      }

      // No existing positions: distribute nodes around the viewport in a simple grid
      const viewport = geometry.viewport!;
      const n = services.length;
      if (n === 0) return prev;

      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const margin = 12;
      const cellW = viewport.width / (cols + 1);
      const cellH = viewport.height / (rows + 1);

      const next: Record<string, { left: number; top: number }> = {};

      services.forEach((s, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);

        // prefer measured size when available
        const box = geometry.services[s.id];
        const svcWidth = box ? Math.max(120, box.right - box.left) : 240;
        const svcHeight = box ? Math.max(40, box.bottom - box.top) : 56;

        const centerX = (col + 1) * cellW;
        const centerY = (row + 1) * cellH;

        let left = Math.round(centerX - svcWidth / 2);
        let top = Math.round(centerY - svcHeight / 2);

        // clamp to viewport with margin
        left = Math.max(margin, Math.min(left, Math.max(margin, viewport.width - svcWidth - margin)));
        top = Math.max(margin, Math.min(top, Math.max(margin, viewport.height - svcHeight - margin)));

        next[s.id] = { left, top };
      });

      return next;
    });
  }, [services, geometry]);

  const toggleService = useCallback(
    (serviceId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(serviceId)) {
          next.delete(serviceId);
        } else {
          next.add(serviceId);
        }
        onExpandedChange?.(Array.from(next));
        return next;
      });
    },
    [onExpandedChange]
  );

  const registerServiceRef = useCallback((serviceId: string) => {
    return (node: HTMLButtonElement | null) => {
      serviceRefs.current[serviceId] = node;
    };
  }, []);

  const registerSpanRef = useCallback((serviceId: string, spanId: string) => {
    return (node: HTMLDivElement | null) => {
      spanRefs.current[makeSpanKey(serviceId, spanId)] = node;
    };
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const host = containerRef.current;
      if (!host) {
        return;
      }

      const hostRect = host.getBoundingClientRect();
      const serviceBoxes: Record<string, Box> = {};
      const spanBoxes: Record<string, Box> = {};

      services.forEach((service) => {
        const element = serviceRefs.current[service.id];
        if (!element) {
          return;
        }
        const rect = element.getBoundingClientRect();
        serviceBoxes[service.id] = {
          centerX: rect.left - hostRect.left + rect.width / 2,
          centerY: rect.top - hostRect.top + rect.height / 2,
          left: rect.left - hostRect.left,
          right: rect.right - hostRect.left,
          top: rect.top - hostRect.top,
          bottom: rect.bottom - hostRect.top
        };
      });

      services.forEach((service) => {
        if (!expanded.has(service.id)) {
          return;
        }
        service.spans.forEach((span) => {
          const key = makeSpanKey(service.id, span.id);
          const element = spanRefs.current[key];
          if (!element) {
            return;
          }
          const rect = element.getBoundingClientRect();
          spanBoxes[key] = {
            centerX: rect.right - hostRect.left,
            centerY: rect.top - hostRect.top + rect.height / 2,
            left: rect.left - hostRect.left,
            right: rect.right - hostRect.left,
            top: rect.top - hostRect.top,
            bottom: rect.bottom - hostRect.top
          };
        });
      });

      // debug: print measurement summary
      // eslint-disable-next-line no-console
      console.debug('TraceGraph.measure', {
        servicesCount: services.length,
        expanded: Array.from(expanded),
        hostRect: { width: hostRect.width, height: hostRect.height, left: hostRect.left, top: hostRect.top },
        serviceBoxesCount: Object.keys(serviceBoxes).length,
        spanBoxesCount: Object.keys(spanBoxes).length
      });

      setGeometry({
        services: serviceBoxes,
        spans: spanBoxes,
        viewport: { width: hostRect.width, height: hostRect.height }
      });
    };

    measure();

    const resizeObserver = new ResizeObserver(() => {
      measure();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', measure, { passive: true });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [services, expanded]);

  // new: re-measure live during dragging / when positions change so connectors redraw immediately
  useLayoutEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    const hostRect = host.getBoundingClientRect();
    const serviceBoxes: Record<string, Box> = {};
    const spanBoxes: Record<string, Box> = {};

    services.forEach((service) => {
      // prefer DOM rect where available so we keep accurate sizes,
      // but if DOM hasn't updated yet we fall back to last measured geometry and apply positions override
      const domEl = serviceRefs.current[service.id];
      let rect: DOMRect | null = null;
      if (domEl) {
        rect = domEl.getBoundingClientRect();
      }

      const prev = geometry.services[service.id];
      const width = rect ? rect.width : prev ? prev.right - prev.left : 240;
      const height = rect ? rect.height : prev ? prev.bottom - prev.top : 56;

      const pos = positions[service.id];
      const left = pos ? pos.left : (rect ? rect.left - hostRect.left : prev ? prev.left : 16);
      const top = pos ? pos.top : (rect ? rect.top - hostRect.top : prev ? prev.top : 16);

      serviceBoxes[service.id] = {
        left,
        top,
        right: left + width,
        bottom: top + height,
        centerX: left + width / 2,
        centerY: top + height / 2
      };
    });

    services.forEach((service) => {
      if (!expanded.has(service.id)) return;
      service.spans.forEach((span) => {
        const key = makeSpanKey(service.id, span.id);
        const element = spanRefs.current[key];
        if (!element) return;
        const rect = element.getBoundingClientRect();
        spanBoxes[key] = {
          centerX: rect.right - hostRect.left,
          centerY: rect.top - hostRect.top + rect.height / 2,
          left: rect.left - hostRect.left,
          right: rect.right - hostRect.left,
          top: rect.top - hostRect.top,
          bottom: rect.bottom - hostRect.top
        };
      });
    });

    // update geometry so serviceEdges / spanConnectors recompute using live positions
    setGeometry((prev) => {
      // shallow-equality check to avoid unnecessary updates
      const sameServices = Object.keys(serviceBoxes).length === Object.keys(prev.services).length &&
        Object.keys(serviceBoxes).every((k) => {
          const a = (prev.services as any)[k];
          const b = (serviceBoxes as any)[k];
          return a && b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
        });
      const sameSpans = Object.keys(spanBoxes).length === Object.keys(prev.spans).length &&
        Object.keys(spanBoxes).every((k) => {
          const a = (prev.spans as any)[k];
          const b = (spanBoxes as any)[k];
          return a && b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
        });
      const viewport = { width: hostRect.width, height: hostRect.height };
      if (sameServices && sameSpans && prev.viewport && prev.viewport.width === viewport.width && prev.viewport.height === viewport.height) {
        return prev;
      }
      return { services: serviceBoxes, spans: spanBoxes, viewport };
    });
  }, [positions, draggingId, services, expanded, geometry.services, geometry.spans]);

  const serviceEdges = useMemo(() => {
    const result = edges
      .map((edge) => {
        const from = geometry.services[edge.from];
        const to = geometry.services[edge.to];
        if (!from || !to) {
          // eslint-disable-next-line no-console
          console.debug('TraceGraph.serviceEdges: skipping edge, missing geometry', { edge, fromExists: !!from, toExists: !!to });
          return null;
        }
        return {
          id: edge.id ?? `${edge.from}->${edge.to}`,
          path: buildCurvePath(
            { x: from.right, y: from.centerY },
            { x: to.left, y: to.centerY }
          ),
          label: edge.label ?? `${edge.from} to ${edge.to}`
        };
      })
      .filter(Boolean) as { id: string; path: string; label: string }[];

    // eslint-disable-next-line no-console
    console.debug('TraceGraph.serviceEdges', { computed: result, servicesGeom: geometry.services, edges });

    return result;
  }, [edges, geometry.services]);

  const spanConnectors = useMemo(() => {
    const connectors: { id: string; path: string; sourceLabel: string }[] = [];
    const added = new Set<string>();

    // Helper: add connector if not already present
    const pushConnector = (id: string, srcLabel: string, start: { x: number; y: number }, end: { x: number; y: number }) => {
      if (added.has(id)) return;
      added.add(id);
      connectors.push({
        id,
        sourceLabel: srcLabel,
        path: buildCurvePath(start, end)
      });
    };

    // 1) Outgoing connectors from unfolded spans (span -> span or span -> service)
    services.forEach((svc) => {
      if (!expanded.has(svc.id)) return;
      svc.spans.forEach((span) => {
        const spanBox = geometry.spans[makeSpanKey(svc.id, span.id)];
        if (!spanBox) return;

        if (span.outboundSpanRef) {
          const parts = span.outboundSpanRef.split(':');
          if (parts.length === 2) {
            const targetSpanBox = geometry.spans[makeSpanKey(parts[0], parts[1])];
            if (targetSpanBox) {
              pushConnector(
                `${svc.id}:${span.id}->${span.outboundSpanRef}`,
                span.label,
                { x: spanBox.right + 16, y: spanBox.centerY },
                { x: targetSpanBox.left - 12, y: targetSpanBox.centerY }
              );
              return;
            }
          }
        }

        if (span.outboundServiceId) {
          const targetBox = geometry.services[span.outboundServiceId];
          if (targetBox) {
            pushConnector(
              `${svc.id}:${span.id}->${span.outboundServiceId}`,
              span.label,
              { x: spanBox.right + 16, y: spanBox.centerY },
              { x: targetBox.left - 16, y: targetBox.centerY }
            );
          }
        }
      });
    });

    // 2) Incoming connectors into unfolded spans:
    //    a) from other spans that explicitly target this span via outboundSpanRef
    services.forEach((srcSvc) => {
      srcSvc.spans.forEach((srcSpan) => {
        if (!srcSpan.outboundSpanRef) return;
        const parts = srcSpan.outboundSpanRef.split(':');
        if (parts.length !== 2) return;
        const targetKey = makeSpanKey(parts[0], parts[1]);
        const targetBox = geometry.spans[targetKey];
        if (!targetBox) return;
        // only show incoming if target service is expanded
        if (!expanded.has(parts[0])) return;
        const srcBox = geometry.spans[makeSpanKey(srcSvc.id, srcSpan.id)] ?? geometry.services[srcSvc.id];
        if (!srcBox) return;
        pushConnector(
          `${srcSvc.id}:${srcSpan.id}->${targetKey}:IN`,
          srcSpan.label,
          { x: srcBox.right + 16, y: srcBox.centerY },
          { x: targetBox.left - 12, y: targetBox.centerY }
        );
      });
    });

    //    b) from services (service->service edges) into unfolded spans of the target service
    edges.forEach((edge) => {
      const targetSvcId = edge.to;
      // find expanded service spans for the edge target
      const targetService = services.find((s) => s.id === targetSvcId);
      if (!targetService || !expanded.has(targetSvcId)) return;
      const sourceBox = geometry.services[edge.from];
      if (!sourceBox) return;
      // connect service edge into each visible span of the expanded target service
      targetService.spans.forEach((tspan) => {
        const targetSpanBox = geometry.spans[makeSpanKey(targetSvcId, tspan.id)];
        if (!targetSpanBox) return;
        pushConnector(
          `${edge.from}->${targetSvcId}:${tspan.id}`,
          edge.label ?? `${edge.from} → ${targetSvcId}`,
          { x: sourceBox.right, y: sourceBox.centerY },
          { x: targetSpanBox.left - 12, y: targetSpanBox.centerY }
        );
      });
    });

    // debug: print connectors summary and any spans referenced but missing geometry
    // eslint-disable-next-line no-console
    console.debug('TraceGraph.spanConnectors', {
      computedCount: connectors.length,
      connectors,
      spansGeomKeys: Object.keys(geometry.spans),
      servicesGeomKeys: Object.keys(geometry.services),
      expanded: Array.from(expanded)
    });

    return connectors;
  }, [services, expanded, geometry.spans, geometry.services]);

  // Pointer-based dragging so services can be dropped anywhere inside the container
  const pointerState = useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startLeft: number;
    startTop: number;
    svcId: string;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent, svcId: string) => {
    // Only start dragging when the pointerdown originates from the drag handle.
    // This preserves clicks on the service button (fold/unfold).
    const origin = e.target as Element | null;
    if (!origin || !origin.closest('.trace-graph__drag-handle')) {
      return;
    }

    const laneEl = e.currentTarget as HTMLElement;
    if (!containerRef.current) return;
    // start pointer capture on the lane so we receive move/up events
    laneEl.setPointerCapture(e.pointerId);
    const hostRect = containerRef.current.getBoundingClientRect();
    const rect = laneEl.getBoundingClientRect();
    const startLeft = rect.left - hostRect.left;
    const startTop = rect.top - hostRect.top;

    pointerState.current = {
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      startLeft,
      startTop,
      svcId
    };
    setDraggingId(svcId);
    // prevent native dragging/selection only when we started a drag
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const state = pointerState.current;
    if (!state || state.pointerId !== e.pointerId) return;
    if (!containerRef.current) return;

    const hostRect = containerRef.current.getBoundingClientRect();
    const btn = serviceRefs.current[state.svcId];
    const btnRect = btn?.getBoundingClientRect();
    const width = btnRect ? btnRect.width : 240;
    const height = btnRect ? btnRect.height : 56;

    const dx = e.clientX - state.originX;
    const dy = e.clientY - state.originY;
    let nextLeft = state.startLeft + dx;
    let nextTop = state.startTop + dy;

    // clamp within container bounds
    nextLeft = Math.max(4, Math.min(nextLeft, Math.max(4, (hostRect.width - width - 4))));
    nextTop = Math.max(4, Math.min(nextTop, Math.max(4, (hostRect.height - height - 4))));

    setPositions((prev) => {
      const next = { ...prev, [state.svcId]: { left: Math.round(nextLeft), top: Math.round(nextTop) } };
      return next;
    });

    // prevent text selection / native panning
    e.preventDefault();
  }, []);

  const endPointerDrag = useCallback((e: React.PointerEvent) => {
    const state = pointerState.current;
    if (!state) return;
    const target = e.currentTarget as HTMLElement;
    try {
      target.releasePointerCapture(state.pointerId);
    } catch {
      // ignore
    }
    pointerState.current = null;
    setDraggingId(null);
  }, []);

  // render (services absolutely positioned based on positions state)
  return (
    <div className="trace-graph" ref={containerRef} style={{ position: 'relative' }}>
      {geometry.viewport && (
        <svg
          className="trace-graph__edges"
          width={geometry.viewport.width}
          height={geometry.viewport.height}
        >
          <defs>
            <marker
              id="trace-arrowhead"
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="5"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4d7cfe" />
            </marker>
            <marker
              id="trace-span-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="5"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#00bcd4" />
            </marker>
          </defs>
          {serviceEdges.map((edge) => (
            <path
              key={edge.id}
              d={edge.path}
              className="trace-graph__edge"
              markerEnd="url(#trace-arrowhead)"
            >
              <title>{edge.label}</title>
            </path>
          ))}
          {spanConnectors.map((connector) => (
            <path
              key={connector.id}
              d={connector.path}
              className="trace-graph__span-connector"
              markerEnd="url(#trace-span-arrow)"
            >
              <title>{connector.sourceLabel}</title>
            </path>
          ))}
        </svg>
      )}
      <div className="trace-graph__lanes">
        {services.map((service, idx) => {
          const isExpanded = expanded.has(service.id);
          const accent = service.accentColor ?? '#4d7cfe';
          const isDragging = draggingId === service.id;

          const pos = positions[service.id];
          const laneStyle: React.CSSProperties = {
            position: 'absolute',
            left: pos ? pos.left : 16 + idx * 8,
            top: pos ? pos.top : 16 + idx * 96,
            zIndex: isDragging ? 999 : 1,
            ['--accent' as any]: accent
          };

          return (
            <div
              key={service.id}
              className={`trace-graph__lane ${isDragging ? 'is-dragging' : ''}`}
              style={laneStyle}
              onPointerDown={(e) => onPointerDown(e, service.id)}
              onPointerMove={onPointerMove}
              onPointerUp={endPointerDrag}
              onPointerCancel={endPointerDrag}
            >
              <button
                type="button"
                className={`trace-graph__service ${isExpanded ? 'is-expanded' : ''}`}
                ref={registerServiceRef(service.id)}
                onClick={() => toggleService(service.id)}
                aria-expanded={isExpanded}
              >
                {/* drag handle: clicking it should NOT toggle the service (prevent propagation on click) */}
                <div
                  className="trace-graph__drag-handle"
                  role="button"
                  aria-label="Drag service"
                  onClick={(ev) => {
                    // Prevent the button's onClick (fold/unfold) when handle is clicked.
                    ev.stopPropagation();
                    ev.preventDefault();
                  }}
                />
                <div className="trace-graph__service-header">
                  <span className="trace-graph__service-pill" aria-hidden>
                    {service.label.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <p className="trace-graph__service-name">{service.label}</p>
                    <p className="trace-graph__service-meta">
                      {service.spans.length} spans ·{' '}
                      {service.metrics?.avgLatencyMs
                        ? `${service.metrics.avgLatencyMs.toFixed(1)} ms`
                        : 'latency n/a'}
                    </p>
                  </div>
                </div>
                {service.metrics && (
                  <div className="trace-graph__service-metrics">
                    {service.metrics.throughputRps && (
                      <span>{service.metrics.throughputRps.toFixed(0)} rps</span>
                    )}
                    {service.metrics.errorRatePct !== undefined && (
                      <span>{service.metrics.errorRatePct.toFixed(2)}% errors</span>
                    )}
                  </div>
                )}
                <span className="trace-graph__service-toggle">
                  {isExpanded ? 'Fold spans' : 'Unfold spans'}
                </span>
              </button>
              <div className={`trace-graph__span-panel ${isExpanded ? 'is-open' : ''}`}>
                {service.spans.map((span) => (
                  <div
                    key={span.id}
                    ref={registerSpanRef(service.id, span.id)}
                    className={`trace-graph__span trace-graph__span--${span.status ?? 'ok'}`}
                  >
                    <div>
                      <p className="trace-graph__span-label">{span.label}</p>
                      {span.durationMs !== undefined && (
                        <p className="trace-graph__span-meta">{span.durationMs.toFixed(1)} ms</p>
                      )}
                    </div>
                    {span.outboundServiceId && (
                      <span className="trace-graph__span-target">
                        ↦ {span.outboundServiceId}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TraceGraph;

