interface GpuGaugeProps {
  value: number; // 0-100
  label: string;
  warnAt?: number;
  critAt?: number;
  size?: number;
}

export function GpuGauge({ value, label, warnAt = 70, critAt = 90, size = 80 }: GpuGaugeProps) {
  const r = (size / 2) - 8;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, value)) / 100) * circ;
  const gap = circ - filled;

  const color = value >= critAt ? "#ff3b47" : value >= warnAt ? "#f5a623" : "#00e5c8";

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <svg width={size} height={size} style={{ overflow: "visible" }}>
        {/* Background track */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="#1a1e26"
          strokeWidth={6}
        />
        {/* Foreground arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeDasharray={`${filled} ${gap}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dasharray 0.4s ease, stroke 0.3s ease" }}
        />
        {/* Center value */}
        <text
          x={cx} y={cy + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={color}
          fontSize={size * 0.22}
          fontFamily="monospace"
          fontWeight="bold"
        >
          {Math.round(value)}
        </text>
        <text
          x={cx} y={cy + size * 0.2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#5a6070"
          fontSize={size * 0.13}
          fontFamily="monospace"
        >
          %
        </text>
      </svg>
      <span style={{ fontSize: 10, color: "#5a6070", letterSpacing: 1 }}>{label}</span>
    </div>
  );
}
