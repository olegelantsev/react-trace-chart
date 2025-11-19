import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './TraceGraph.css';
const initialGeometry = {
    services: {},
    spans: {},
    viewport: null
};
const buildCurvePath = (start, end) => {
    const deltaX = Math.max(Math.abs(end.x - start.x) * 0.5, 60);
    return `M ${start.x} ${start.y} C ${start.x + deltaX} ${start.y}, ${end.x - deltaX} ${end.y}, ${end.x} ${end.y}`;
};
const makeSpanKey = (serviceId, spanId) => `${serviceId}:${spanId}`;
const TraceGraph = ({ services, edges = [], defaultExpandedIds = [], onExpandedChange }) => {
    const containerRef = useRef(null);
    const serviceRefs = useRef({});
    const spanRefs = useRef({});
    const [expanded, setExpanded] = useState(() => new Set(defaultExpandedIds));
    const [geometry, setGeometry] = useState(initialGeometry);
    const toggleService = useCallback((serviceId) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(serviceId)) {
                next.delete(serviceId);
            }
            else {
                next.add(serviceId);
            }
            onExpandedChange?.(Array.from(next));
            return next;
        });
    }, [onExpandedChange]);
    const registerServiceRef = useCallback((serviceId) => {
        return (node) => {
            serviceRefs.current[serviceId] = node;
        };
    }, []);
    const registerSpanRef = useCallback((serviceId, spanId) => {
        return (node) => {
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
            const serviceBoxes = {};
            const spanBoxes = {};
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
                path: buildCurvePath({ x: from.right, y: from.centerY }, { x: to.left, y: to.centerY }),
                label: edge.label ?? `${edge.from} to ${edge.to}`
            };
        })
            .filter(Boolean);
    }, [edges, geometry.services]);
    const spanConnectors = useMemo(() => {
        const connectors = [];
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
                    path: buildCurvePath({ x: spanBox.right + 16, y: spanBox.centerY }, { x: targetBox.left - 16, y: targetBox.centerY })
                });
            });
        });
        return connectors;
    }, [services, expanded, geometry.spans, geometry.services]);
    return (_jsxs("div", { className: "trace-graph", ref: containerRef, children: [geometry.viewport && (_jsxs("svg", { className: "trace-graph__edges", width: geometry.viewport.width, height: geometry.viewport.height, children: [_jsxs("defs", { children: [_jsx("marker", { id: "trace-arrowhead", markerWidth: "10", markerHeight: "10", refX: "8", refY: "5", orient: "auto", children: _jsx("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#4d7cfe" }) }), _jsx("marker", { id: "trace-span-arrow", markerWidth: "10", markerHeight: "10", refX: "8", refY: "5", orient: "auto", children: _jsx("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#00bcd4" }) })] }), serviceEdges.map((edge) => (_jsx("path", { d: edge.path, className: "trace-graph__edge", markerEnd: "url(#trace-arrowhead)", children: _jsx("title", { children: edge.label }) }, edge.id))), spanConnectors.map((connector) => (_jsx("path", { d: connector.path, className: "trace-graph__span-connector", markerEnd: "url(#trace-span-arrow)", children: _jsx("title", { children: connector.sourceLabel }) }, connector.id)))] })), _jsx("div", { className: "trace-graph__lanes", children: services.map((service) => {
                    const isExpanded = expanded.has(service.id);
                    const accent = service.accentColor ?? '#4d7cfe';
                    return (_jsxs("div", { className: "trace-graph__lane", style: { ['--accent']: accent }, children: [_jsxs("button", { type: "button", className: `trace-graph__service ${isExpanded ? 'is-expanded' : ''}`, ref: registerServiceRef(service.id), onClick: () => toggleService(service.id), "aria-expanded": isExpanded, children: [_jsxs("div", { className: "trace-graph__service-header", children: [_jsx("span", { className: "trace-graph__service-pill", "aria-hidden": true, children: service.label.slice(0, 2).toUpperCase() }), _jsxs("div", { children: [_jsx("p", { className: "trace-graph__service-name", children: service.label }), _jsxs("p", { className: "trace-graph__service-meta", children: [service.spans.length, " spans \u00B7", ' ', service.metrics?.avgLatencyMs
                                                                ? `${service.metrics.avgLatencyMs.toFixed(1)} ms`
                                                                : 'latency n/a'] })] })] }), service.metrics && (_jsxs("div", { className: "trace-graph__service-metrics", children: [service.metrics.throughputRps && (_jsxs("span", { children: [service.metrics.throughputRps.toFixed(0), " rps"] })), service.metrics.errorRatePct !== undefined && (_jsxs("span", { children: [service.metrics.errorRatePct.toFixed(2), "% errors"] }))] })), _jsx("span", { className: "trace-graph__service-toggle", children: isExpanded ? 'Fold spans' : 'Unfold spans' })] }), _jsx("div", { className: `trace-graph__span-panel ${isExpanded ? 'is-open' : ''}`, children: service.spans.map((span) => (_jsxs("div", { ref: registerSpanRef(service.id, span.id), className: `trace-graph__span trace-graph__span--${span.status ?? 'ok'}`, children: [_jsxs("div", { children: [_jsx("p", { className: "trace-graph__span-label", children: span.label }), span.durationMs !== undefined && (_jsxs("p", { className: "trace-graph__span-meta", children: [span.durationMs.toFixed(1), " ms"] }))] }), span.outboundServiceId && (_jsxs("span", { className: "trace-graph__span-target", children: ["\u21A6 ", span.outboundServiceId] }))] }, span.id))) })] }, service.id));
                }) })] }));
};
export default TraceGraph;
