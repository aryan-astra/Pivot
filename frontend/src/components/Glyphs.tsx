/*
 * Vector marks adapted from the supplied Framer components ("Home", "Shape 1"
 * ×2, "Vector"). Re-expressed as plain SVG so PIVOT does not need the `framer`
 * runtime; geometry is unchanged and currentColor follows the theme. Each mark
 * sits beside its matching workspace label or stream event; all are decorative
 * to assistive technology and non-interactive.
 */

type GlyphProps = { className?: string };

const HOUSE =
  "M 0 38.203 C 0 31.389 3.232 24.939 8.8 20.624 L 28.8 5.135 C 37.642 -1.712 50.358 -1.712 59.2 5.135 L 79.2 20.624 C 84.768 24.939 88 31.389 88 38.203 L 88 65.289 C 88 77.832 77.255 88 64 88 L 24 88 C 10.745 88 0 77.832 0 65.289 Z";

export function HomeGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
      <g transform="translate(6 6)">
        <path d={HOUSE} fill="currentColor" opacity="0.2" />
        <path d={HOUSE} stroke="currentColor" strokeWidth="11.01" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 44 56.777 L 44 80.667" stroke="currentColor" strokeWidth="14.67" strokeLinecap="round" />
      </g>
    </svg>
  );
}

const SPARKLE =
  "M 34.756 1.244 C 31.976 -1.536 25.189 0.502 18 5.778 C 10.811 0.502 4.024 -1.536 1.244 1.244 C -1.536 4.024 0.502 10.811 5.778 18 C 0.502 25.189 -1.536 31.976 1.244 34.756 C 4.024 37.536 10.811 35.498 18 30.222 C 25.189 35.498 31.976 37.536 34.756 34.756 C 37.536 31.976 35.498 25.189 30.222 18 C 35.498 10.811 37.536 4.024 34.756 1.244 Z";

export function SparkleGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <path d={SPARKLE} transform="translate(2 2)" fill="currentColor" />
    </svg>
  );
}

const CROSS =
  "M 136 108.686 L 212.853 31.833 L 224.166 43.148 L 147.313 120 L 256 120 L 256 136 L 147.314 136 L 224.167 212.853 L 212.853 224.167 L 136 147.313 L 136 256 L 120 256 L 120 147.313 L 43.148 224.167 L 31.833 212.853 L 108.686 136 L 0 136 L 0 120 L 108.687 120 L 31.834 43.148 L 43.148 31.833 L 120 108.686 L 120 0 L 136 0 Z";

export function CrossGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 256 256" aria-hidden="true" className={className}>
      <path d={CROSS} fill="currentColor" />
    </svg>
  );
}

const SWIRL =
  "M 62.232 127.779 C 47.707 120.732 32.577 112.666 21.115 102.152 C 12.982 94.692 7.805 84.792 3.657 75.144 C 0.818 68.541 -0.151 61.403 0.019 54.35 C 0.354 40.413 5.475 26.091 16.838 16.314 C 28.2 6.539 46.435 2.359 60.789 8.423 C 70.092 12.352 76.72 19.839 82.345 27.42 C 95.241 44.805 104.733 64.117 110.285 84.263 C 109.793 70.196 111.339 56.131 114.875 42.506 C 117.457 32.53 121.219 22.554 128.291 14.405 C 135.363 6.257 146.214 0.123 157.91 0.002 C 172.319 -0.146 185.338 8.938 191.763 20.218 C 198.189 31.497 199.048 44.585 198.147 57.161 C 197.228 69.999 194.436 83.124 186.443 93.921 C 178.45 104.717 164.374 112.766 149.711 111.779 C 163.971 113.627 178.798 115.664 190.642 122.852 C 210.18 134.708 216.636 157.632 215.951 178.421 C 215.635 188.039 213.855 198.18 206.879 205.622 C 197.147 216.007 179.146 218.324 164.692 213.796 C 150.237 209.267 138.933 199.147 130.169 188.121 C 121.931 177.757 115.345 165.951 114.411 153.355 C 107.861 174.245 89.617 193.149 65.509 198.116 C 41.399 203.082 12.88 190.819 6.781 169.825 C 3.017 156.863 8.29 142.22 19.87 133.483 C 31.447 124.746 48.783 122.331 62.233 127.781 Z";

export function SwirlGlyph({ className, strokeWidth = 10 }: GlyphProps & { strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 256 256" fill="none" aria-hidden="true" className={className}>
      <path
        d={SWIRL}
        transform="translate(20 20)"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
