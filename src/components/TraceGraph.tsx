import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import './TraceGraph.css';

export type TraceSpan = {
  id: string;
  label: string;
  outboundServiceId?: string;
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

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.8;
const ZOOM_STEP = 0.1;

const TraceGraph = ({ services, edges = [], defaultExpandedIds = [], onExpandedChange }: TraceGraphProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const serviceRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const spanRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpandedIds));
  const [geometry, setGeometry] = useState<GeometryState>(initialGeometry);
  const [zoom, setZoom] = useState(0.9);

  const clampZoom = useCallback((value: number) => {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(value.toFixed(2))));
  }, []);

  const handleZoomDelta = useCallback(
    (delta: number) => {
      setZoom((prev) => clampZoom(prev + delta));
    },
    [clampZoom]
  );

  const handleZoomSlider = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = parseFloat(event.target.value);
      setZoom(clampZoom(value));
    },
    [clampZoom]
  );

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

      const scaleFactor = zoom || 1;
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
          centerX: (rect.left - hostRect.left + rect.width / 2) / scaleFactor,
          centerY: (rect.top - hostRect.top + rect.height / 2) / scaleFactor,
          left: (rect.left - hostRect.left) / scaleFactor,
          right: (rect.right - hostRect.left) / scaleFactor,
          top: (rect.top - hostRect.top) / scaleFactor,
          bottom: (rect.bottom - hostRect.top) / scaleFactor
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
            centerX: (rect.right - hostRect.left) / scaleFactor,
            centerY: (rect.top - hostRect.top + rect.height / 2) / scaleFactor,
            left: (rect.left - hostRect.left) / scaleFactor,
            right: (rect.right - hostRect.left) / scaleFactor,
            top: (rect.top - hostRect.top) / scaleFactor,
            bottom: (rect.bottom - hostRect.top) / scaleFactor
          };
        });
      });

      setGeometry({
        services: serviceBoxes,
        spans: spanBoxes,
        viewport: { width: hostRect.width / scaleFactor, height: hostRect.height / scaleFactor }
      });
    };

    measure();

    const resizeObserver = new ResizeObserver(() => {
      measure();
    });

    const hostEl = containerRef.current;
    if (hostEl) {
      resizeObserver.observe(hostEl);
      hostEl.addEventListener('scroll', measure, { passive: true });
    }

    window.addEventListener('resize', measure, { passive: true });

    return () => {
      resizeObserver.disconnect();
      hostEl?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [services, expanded, zoom]);

  const serviceEdges = useMemo(() => {
    return edges
      .map((edge) => {
        const from = geometry.services[edge.from];
        const to = geometry.services[edge.to];
        if (!from || !to) {
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
  }, [edges, geometry.services]);

  const spanConnectors = useMemo(() => {
    const connectors: { id: string; path: string; sourceLabel: string }[] = [];
    services.forEach((service) => {
      if (!expanded.has(service.id)) {
        return;
      }
      service.spans.forEach((span) => {
        if (!span.outboundServiceId) {
          return;
        }
        const spanBox = geometry.spans[makeSpanKey(service.id, span.id)];
        const targetBox = geometry.services[span.outboundServiceId];
        if (!spanBox || !targetBox) {
          return;
        }
        connectors.push({
          id: `${service.id}:${span.id}->${span.outboundServiceId}`,
          sourceLabel: span.label,
          path: buildCurvePath(
            { x: spanBox.right + 16, y: spanBox.centerY },
            { x: targetBox.left - 16, y: targetBox.centerY }
          )
        });
      });
    });
    return connectors;
  }, [services, expanded, geometry.spans, geometry.services]);

  const svgDimensions = useMemo(() => {
    if (!geometry.viewport) {
      return null;
    }
    const serviceBoxes = Object.values(geometry.services);
    const spanBoxes = Object.values(geometry.spans);
    const widthCandidates = [
      geometry.viewport.width,
      ...serviceBoxes.map((box) => box.right + 120),
      ...spanBoxes.map((box) => box.right + 160)
    ];
    const heightCandidates = [
      geometry.viewport.height,
      ...serviceBoxes.map((box) => box.bottom + 80),
      ...spanBoxes.map((box) => box.bottom + 80)
    ];

    return {
      width: Math.max(...widthCandidates, 0),
      height: Math.max(...heightCandidates, 0)
    };
  }, [geometry]);

  return (
    <div className="trace-graph">
      <div className="trace-graph__controls">
        <div>
          <span className="trace-graph__controls-label">Zoom</span>
          <input
            className="trace-graph__zoom-slider"
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.05}
            value={zoom}
            onChange={handleZoomSlider}
          />
        </div>
        <div className="trace-graph__zoom-buttons">
          <button type="button" onClick={() => handleZoomDelta(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => handleZoomDelta(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>
            +
          </button>
        </div>
      </div>
      <div className="trace-graph__viewport" ref={containerRef}>
        <div
          className="trace-graph__canvas"
          style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}
        >
          {svgDimensions && (
            <svg className="trace-graph__edges" width={svgDimensions.width} height={svgDimensions.height}>
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
            {services.map((service) => {
              const isExpanded = expanded.has(service.id);
              const accent = service.accentColor ?? '#4d7cfe';
              return (
                <div
                  key={service.id}
                  className="trace-graph__lane"
                  style={{ ['--accent' as string]: accent }}
                >
                  <button
                    type="button"
                    className={`trace-graph__service ${isExpanded ? 'is-expanded' : ''}`}
                    ref={registerServiceRef(service.id)}
                    onClick={() => toggleService(service.id)}
                    aria-expanded={isExpanded}
                  >
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
      </div>
    </div>
  );
};

export default TraceGraph;

