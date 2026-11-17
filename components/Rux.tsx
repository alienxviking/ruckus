// Rux: the Ruckus mascot. A lime blob gremlin with springy pink hair, one snaggletooth and
// (usually) a megaphone. Pure SVG, no hooks, so it renders on the server and costs nothing.

export type RuxMood = "grin" | "shout" | "wink" | "wow" | "sleepy";

const INK = "#14101f";
const LIME = "#c6f432";
const LIME_DARK = "#93b81a";
const PINK = "#ff4fa3";
const PAPER = "#fff8e7";

// The body: a slightly lumpy blob, so he never looks like a plain circle.
const BODY = "M60 16 C83 13 103 30 104 57 C106 84 88 104 60 104 C34 105 15 88 15 61 C14 35 33 18 60 16 Z";

function Eyes({ mood }: { mood: RuxMood }) {
  if (mood === "shout") {
    // Squeezed shut, yelling.
    return (
      <g fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M33 44 L43 49 L33 54" />
        <path d="M84 44 L74 49 L84 54" />
      </g>
    );
  }
  if (mood === "sleepy") {
    return (
      <g fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round">
        <path d="M30 50 Q38 55 46 50" />
        <path d="M72 50 Q79 54 86 50" />
      </g>
    );
  }
  const big = mood === "wow" ? 11 : 12.5;
  return (
    <g>
      {/* Left eye: bigger, a little wild. */}
      <circle cx="38" cy="48" r={big} fill="#fff" stroke={INK} strokeWidth="3.5" />
      <circle cx={mood === "wow" ? 38 : 41} cy={mood === "wow" ? 48 : 49} r={mood === "wow" ? 3.6 : 5} fill={INK} />
      <circle cx={mood === "wow" ? 36.8 : 39.4} cy={mood === "wow" ? 46.6 : 47} r="1.6" fill="#fff" />
      {mood === "wink" ? (
        <path d="M71 50 Q79 43 87 50" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
      ) : (
        <>
          <circle cx="79" cy="50" r={mood === "wow" ? 9 : 9.5} fill="#fff" stroke={INK} strokeWidth="3.5" />
          <circle cx={mood === "wow" ? 79 : 81} cy={mood === "wow" ? 50 : 51} r={mood === "wow" ? 3 : 4} fill={INK} />
          <circle cx={mood === "wow" ? 78 : 80} cy={mood === "wow" ? 48.8 : 49.6} r="1.3" fill="#fff" />
        </>
      )}
      {/* Brows: one up, one cheeky. */}
      <path d="M27 33 Q37 27 47 32" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      <path d="M71 37 Q79 33 88 37" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    </g>
  );
}

function Mouth({ mood }: { mood: RuxMood }) {
  if (mood === "wow") {
    return <ellipse cx="60" cy="78" rx="8" ry="10" fill="#2a1240" stroke={INK} strokeWidth="3.5" />;
  }
  if (mood === "sleepy") {
    return <path d="M52 78 Q60 83 68 78" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />;
  }
  if (mood === "shout") {
    return (
      <g>
        <path d="M36 66 Q60 60 84 66 Q80 96 60 97 Q40 96 36 66 Z" fill="#2a1240" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M46 88 Q60 80 74 88 Q68 95 60 95 Q52 95 46 88 Z" fill={PINK} />
        <rect x="52" y="63" width="9" height="9" rx="2" fill="#fff" stroke={INK} strokeWidth="2.5" />
      </g>
    );
  }
  // Grin / wink: a big lopsided grin with the snaggletooth.
  return (
    <g>
      <path d="M34 68 Q60 74 88 64 Q82 92 58 92 Q38 91 34 68 Z" fill="#2a1240" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M46 85 Q58 78 72 84 Q66 91 58 91 Q50 91 46 85 Z" fill={PINK} />
      <path d="M62 71.5 L71 69.5 L68 79 Z" fill="#fff" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
    </g>
  );
}

export function Rux({
  mood = "grin",
  megaphone = false,
  className = "",
  title,
}: {
  mood?: RuxMood;
  megaphone?: boolean;
  className?: string;
  /** Accessible name; decorative (hidden) when omitted. */
  title?: string;
}) {
  return (
    <svg
      viewBox={megaphone ? "0 -14 150 142" : "0 -14 120 142"}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable={false}
    >
      {/* Sticker edge: the whole figure again, fat and off-white, behind everything. */}
      <g stroke={PAPER} strokeWidth="10" strokeLinejoin="round" strokeLinecap="round" fill={PAPER}>
        <path d={BODY} />
        <path d="M41 22 L28 2 L46 11 L47 -8 L59 10 L71 -7 L72 12 L92 1 L79 24" />
        <ellipse cx="44" cy="110" rx="11" ry="6" />
        <ellipse cx="76" cy="110" rx="11" ry="6" />
        {megaphone && <path d="M100 68 L138 48 L144 98 L102 84 Z" />}
      </g>
      {/* Springy hair. */}
      <path
        d="M41 22 L28 2 L46 11 L47 -8 L59 10 L71 -7 L72 12 L92 1 L79 24 Z"
        fill={PINK}
        stroke={INK}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      {/* Feet. */}
      <ellipse cx="44" cy="109" rx="10" ry="5.5" fill={LIME_DARK} stroke={INK} strokeWidth="3.5" />
      <ellipse cx="76" cy="109" rx="10" ry="5.5" fill={LIME_DARK} stroke={INK} strokeWidth="3.5" />
      {/* Body with a shaded belly side. */}
      <path d={BODY} fill={LIME} stroke={INK} strokeWidth="4" />
      <path d="M96 40 C104 62 98 90 72 101 C92 98 104 82 104 60 C104 52 101 46 96 40 Z" fill={LIME_DARK} opacity=".55" />
      <ellipse cx="38" cy="26" rx="9" ry="4" fill="#fff" opacity=".35" transform="rotate(-20 38 26)" />
      {/* Cheeks. */}
      <ellipse cx="26" cy="66" rx="6" ry="4" fill={PINK} opacity=".55" />
      <ellipse cx="92" cy="64" rx="5.5" ry="3.6" fill={PINK} opacity=".55" />
      <Eyes mood={mood} />
      <Mouth mood={mood} />
      {megaphone && (
        <g strokeLinejoin="round">
          {/* Arm holding the megaphone up to the mouth. */}
          <path d="M92 80 Q100 82 104 76" fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" />
          <path d="M101 66 L136 50 L141 95 L103 82 Z" fill="#ffd23f" stroke={INK} strokeWidth="3.5" />
          <path d="M101 66 L103 82" stroke={INK} strokeWidth="6" strokeLinecap="round" />
          <ellipse cx="138.5" cy="72.5" rx="4.5" ry="22.5" fill="#ffb800" stroke={INK} strokeWidth="3" />
          <path d="M112 64 L113 80" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity=".6" />
        </g>
      )}
    </svg>
  );
}
