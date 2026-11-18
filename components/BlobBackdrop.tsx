// The site-wide backdrop: lava-lamp colour blobs drifting behind every page, under a print
// halftone. Fixed and pointer-transparent; it fades right down while a game is being played
// (<html data-playing>). Pure CSS, no client JS.
const C = ["#c6f432", "#ff4fa3", "#4f7bff", "#ffd23f"];

export function BlobBackdrop() {
  return (
    <div aria-hidden className="hero-field bd-global">
      {C.map((c, i) => (
        <span key={i} className={`bd-blob bd-blob-${i}`} style={{ "--c": c } as React.CSSProperties} />
      ))}
      <span className="bd-halftone" />
    </div>
  );
}
