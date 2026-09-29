import { useEffect, useRef, type CSSProperties } from "react";
import { Color, Mesh, Program, Renderer, RenderTarget, Triangle } from "ogl";
import "./Strands.css";

const MAX_STRANDS = 12;
const MAX_COLORS = 8;

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[${MAX_COLORS}];
uniform int uColorCount;
uniform int uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uHueShift;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;
out vec4 fragColor;
const float PI = 3.14159265;
vec3 spectrum(float t) {
  return 0.5 + 0.5 * cos(2.0 * PI * (t + vec3(0.00, 0.33, 0.67)));
}
vec3 samplePalette(float t) {
  t = fract(t);
  float scaled = t * float(uColorCount);
  int idx = int(floor(scaled));
  float blend = fract(scaled);
  int nextIdx = idx + 1;
  if (nextIdx >= uColorCount) nextIdx = 0;
  return mix(uColors[idx], uColors[nextIdx], blend);
}
vec3 strandColor(float t) {
  if (uColorCount > 0) return samplePalette(t);
  return spectrum(t);
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  uv /= max(uScale, 0.0001);
  float e = 0.06 + uIntensity * 0.94;
  float env = pow(max(cos(uv.x * PI * 1.3), 0.0), max(uTaper, 0.001));
  vec3 col = vec3(0.0);
  for (int i = 0; i < ${MAX_STRANDS}; i++) {
    if (i >= uStrandCount) break;
    float fi = float(i);
    float ph = fi * 1.7 * uSpread;
    float freq = (2.0 + fi * 0.35) * uWaviness;
    float spd = 1.4 + fi * 1.2;
    float tt = uTime * uSpeed;
    float w = sin(uv.x * freq + tt * spd + ph) * 0.60
            + sin(uv.x * freq * 1.1 - tt * spd * 0.7 + ph * 1.7) * 0.40;
    float amp = (0.1 + 0.02 * e) * env * uAmplitude;
    float y = w * amp;
    float d = abs(uv.y - y);
    float thick = (0.001 + 0.05 * e) * (0.35 + env) * uThickness;
    float g = thick / (d + thick * 0.45);
    g = g * g;
    float h = fi / float(max(uStrandCount, 1)) + uv.x * 0.30 + uTime * 0.04 + uHueShift;
    col += strandColor(h) * g * env;
  }
  col *= 0.45 + 0.7 * e;
  col = 1.0 - exp(-col * uGlow);
  float gray = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(gray), col, uSaturation), 0.0);
  float lum = max(max(col.r, col.g), col.b);
  float alpha = clamp(lum, 0.0, 1.0) * uOpacity;
  fragColor = vec4(col * uOpacity, alpha);
}
`;

const GLASS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uRadius;
uniform float uRefraction;
uniform float uDispersion;
out vec4 fragColor;
vec2 toUv(vec2 p) { return p * (uResolution.y / uResolution) + 0.5; }
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float d = length(p);
  float r = uRadius;
  float edge = fwidth(d) * 1.5;
  float mask = 1.0 - smoothstep(r - edge, r + edge, d);
  if (mask <= 0.0) { fragColor = vec4(0.0); return; }
  float z = sqrt(max(r * r - d * d, 0.0)) / r;
  float nd = d / r;
  vec2 dir = d > 0.0 ? p / d : vec2(0.0);
  float lens = smoothstep(0.85, 1.0, nd) * pow(nd, 6.0);
  vec2 offset = -dir * lens * uRefraction * 0.15;
  vec2 disp = -dir * lens * uDispersion * 0.012;
  vec3 light;
  light.r = texture(uScene, toUv(p + offset - disp)).r;
  light.g = texture(uScene, toUv(p + offset)).g;
  light.b = texture(uScene, toUv(p + offset + disp)).b;
  float fres = pow(1.0 - z, 3.0);
  vec2 lightDir = normalize(vec2(-0.55, 0.6));
  float spec = pow(max(dot(p / max(r, 1e-4), lightDir), 0.0), 6.0);
  spec *= smoothstep(r, r * 0.55, d);
  vec3 emissive = light + vec3(fres * 0.18) + vec3(spec) * 0.4;
  float emissiveA = clamp(max(max(emissive.r, emissive.g), emissive.b), 0.0, 1.0);
  float bodyA = 0.05 + fres * 0.05;
  float outA = emissiveA + bodyA * (1.0 - emissiveA);
  fragColor = vec4(emissive * mask, outA * mask);
}
`;

type StrandsProps = {
  colors?: string[];
  count?: number;
  speed?: number;
  amplitude?: number;
  waviness?: number;
  thickness?: number;
  glow?: number;
  taper?: number;
  spread?: number;
  hueShift?: number;
  intensity?: number;
  saturation?: number;
  opacity?: number;
  scale?: number;
  glass?: boolean;
  refraction?: number;
  dispersion?: number;
  glassSize?: number;
  className?: string;
  style?: CSSProperties;
};

type StrandSettings = Required<Omit<StrandsProps, "className" | "style">>;
const DEFAULT_COLORS = ["#FF4242", "#7C3AED", "#06B6D4", "#EAB308"];

const buildPalette = (colors: string[]) => {
  const filled = colors.length ? colors : ["#ffffff"];
  return Array.from({ length: MAX_COLORS }, (_, i) => {
    const c = new Color(filled[i] ?? filled[filled.length - 1]);
    return [c.r, c.g, c.b];
  });
};

export default function Strands({
  colors = DEFAULT_COLORS,
  count = 3,
  speed = 0.5,
  amplitude = 1,
  waviness = 1,
  thickness = 0.7,
  glow = 2.6,
  taper = 3,
  spread = 1,
  hueShift = 0,
  intensity = 0.6,
  saturation = 1.5,
  opacity = 1,
  scale = 1.5,
  glass = false,
  refraction = 1,
  dispersion = 1,
  glassSize = 1,
  className = "",
  style,
}: StrandsProps) {
  const propsRef = useRef<StrandSettings>({
    colors, count, speed, amplitude, waviness, thickness, glow, taper, spread, hueShift,
    intensity, saturation, opacity, scale, glass, refraction, dispersion, glassSize,
  });
  propsRef.current = {
    colors, count, speed, amplitude, waviness, thickness, glow, taper, spread, hueShift,
    intensity, saturation, opacity, scale, glass, refraction, dispersion, glassSize,
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: Renderer | null = null;
    let frameId = 0;
    let visible = true;
    let pageVisible = document.visibilityState === "visible";
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    try {
      renderer = new Renderer({ alpha: true, premultipliedAlpha: true, antialias: true, dpr: Math.min(2, window.devicePixelRatio || 1) });
    } catch {
      return undefined;
    }
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.backgroundColor = "transparent";

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) delete geometry.attributes.uv;
    const first = propsRef.current;
    const initialWidth = Math.max(1, container.clientWidth);
    const initialHeight = Math.max(1, container.clientHeight);
    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: [initialWidth, initialHeight] },
      uColors: { value: buildPalette(first.colors) },
      uColorCount: { value: Math.min(first.colors.length, MAX_COLORS) },
      uStrandCount: { value: Math.min(Math.max(Math.round(first.count), 1), MAX_STRANDS) },
      uSpeed: { value: first.speed },
      uAmplitude: { value: first.amplitude },
      uWaviness: { value: first.waviness },
      uThickness: { value: first.thickness },
      uGlow: { value: first.glow },
      uTaper: { value: first.taper },
      uSpread: { value: first.spread },
      uHueShift: { value: first.hueShift },
      uIntensity: { value: first.intensity },
      uOpacity: { value: first.opacity },
      uScale: { value: first.scale },
      uSaturation: { value: first.saturation },
    };
    const program = new Program(gl, { vertex: VERT, fragment: FRAG, uniforms });
    const mesh = new Mesh(gl, { geometry, program });
    const renderTarget = new RenderTarget(gl, { width: initialWidth, height: initialHeight });
    const glassProgram = new Program(gl, {
      vertex: VERT,
      fragment: GLASS_FRAG,
      uniforms: {
        uScene: { value: renderTarget.texture },
        uResolution: { value: [initialWidth, initialHeight] },
        uRadius: { value: 0.46 * first.glassSize },
        uRefraction: { value: first.refraction },
        uDispersion: { value: first.dispersion },
      },
    });
    const glassMesh = new Mesh(gl, { geometry, program: glassProgram });
    container.appendChild(gl.canvas);

    let paletteKey = first.colors.join("|");
    const resize = () => {
      if (!container.clientWidth || !container.clientHeight) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer?.setSize(width, height);
      program.uniforms.uResolution.value = [width, height];
      renderTarget.setSize(width, height);
      glassProgram.uniforms.uResolution.value = [width, height];
      if (reducedMotion.matches) {
        stop();
        start();
      }
    };
    const onVisibility = () => {
      pageVisible = document.visibilityState === "visible";
      if (pageVisible && visible) start();
      else stop();
    };
    const onMotionPreferenceChange = () => {
      stop();
      if (visible && pageVisible) start();
    };
    const observer = new ResizeObserver(resize);
    const viewObserver = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible && pageVisible) start();
      else stop();
    });
    const update = (time: number) => {
      frameId = 0;
      const current = propsRef.current;
      program.uniforms.uTime.value = reducedMotion.matches ? 0 : time * 0.001;
      const nextPaletteKey = current.colors.join("|");
      if (nextPaletteKey !== paletteKey) {
        paletteKey = nextPaletteKey;
        program.uniforms.uColors.value = buildPalette(current.colors);
        program.uniforms.uColorCount.value = Math.min(current.colors.length, MAX_COLORS);
      }
      program.uniforms.uStrandCount.value = Math.min(Math.max(Math.round(current.count), 1), MAX_STRANDS);
      program.uniforms.uSpeed.value = current.speed;
      program.uniforms.uAmplitude.value = current.amplitude;
      program.uniforms.uWaviness.value = current.waviness;
      program.uniforms.uThickness.value = current.thickness;
      program.uniforms.uGlow.value = current.glow;
      program.uniforms.uTaper.value = current.taper;
      program.uniforms.uSpread.value = current.spread;
      program.uniforms.uHueShift.value = current.hueShift;
      program.uniforms.uIntensity.value = current.intensity;
      program.uniforms.uOpacity.value = current.opacity;
      program.uniforms.uScale.value = current.scale;
      program.uniforms.uSaturation.value = current.saturation;
      if (current.glass) {
        renderer?.render({ scene: mesh, target: renderTarget });
        glassProgram.uniforms.uScene.value = renderTarget.texture;
        glassProgram.uniforms.uRefraction.value = current.refraction;
        glassProgram.uniforms.uDispersion.value = current.dispersion;
        glassProgram.uniforms.uRadius.value = 0.46 * current.glassSize;
        renderer?.render({ scene: glassMesh });
      } else {
        renderer?.render({ scene: mesh });
      }
      if (!reducedMotion.matches && visible && pageVisible) frameId = requestAnimationFrame(update);
    };
    function stop() {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    }
    function start() {
      if (!frameId && visible && pageVisible) frameId = requestAnimationFrame(update);
    }
    refreshRef.current = () => {
      if (reducedMotion.matches) {
        stop();
        start();
      }
    };

    observer.observe(container);
    viewObserver.observe(container);
    document.addEventListener("visibilitychange", onVisibility);
    reducedMotion.addEventListener("change", onMotionPreferenceChange);
    resize();
    start();
    return () => {
      stop();
      observer.disconnect();
      viewObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reducedMotion.removeEventListener("change", onMotionPreferenceChange);
      refreshRef.current = () => {};
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  useEffect(() => {
    refreshRef.current();
  }, [colors, count, speed, amplitude, waviness, thickness, glow, taper, spread, hueShift, intensity, saturation, opacity, scale, glass, refraction, dispersion, glassSize]);

  return <div ref={containerRef} aria-hidden="true" className={`strands-container${className ? ` ${className}` : ""}`} style={style} />;
}
