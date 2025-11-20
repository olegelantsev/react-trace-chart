import { useCallback, useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
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

const makeSpanKey = (serviceId: string, spanId: string) => `${serviceId}:${spanId}`;

/*
  New implementation: render edges and span connectors using WebGL (via a <canvas>).
  The DOM structure for services + spans is kept for interaction/measure/accessibility.
  WebGL draws curved lines by sampling cubic bezier segments as a LINE_STRIP and draws
  small triangle arrowheads for direction.
*/

const vertexShaderSrc = `
  attribute vec2 a_position;
  uniform vec2 u_resolution;
  void main() {
    // convert from pixels to clipspace
    vec2 zeroToOne = a_position / u_resolution;
    vec2 zeroToTwo = zeroToOne * 2.0;
    vec2 clipSpace = zeroToTwo - 1.0;
    // flip Y because DOM coordinates have origin top-left
    gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
  }
`;

const fragmentShaderSrc = `
  precision mediump float;
  uniform vec4 u_color;
  void main() {
    gl_FragColor = u_color;
  }
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Could not compile shader:\n' + info);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vSrc: string, fSrc: string) {
  const v = createShader(gl, gl.VERTEX_SHADER, vSrc);
  const f = createShader(gl, gl.FRAGMENT_SHADER, fSrc);
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('Could not link program:\n' + info);
  }
  return p;
}

function sampleCubicBezier(start: { x: number; y: number }, cp1: { x: number; y: number }, cp2: { x: number; y: number }, end: { x: number; y: number }, segments = 48) {
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt * mt * mt * start.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * end.x;
    const y = mt * mt * mt * start.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * end.y;
    pts.push(x, y);
  }
  return pts;
}

const buildCurveSamples = (start: { x: number; y: number }, end: { x: number; y: number }) => {
  const deltaX = Math.max(Math.abs(end.x - start.x) * 0.5, 60);
  const cp1 = { x: start.x + deltaX, y: start.y };
  const cp2 = { x: end.x - deltaX, y: end.y };
  return sampleCubicBezier(start, cp1, cp2, end, 48);
};

const TraceGraph = ({ services, edges = [], defaultExpandedIds = [], onExpandedChange }: TraceGraphProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const serviceRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const spanRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpandedIds));
  const [geometry, setGeometry] = useState<GeometryState>(initialGeometry);

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

  // Prepare line/connector samples to feed WebGL
  const serviceEdgesSamples = useMemo(() => {
    if (!geometry.viewport) return [];
    const samples: { id: string; points: number[]; color: [number, number, number, number] }[] = [];
    edges.forEach((edge) => {
      const from = geometry.services[edge.from];
      const to = geometry.services[edge.to];
      if (!from || !to) return;
      const pts = buildCurveSamples({ x: from.right, y: from.centerY }, { x: to.left, y: to.centerY });
      samples.push({ id: edge.id ?? `${edge.from}->${edge.to}`, points: pts, color: [0.305, 0.486, 0.996, 1] }); // #4d7cfe
    });
    return samples;
  }, [edges, geometry]);

  const spanConnectorSamples = useMemo(() => {
    if (!geometry.viewport) return [];
    const samples: { id: string; points: number[]; color: [number, number, number, number] }[] = [];
    services.forEach((service) => {
      if (!expanded.has(service.id)) return;
      service.spans.forEach((span) => {
        if (!span.outboundServiceId) return;
        const spanBox = geometry.spans[makeSpanKey(service.id, span.id)];
        const targetBox = geometry.services[span.outboundServiceId];
        if (!spanBox || !targetBox) return;
        const pts = buildCurveSamples(
          { x: spanBox.right + 16, y: spanBox.centerY },
          { x: targetBox.left - 16, y: targetBox.centerY }
        );
        samples.push({ id: `${service.id}:${span.id}->${span.outboundServiceId}`, points: pts, color: [0.0, 0.737, 0.831, 1] }); // #00bcd4
      });
    });
    return samples;
  }, [services, expanded, geometry]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = containerRef.current;
    if (!canvas || !host || !geometry.viewport) return;

    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) return;

    // resize canvas to match css pixels
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(geometry.viewport.width * dpr));
    const height = Math.max(1, Math.floor(geometry.viewport.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${geometry.viewport.width}px`;
      canvas.style.height = `${geometry.viewport.height}px`;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const program = createProgram(gl, vertexShaderSrc, fragmentShaderSrc);
    gl.useProgram(program);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const colorLoc = gl.getUniformLocation(program, 'u_color');

    // helper to draw a polyline (as LINE_STRIP)
    const drawPolyline = (pointsPx: number[], color: [number, number, number, number]) => {
      // convert points to device pixels (account for dpr)
      const scaled: number[] = [];
      for (let i = 0; i < pointsPx.length; i += 2) {
        scaled.push(pointsPx[i] * dpr, pointsPx[i + 1] * dpr);
      }
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(scaled), gl.STREAM_DRAW);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resLoc!, canvas.width, canvas.height);
      gl.uniform4f(colorLoc!, color[0], color[1], color[2], color[3]);
      // draw as line strip; lineWidth is implementation dependent in WebGL
      gl.lineWidth(1);
      gl.drawArrays(gl.LINE_STRIP, 0, scaled.length / 2);
      gl.deleteBuffer(buffer);
    };

    // draw arrowhead (simple filled triangle) at the end of a sampled curve
    const drawArrowTriangle = (tipPx: { x: number; y: number }, dirPx: { x: number; y: number }, color: [number, number, number, number]) => {
      // perpendicular vector
      const len = Math.hypot(dirPx.x, dirPx.y) || 1;
      const ux = dirPx.x / len;
      const uy = dirPx.y / len;
      const size = 10 * dpr;
      const left = { x: tipPx.x - ux * size + uy * (size * 0.5), y: tipPx.y - uy * size - ux * (size * 0.5) };
      const right = { x: tipPx.x - ux * size - uy * (size * 0.5), y: tipPx.y - uy * size + ux * (size * 0.5) };
      const tri = [tipPx.x * dpr, tipPx.y * dpr, left.x * dpr, left.y * dpr, right.x * dpr, right.y * dpr];
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tri), gl.STREAM_DRAW);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(resLoc!, canvas.width, canvas.height);
      gl.uniform4f(colorLoc!, color[0], color[1], color[2], color[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.deleteBuffer(buffer);
    };

    // draw service edges
    serviceEdgesSamples.forEach((s) => {
      drawPolyline(s.points, s.color);
      // draw arrow at end: compute last segment direction
      const pts = s.points;
      if (pts.length >= 4) {
        const px = pts[pts.length - 2];
        const py = pts[pts.length - 1];
        const prevx = pts[pts.length - 4];
        const prevy = pts[pts.length - 3];
        drawArrowTriangle({ x: px, y: py }, { x: px - prevx, y: py - prevy }, s.color);
      }
    });

    // draw span connectors
    spanConnectorSamples.forEach((s) => {
      drawPolyline(s.points, s.color);
      const pts = s.points;
      if (pts.length >= 4) {
        const px = pts[pts.length - 2];
        const py = pts[pts.length - 1];
        const prevx = pts[pts.length - 4];
        const prevy = pts[pts.length - 3];
        drawArrowTriangle({ x: px, y: py }, { x: px - prevx, y: py - prevy }, s.color);
      }
    });

    // cleanup program
    gl.useProgram(null);
    gl.getExtension('OES_element_index_uint'); // no-op, try enable extensions
  }, [geometry, serviceEdgesSamples, spanConnectorSamples]);

  return (
    <div className="trace-graph" ref={containerRef}>
      {/* WebGL canvas sits behind the DOM controls and renders edges/connectors */}
      <canvas ref={canvasRef} className="trace-graph__gl-canvas" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
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
  );
};

export default TraceGraph;

