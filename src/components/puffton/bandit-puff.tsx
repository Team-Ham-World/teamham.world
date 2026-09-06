"use client";

import React from "react";

interface BanditPuffProps {
  x?: number;
  y?: number;
  size?: number;
  isGhost?: boolean;
  className?: string;
}

/**
 * Bandit Puff — Team HAM's legendary toner heist hamster mascot.
 * Features:
 * - Cute hamster silhouette with round ears and pink inner ear tufts
 * - Sleek black bandit domino eye-mask with sharp, determined glints
 * - Toner canister stealth backpack with magenta ink drip
 * - Red heist bandana / collar and bold "PUFF" belt badge
 * - Subtle floating bob animation
 */
export function BanditPuff({
  x = 0,
  y = 0,
  size = 46,
  isGhost = false,
  className = "",
}: BanditPuffProps) {
  const half = size / 2;

  return (
    <g
      transform={`translate(${x - half}, ${y - half})`}
      className={`select-none ${className} ${isGhost ? "opacity-75 pointer-events-none" : ""}`}
      style={{
        transformOrigin: "center",
      }}
    >
      <style>{`
        @keyframes puffBanditBob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
        @keyframes puffReticleSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .animate-bandit-bob {
          animation: puffBanditBob 2.4s ease-in-out infinite;
        }
        .animate-reticle-spin {
          transform-origin: center;
          animation: puffReticleSpin 12s linear infinite;
        }
      `}</style>

      {/* Target Reticle (Only in Ghost/Placement mode) */}
      {isGhost && (
        <g transform={`translate(${half}, ${half})`}>
          <circle
            r={half + 6}
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
            strokeDasharray="4 3"
            className="animate-reticle-spin"
            opacity="0.85"
          />
          <line x1={-half - 10} y1="0" x2={-half - 2} y2="0" stroke="#ef4444" strokeWidth="2.5" />
          <line x1={half + 2} y1="0" x2={half + 10} y2="0" stroke="#ef4444" strokeWidth="2.5" />
          <line x1="0" y1={-half - 10} x2="0" y2={-half - 2} stroke="#ef4444" strokeWidth="2.5" />
          <line x1="0" y1={half + 2} x2="0" y2={half + 10} stroke="#ef4444" strokeWidth="2.5" />
        </g>
      )}

      {/* Main Bandit Puff SVG container */}
      <g className={!isGhost ? "animate-bandit-bob" : ""}>
        {/* Drop Shadow on Ground */}
        <ellipse
          cx={half}
          cy={size - 2}
          rx={half * 0.75}
          ry={4}
          fill="#121212"
          opacity={isGhost ? "0.2" : "0.4"}
        />

        {/* 1. Stealth Toner Backpack (Behind Body) */}
        <g transform={`translate(${half + 8}, ${half - 8})`}>
          {/* Canister Body */}
          <rect
            x="-4"
            y="-10"
            width="8"
            height="18"
            rx="3"
            fill="#27272a"
            stroke="#121212"
            strokeWidth="1.5"
          />
          {/* Canister Cap */}
          <rect x="-3" y="-12" width="6" height="3" rx="1" fill="#71717a" stroke="#121212" strokeWidth="1" />
          {/* Magenta Toner Glow Line */}
          <line x1="-3" y1="-1" x2="3" y2="-1" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" />
        </g>

        {/* 2. Ears */}
        {/* Left Ear */}
        <g transform={`translate(${half - 13}, ${half - 15})`}>
          <polygon
            points="0,10 6,-8 12,10"
            fill="#d97706"
            stroke="#121212"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <polygon points="2,8 6,-3 10,8" fill="#fda4af" />
        </g>
        {/* Right Ear */}
        <g transform={`translate(${half + 1}, ${half - 15})`}>
          <polygon
            points="0,10 6,-8 12,10"
            fill="#d97706"
            stroke="#121212"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <polygon points="2,8 6,-3 10,8" fill="#fda4af" />
        </g>

        {/* 3. Main Hamster Body */}
        <circle
          cx={half}
          cy={half + 1}
          r={half * 0.72}
          fill="#f59e0b"
          stroke="#121212"
          strokeWidth="2.2"
        />

        {/* Fluffy White Belly */}
        <ellipse
          cx={half}
          cy={half + 6}
          rx={half * 0.44}
          ry={half * 0.38}
          fill="#fffdfa"
        />

        {/* 4. Bandit Domino Mask */}
        <path
          d={`M ${half - 15} ${half - 3}
              Q ${half} ${half - 8} ${half + 15} ${half - 3}
              Q ${half + 14} ${half + 5} ${half + 8} ${half + 4}
              Q ${half} ${half + 1} ${half - 8} ${half + 4}
              Q ${half - 14} ${half + 5} ${half - 15} ${half - 3} Z`}
          fill="#18181b"
          stroke="#09090b"
          strokeWidth="1.5"
        />

        {/* Determined Eyes inside Mask */}
        {/* Left Eye */}
        <ellipse cx={half - 7} cy={half - 1.5} rx="3" ry="3.5" fill="#ffffff" />
        <ellipse cx={half - 6.5} cy={half - 1.5} rx="1.8" ry="2.2" fill="#09090b" />
        <circle cx={half - 7.5} cy={half - 2.5} r="1" fill="#ffffff" />

        {/* Right Eye */}
        <ellipse cx={half + 7} cy={half - 1.5} rx="3" ry="3.5" fill="#ffffff" />
        <ellipse cx={half + 6.5} cy={half - 1.5} rx="1.8" ry="2.2" fill="#09090b" />
        <circle cx={half + 5.5} cy={half - 2.5} r="1" fill="#ffffff" />

        {/* Cute Hamster Pink Nose & Whiskers */}
        <ellipse cx={half} cy={half + 4} rx="2" ry="1.5" fill="#f43f5e" />
        {/* Left Whiskers */}
        <line x1={half - 5} y1={half + 4} x2={half - 13} y2={half + 2} stroke="#121212" strokeWidth="1" strokeLinecap="round" />
        <line x1={half - 5} y1={half + 6} x2={half - 12} y2={half + 8} stroke="#121212" strokeWidth="1" strokeLinecap="round" />
        {/* Right Whiskers */}
        <line x1={half + 5} y1={half + 4} x2={half + 13} y2={half + 2} stroke="#121212" strokeWidth="1" strokeLinecap="round" />
        <line x1={half + 5} y1={half + 6} x2={half + 12} y2={half + 8} stroke="#121212" strokeWidth="1" strokeLinecap="round" />

        {/* 5. Heist Bandana / Collar */}
        <path
          d={`M ${half - 10} ${half + 9}
              L ${half} ${half + 14}
              L ${half + 10} ${half + 9}
              L ${half} ${half + 11} Z`}
          fill="#dc2626"
          stroke="#121212"
          strokeWidth="1.2"
        />

        {/* 6. Bandit Belt Badge */}
        <g transform={`translate(${half}, ${size - 5})`}>
          <rect
            x="-16"
            y="-4"
            width="32"
            height="9"
            rx="3"
            fill="#121212"
            stroke="#facc15"
            strokeWidth="1.2"
          />
          <text
            x="0"
            y="2"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="monospace"
            fontSize="6"
            fontWeight="900"
            fill="#facc15"
            letterSpacing="0.5"
          >
            BANDIT
          </text>
        </g>
      </g>
    </g>
  );
}
