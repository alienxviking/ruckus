"use client";

import type { ReactNode } from "react";
import {
  BUTTON_RULES,
  CODEBOOK,
  GLYPHS,
  MODULE_ICON,
  MODULE_NAME,
  PAD_COLORS,
  STRIP_COLORS,
  WIRE_COUNTS,
  WIRE_RULES,
  ordinal,
  type Cond,
  type Fact,
  type ModType,
  type WireAct,
} from "./shared";
import { Glyph, Swatch } from "./ui";

// The expert's torn manual: a scrappy printed page. Lines held by other experts
// show up as torn strips so everyone knows what to ask for.

const INK = "#2b2620";
const PAPER = "#f3ecd9";

function C({ c }: { c: string }) {
  return (
    <b className="whitespace-nowrap">
      <Swatch c={c} className="mr-0.5 size-2.5" />
      {c.toUpperCase()}
    </b>
  );
}

export function condText(c: Cond): ReactNode {
  switch (c.k) {
    case "none":
      return <>there are no <C c={c.c} /> wires</>;
    case "one":
      return <>there is exactly one <C c={c.c} /> wire</>;
    case "many":
      return <>there is more than one <C c={c.c} /> wire</>;
    case "first":
      return <>the first wire is <C c={c.c} /></>;
    case "last":
      return <>the last wire is <C c={c.c} /></>;
    case "odd":
      return <>the serial number ends in an <b>odd</b> digit</>;
    case "even":
      return <>the serial number ends in an <b>even</b> digit</>;
    case "vowel":
      return <>the serial number has a <b>vowel</b></>;
    case "batt":
      return <>the bomb has <b>{c.n} or more</b> batteries</>;
    case "lamp":
      return <>the <b className="font-mono">{c.l}</b> lamp is lit</>;
    case "bcolor":
      return <>the button is <C c={c.c} /></>;
    case "blabel":
      return <>the button says <b className="font-mono">{c.l}</b></>;
    case "bboth":
      return <>the button is <C c={c.c} /> and says <b className="font-mono">{c.l}</b></>;
  }
}

function actText(a: WireAct): ReactNode {
  if (a.k === "nth") return <>cut the <b>{ordinal(a.n)}</b> wire</>;
  if (a.k === "last") return <>cut the <b>last</b> wire</>;
  if (a.k === "firstOf") return <>cut the <b>first</b> <C c={a.c} /> wire</>;
  return <>cut the <b>last</b> <C c={a.c} /> wire</>;
}

function Torn({ label }: { label: ReactNode }) {
  return (
    <li className="relative my-0.5 flex items-center gap-1.5 text-[11px] italic opacity-70">
      <span className="shrink-0 font-mono not-italic">{label}</span>
      <span
        className="h-3.5 flex-1 rounded-sm"
        style={{
          background: "repeating-linear-gradient(-45deg, #c9bfa6 0 5px, #e2d9c2 5px 10px)",
          clipPath: "polygon(0 15%, 6% 0, 14% 22%, 25% 4%, 37% 20%, 49% 0, 61% 18%, 73% 3%, 85% 21%, 100% 6%, 100% 88%, 90% 100%, 78% 82%, 66% 100%, 52% 84%, 39% 100%, 26% 80%, 13% 98%, 0 85%)",
        }}
      />
      <span className="sr-only">missing: another expert has this line</span>
    </li>
  );
}

function Section({ t, children, how }: { t: ModType; children: ReactNode; how: ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-dashed border-[#2b262055] pt-2.5" aria-label={`Manual: ${MODULE_NAME[t]}`}>
      <h3 className="font-mono text-sm font-black tracking-wider uppercase">
        <span aria-hidden>{MODULE_ICON[t]} </span>
        {MODULE_NAME[t]}
      </h3>
      <p className="mt-0.5 mb-1.5 text-[11px] leading-snug opacity-75">{how}</p>
      {children}
    </section>
  );
}

const Rule = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <li className="my-0.5 flex gap-1.5 text-[12.5px] leading-snug">
    <span className="shrink-0 font-mono text-[11px] font-bold opacity-70">{label}</span>
    <span>{children}</span>
  </li>
);

export function Manual({ page, types, experts, title }: { page: Fact[]; types: ModType[]; experts: number; title: ReactNode }) {
  const has = (t: ModType) => types.includes(t);
  const wire = (n: number, i: number) => page.find((f): f is Extract<Fact, { t: "wire" }> => f.t === "wire" && f.n === n && f.i === i);
  const btn = (i: number) => page.find((f): f is Extract<Fact, { t: "btn" }> => f.t === "btn" && f.i === i);
  const strips = page.filter((f): f is Extract<Fact, { t: "strip" }> => f.t === "strip");
  const glyphs = page.filter((f): f is Extract<Fact, { t: "glyph" }> => f.t === "glyph").sort((a, b) => a.g - b.g);
  const korder = page.find((f): f is Extract<Fact, { t: "korder" }> => f.t === "korder");
  const sig = (p: 0 | 1, c: string) => page.find((f): f is Extract<Fact, { t: "sig" }> => f.t === "sig" && f.p === p && f.from === c);
  const codes = page.filter((f): f is Extract<Fact, { t: "code" }> => f.t === "code").sort((a, b) => a.code.localeCompare(b.code));
  const dfix = page.find((f): f is Extract<Fact, { t: "dfix" }> => f.t === "dfix");

  return (
    <article
      className="df-paper-in relative mx-auto w-full rounded-[3px] px-3.5 pt-5 pb-4 sm:px-5"
      style={{
        background: `radial-gradient(circle at 85% 12%, rgb(150 110 60 / .16) 0 26px, rgb(150 110 60 / .08) 27px 30px, transparent 31px), linear-gradient(176deg, ${PAPER}, #ebe2cb)`,
        color: INK,
        boxShadow: "0 1px 0 #fff8 inset, 0 16px 30px -12px rgb(0 0 0 / .7), 3px 4px 0 -1px #d8ceb4",
        transform: "rotate(-0.4deg)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
      aria-label="Your pages of the bomb manual"
    >
      {/* tape */}
      <span aria-hidden className="absolute -top-2 left-6 h-5 w-16 rotate-[-6deg] bg-amber-100/70 shadow-sm" />
      <span aria-hidden className="absolute -top-2 right-8 h-5 w-12 rotate-[5deg] bg-amber-100/70 shadow-sm" />
      <header className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-black tracking-tight uppercase sm:text-lg">{title}</h2>
        <span className="shrink-0 text-[10px] opacity-60">{experts > 1 ? `1 of ${experts} torn copies` : "full copy"}</span>
      </header>
      <p className="mb-2 text-[11px] leading-snug opacity-75">
        Ask the defuser for the <b>serial number</b>, the <b>batteries</b> and which <b>lamps</b> are lit. Vowels are A, E and U.
        {experts > 1 && <> Striped lines are on someone else&apos;s page: ask for them!</>}
      </p>

      <div className="flex flex-col gap-3">
        {has("wires") && (
          <Section t="wires" how={<>Count the wires (numbered from the top). Use that count&apos;s rules in order: the first one that fits says which wire to cut.</>}>
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {WIRE_COUNTS.map((n) => (
                <div key={n}>
                  <div className="text-[11px] font-black uppercase underline decoration-dotted underline-offset-2">{n} wires</div>
                  <ol>
                    {Array.from({ length: WIRE_RULES }, (_, i) => {
                      const f = wire(n, i);
                      const label = `${i + 1}.`;
                      if (!f) return <Torn key={i} label={label} />;
                      return (
                        <Rule key={i} label={label}>
                          {f.if ? (
                            <>
                              If {condText(f.if)}, {actText(f.cut)}.
                            </>
                          ) : (
                            <>Otherwise, {actText(f.cut)}.</>
                          )}
                        </Rule>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          </Section>
        )}

        {has("button") && (
          <Section t="button" how={<>Rules in order; the first that fits decides. TAP = press and let go. HOLD = keep it down: a strip lights up; let go when the counter shows the strip&apos;s number.</>}>
            <ol>
              {Array.from({ length: BUTTON_RULES }, (_, i) => {
                const f = btn(i);
                if (!f) return <Torn key={i} label={`${i + 1}.`} />;
                const verdict = <b className={f.hold ? "text-[#9a3412]" : "text-[#1e3a8a]"}>{f.hold ? "HOLD" : "TAP"}</b>;
                return (
                  <Rule key={i} label={`${i + 1}.`}>
                    {f.if ? (
                      <>
                        If {condText(f.if)}: {verdict}.
                      </>
                    ) : (
                      <>Otherwise: {verdict}.</>
                    )}
                  </Rule>
                );
              })}
            </ol>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {STRIP_COLORS.map((c) => {
                const f = strips.find((s) => s.c === c);
                return (
                  <span key={c} className={`flex items-center gap-1 rounded border border-[#2b262040] px-1.5 py-0.5 text-[12px] ${f ? "" : "opacity-45"}`}>
                    <Swatch c={c} className="size-2.5" /> {c} strip → {f ? <b className="text-[14px]">{f.d}</b> : <span aria-label="unknown">?</span>}
                  </span>
                );
              })}
            </div>
          </Section>
        )}

        {has("keypad") && (
          <Section t="keypad" how={<>Each glyph has a value. Press the four keys from the lowest value to the highest, unless the order rule says otherwise.</>}>
            {korder ? (
              <ol>
                <Rule label="⇅">
                  If {condText(korder.if)}, press from the <b>highest</b> value to the lowest instead.
                </Rule>
              </ol>
            ) : (
              <ol>
                <Torn label="⇅" />
              </ol>
            )}
            <ul className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(5.6rem,1fr))] gap-1">
              {glyphs.map((f) => (
                <li key={f.g} className="flex items-center gap-1 rounded border border-[#2b262030] bg-white/30 px-1 py-0.5">
                  <Glyph g={f.g} className="size-6 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[10px] leading-tight opacity-70">{GLYPHS[f.g].name}</span>
                  <b className="text-[14px] tabular-nums">{f.v}</b>
                </li>
              ))}
            </ul>
            {glyphs.length < GLYPHS.length && <p className="mt-1 text-[10.5px] italic opacity-60">{GLYPHS.length - glyphs.length} glyph values are on other pages.</p>}
          </Section>
        )}

        {has("signal") && (
          <Section t="signal" how={<>Answer each flash with a pad. The 1st and 3rd flashes use the ODD table, the 2nd and 4th use the EVEN table. Each stage adds a flash: enter the whole run again.</>}>
            <div className="grid grid-cols-2 gap-2">
              {([0, 1] as const).map((p) => (
                <table key={p} className="w-full border-collapse text-[12px]">
                  <caption className="text-left text-[11px] font-black uppercase">{p === 0 ? "Odd flashes" : "Even flashes"}</caption>
                  <tbody>
                    {PAD_COLORS.map((c) => {
                      const f = sig(p, c);
                      return (
                        <tr key={c} className="border-b border-dotted border-[#2b262040]">
                          <td className="py-0.5 pr-1">
                            <C c={c} />
                          </td>
                          <td className="py-0.5" aria-label={f ? `press ${f.to}` : "unknown"}>
                            → {f ? <C c={f.to} /> : <span className="opacity-45">? torn</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ))}
            </div>
          </Section>
        )}

        {has("dial") && (
          <Section t="dial" how={<>Look up the code on the dial&apos;s screen. Turn to that number, apply the correction, then press SET. Past 8 the dial wraps to 1.</>}>
            <ol>
              {dfix ? (
                <Rule label="±">
                  If {condText(dfix.if)}, turn <b>{dfix.add} more</b> step{dfix.add > 1 ? "s" : ""} clockwise.
                </Rule>
              ) : (
                <Torn label="±" />
              )}
            </ol>
            <ul className="mt-1 flex flex-wrap gap-1">
              {codes.map((f) => (
                <li key={f.code} className="rounded border border-[#2b262040] bg-white/30 px-1.5 py-0.5 text-[12.5px]">
                  <b className="tracking-widest">{f.code}</b> → {f.pos + 1}
                </li>
              ))}
            </ul>
            {codes.length < CODEBOOK && <p className="mt-1 text-[10.5px] italic opacity-60">{CODEBOOK - codes.length} codes are on other pages.</p>}
          </Section>
        )}
      </div>
    </article>
  );
}
