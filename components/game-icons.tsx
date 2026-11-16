// One glyph per game: lucide icons plus a few custom SVGs drawn on the same 24px grid
// with the same stroke, so the whole set reads as one family. Keyed by catalog id.
import {
  ALargeSmall,
  AudioLines,
  Biohazard,
  Bomb,
  Bot,
  BrainCircuit,
  Castle,
  ChartCandlestick,
  Clapperboard,
  Crosshair,
  Dices,
  FlagTriangleRight,
  Flame,
  Gamepad2,
  Gauge,
  Gavel,
  Ghost,
  Handshake,
  MessageCircleQuestion,
  PaintRoller,
  PenTool,
  Pickaxe,
  ScanFace,
  Scissors,
  Snowflake,
  Sparkles,
  Vote,
  Zap,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type GlyphProps = SVGProps<SVGSVGElement> & { strokeWidth?: number };
type Glyph = ComponentType<GlyphProps>;

function Svg({ children, strokeWidth = 1.75, ...props }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Classic grid snake chasing a pellet. */
const SnakeGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M3.5 20.5H10v-7.5h6.5V8" />
    <rect x="14.25" y="2.75" width="4.5" height="5.25" rx="1.4" fill="currentColor" fillOpacity={0.3} />
    <circle cx="20" cy="16.5" r="1.7" fill="currentColor" stroke="none" />
  </Svg>
);

/** Dots and boxes: a claimed box and a half-drawn one. */
const DotsGlyph: Glyph = (p) => (
  <Svg {...p}>
    <rect x="5" y="5" width="7" height="7" fill="currentColor" fillOpacity={0.22} stroke="none" />
    <path d="M5 5h7v7H5zM12 12h7M12 12v7" />
    {[5, 12, 19].flatMap((y) =>
      [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill="currentColor" stroke="none" />),
    )}
  </Svg>
);

/** A frame of discs with a winning diagonal. */
const FourRowGlyph: Glyph = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3.5" />
    {[7.5, 12, 16.5].flatMap((y) =>
      [7.5, 12, 16.5].map((x) => {
        const win = x + y === 24;
        return (
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r="1.9"
            fill={win ? "currentColor" : "none"}
            stroke={win ? "none" : "currentColor"}
            strokeOpacity={0.5}
            strokeWidth={1.25}
          />
        );
      }),
    )}
  </Svg>
);

/** X, O and the winning strike. */
const TicTacToeGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M3.5 5.5l6 6m0-6l-6 6" />
    <circle cx="17" cy="8.5" r="3.3" />
    <path d="M3 18.5h18" strokeOpacity={0.55} />
  </Svg>
);

/** Two wrestlers inside the ring. */
const SumoGlyph: Glyph = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.5" strokeDasharray="2.6 2.4" strokeOpacity={0.7} />
    <circle cx="9" cy="13" r="3.2" fill="currentColor" fillOpacity={0.25} />
    <circle cx="15.2" cy="10.6" r="2.6" />
  </Svg>
);

const INVADER = ["..X.....X..", "...X...X...", "..XXXXXXX..", ".XX.XXX.XX.", "XXXXXXXXXXX", "X.XXXXXXX.X", "X.X.....X.X", "...XX.XX..."];
/** A pixel invader, drawn from a bitmap. */
const PixelsGlyph: Glyph = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable={false}>
    {INVADER.flatMap((row, y) =>
      [...row].map((c, x) =>
        c === "X" ? <rect key={`${x}-${y}`} x={1 + x * 2} y={4 + y * 2} width="2" height="2" fillOpacity={y === 3 ? 1 : 0.85} /> : null,
      ),
    )}
  </svg>
);

/** A volcano mid-eruption. */
const LavaGlyph: Glyph = (p) => (
  <Svg {...p}>
    <path d="M2.5 20.5 8 12h2.2l1.8 2 1.8-2H16l5.5 8.5z" fill="currentColor" fillOpacity={0.22} />
    <path d="M12 9V3.5M8.6 7.6 7 5.2M15.4 7.6 17 5.2" />
  </Svg>
);

const GLYPHS: Record<string, Glyph> = {
  sketch: PenTool,
  trivia: Zap,
  letters: ALargeSmall,
  snakes: SnakeGlyph,
  turf: PaintRoller,
  reflex: Crosshair,
  impostor: ScanFace,
  fib: MessageCircleQuestion,
  mindmeld: BrainCircuit,
  dial: Gauge,
  dots: DotsGlyph,
  fourrow: FourRowGlyph,
  tictactoe: TicTacToeGlyph,
  garble: AudioLines,
  liars: Dices,
  market: ChartCandlestick,
  barrage: Bomb,
  blitz: Gamepad2,
  sumo: SumoGlyph,
  warlords: Castle,
  incognito: Bot,
  minerush: Pickaxe,
  auction: Gavel,
  potato: Flame,
  putt: FlagTriangleRight,
  pixels: PixelsGlyph,
  doublecross: Handshake,
  outbreak: Biohazard,
  lava: LavaGlyph,
  snowball: Snowflake,
  defuse: Scissors,
  poll: Vote,
  emojicharades: Clapperboard,
  mashup: Ghost,
};

export function GameGlyph({ id, className }: { id: string; className?: string }) {
  const G = GLYPHS[id] ?? Sparkles;
  return <G className={className} strokeWidth={1.75} aria-hidden focusable={false} />;
}
