/** Verbatim stylesheet of the approved fieldwork-v1 artifact. Source parity is tested. */
export const FIELDWORK_REFERENCE_CSS = `
    :root {
      --paper: #f3f0e8;
      --paper-deep: #e6e1d5;
      --ink: #20241f;
      --muted: #62665d;
      --line: rgba(32, 36, 31, .22);
      --moss: #4d5a43;
      --clay: #bd7250;
      --white: #fffdf7;
      --serif: Georgia, "Times New Roman", serif;
      --sans: "Helvetica Neue", Arial, sans-serif;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--sans);
      font-size: 16px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    img { display: block; max-width: 100%; }
    a { color: inherit; }
    a:focus-visible { outline: 3px solid var(--clay); outline-offset: 5px; }
    ::selection { background: var(--clay); color: var(--white); }

    .proposal-note {
      padding: .45rem 5vw;
      background: var(--ink);
      color: var(--paper);
      font-size: .65rem;
      letter-spacing: .15em;
      text-align: center;
      text-transform: uppercase;
    }

    .site-header {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      padding: 1.1rem 5vw;
      border-bottom: 1px solid var(--line);
      background: rgba(243, 240, 232, .96);
    }

    .wordmark {
      max-width: 12rem;
      font-family: var(--serif);
      font-size: 1.15rem;
      line-height: 1.05;
      text-decoration: none;
    }

    .wordmark span { color: var(--moss); font-style: italic; }

    nav {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: .35rem 1.6rem;
    }

    nav a {
      position: relative;
      padding: .3rem 0;
      font-size: .7rem;
      font-weight: 600;
      letter-spacing: .14em;
      text-decoration: none;
      text-transform: uppercase;
    }

    nav a::after {
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      height: 1px;
      background: currentColor;
      content: "";
      transform: scaleX(0);
      transform-origin: right;
      transition: transform .25s ease;
    }

    nav a:hover::after { transform: scaleX(1); transform-origin: left; }

    .eyebrow {
      display: flex;
      align-items: center;
      gap: .7rem;
      margin: 0 0 1.25rem;
      font-size: .68rem;
      font-weight: 600;
      letter-spacing: .17em;
      line-height: 1.4;
      text-transform: uppercase;
    }

    .eyebrow::before {
      width: 1.8rem;
      height: 1px;
      background: currentColor;
      content: "";
    }

    .hero {
      position: relative;
      min-height: min(790px, 88vh);
      margin: 1.25rem;
      overflow: hidden;
      isolation: isolate;
      background: var(--moss);
      color: var(--white);
    }

    .hero-image {
      position: absolute;
      z-index: -2;
      width: 100%;
      height: 100%;
      object-fit: cover;
      animation: settle 14s ease-out both;
    }

    .hero::after {
      position: absolute;
      z-index: -1;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(20, 25, 20, .83) 0%, rgba(20, 25, 20, .5) 48%, rgba(20, 25, 20, .16) 100%),
        linear-gradient(0deg, rgba(20, 25, 20, .58), transparent 55%);
      content: "";
    }

    .hero-content {
      display: flex;
      min-height: inherit;
      flex-direction: column;
      justify-content: space-between;
      padding: clamp(2rem, 6vw, 5.5rem);
    }

    .hero h1 {
      max-width: 850px;
      margin: 0;
      font-family: var(--serif);
      font-size: clamp(3rem, 7.2vw, 7rem);
      font-weight: 400;
      letter-spacing: -.055em;
      line-height: .94;
    }

    .hero h1 em { color: #e5b39a; font-weight: 400; }

    .hero-bottom {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(220px, 340px);
      align-items: end;
      gap: 2rem;
      padding-top: 4rem;
    }

    .hero-bottom p {
      grid-column: 2;
      margin: 0 0 1.5rem;
      color: rgba(255, 253, 247, .86);
      font-size: 1.05rem;
    }

    .button {
      display: inline-flex;
      width: fit-content;
      align-items: center;
      gap: 1.4rem;
      padding: .85rem 1.15rem;
      border: 1px solid currentColor;
      font-size: .7rem;
      font-weight: 600;
      letter-spacing: .13em;
      text-decoration: none;
      text-transform: uppercase;
      transition: background .2s ease, color .2s ease;
    }

    .button::after { content: "↘"; font-size: 1rem; }
    .hero .button { grid-column: 2; }
    .hero .button:hover { background: var(--white); color: var(--ink); }

    .section {
      padding: clamp(4.5rem, 9vw, 9rem) 5vw;
      border-bottom: 1px solid var(--line);
    }

    .section-heading {
      display: grid;
      grid-template-columns: minmax(150px, 1fr) minmax(0, 3fr);
      gap: 2rem;
      margin-bottom: clamp(3rem, 6vw, 5rem);
    }

    h2 {
      max-width: 850px;
      margin: 0;
      font-family: var(--serif);
      font-size: clamp(2.5rem, 5vw, 5rem);
      font-weight: 400;
      letter-spacing: -.045em;
      line-height: 1;
    }

    h2 em { color: var(--moss); font-weight: 400; }

    .about-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: clamp(2rem, 7vw, 7rem);
      margin-left: 25%;
    }

    .about-grid p { margin: 0; }
    .about-grid .lead { font-family: var(--serif); font-size: clamp(1.3rem, 2vw, 1.75rem); line-height: 1.4; }
    .about-grid .secondary { color: var(--muted); }

    .principles {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1px;
      margin-top: 5rem;
      background: var(--line);
      border: 1px solid var(--line);
    }

    .principle { padding: 2rem; background: var(--paper); }
    .principle span { color: var(--clay); font-family: var(--serif); font-style: italic; }
    .principle h3 { margin: 2.5rem 0 .6rem; font-size: .85rem; letter-spacing: .08em; text-transform: uppercase; }
    .principle p { margin: 0; color: var(--muted); font-size: .9rem; }

    .services { background: var(--ink); color: var(--paper); }
    .services .eyebrow, .services h2 em { color: #d9a58c; }
    .service-list { border-top: 1px solid rgba(243, 240, 232, .3); }

    .service {
      display: grid;
      grid-template-columns: .5fr 2fr 2fr;
      gap: 2rem;
      padding: clamp(2rem, 4vw, 3.5rem) 0;
      border-bottom: 1px solid rgba(243, 240, 232, .3);
    }

    .service-number { color: #d9a58c; font-family: var(--serif); font-size: 1.2rem; font-style: italic; }
    .service h3 { margin: 0; font-family: var(--serif); font-size: clamp(2rem, 3.5vw, 3.4rem); font-weight: 400; line-height: 1.05; }
    .service p { max-width: 440px; margin: 0; color: rgba(243, 240, 232, .72); }

    .tags { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1.4rem; }
    .tags span { padding: .35rem .65rem; border: 1px solid rgba(243, 240, 232, .3); font-size: .65rem; letter-spacing: .08em; text-transform: uppercase; }

    .contact { background: var(--paper-deep); }
    .contact-inner { max-width: 1050px; margin: auto; text-align: center; }
    .contact .eyebrow { justify-content: center; }
    .contact h2 { margin: auto; font-size: clamp(3rem, 7vw, 7rem); }
    .contact p { max-width: 570px; margin: 2rem auto; color: var(--muted); }
    .contact .button { margin: auto; background: var(--ink); color: var(--paper); }
    .contact .button:hover { background: var(--moss); }
    .contact-note { display: block; margin-top: 1.5rem; color: var(--muted); font-size: .72rem; }

    footer {
      display: flex;
      justify-content: space-between;
      gap: 2rem;
      padding: 2rem 5vw;
      font-size: .68rem;
      letter-spacing: .1em;
      text-transform: uppercase;
    }

    @keyframes settle {
      from { transform: scale(1.06); }
      to { transform: scale(1); }
    }

    @media (max-width: 760px) {
      .site-header { position: relative; align-items: flex-start; flex-direction: column; gap: .8rem; }
      .wordmark { max-width: none; }
      nav { width: 100%; justify-content: space-between; gap: .5rem; }
      nav a { font-size: .62rem; }
      .hero { min-height: 720px; margin: .75rem; }
      .hero-content { padding: 2rem 1.5rem; }
      .hero h1 { font-size: clamp(3rem, 14vw, 5rem); }
      .hero-bottom { display: block; padding-top: 3rem; }
      .hero-bottom p { max-width: 330px; }
      .section-heading, .about-grid, .service { grid-template-columns: 1fr; }
      .section-heading { gap: 1rem; }
      .about-grid { margin-left: 0; }
      .principles { grid-template-columns: 1fr; }
      .principle h3 { margin-top: 1rem; }
      .service { gap: 1.25rem; }
      footer { flex-direction: column; gap: .5rem; }
    }

    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after {
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .01ms !important;
      }
    }
  
/* Human-requested refinement of the recorded proposal; not a new provider receipt. */
.hero-content{justify-content:center;gap:2rem}.hero h1{max-width:16ch;text-wrap:balance;font-size:clamp(2.8rem,6.2vw,6.3rem);line-height:1.02}
.hero-bottom{display:block;padding-top:0;max-width:43ch}.hero-bottom p{color:var(--white);margin:0 0 1.5rem}.hero-image{animation-duration:1200ms}
h2,h3{text-wrap:balance}.section-heading{grid-template-columns:minmax(150px,1fr) minmax(0,3fr)}.about-grid{margin-left:calc(25% + .5rem)}
.service p{color:var(--paper)}.button,nav a{min-height:44px;align-items:center}.button{transition:transform 180ms ease,background 180ms ease,color 180ms ease}.button:hover{transform:translateY(-2px)}.button:active{transform:translateY(0)}nav a{display:inline-flex}
.material-intro{max-width:48ch;margin:0 0 2rem;font-size:1.05rem}.material-track{display:grid;grid-auto-flow:column;grid-template-columns:none;grid-auto-columns:72%;gap:24px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;overscroll-behavior-inline:contain;padding-bottom:18px;scrollbar-color:var(--moss) var(--paper-deep)}
.material-track:focus-visible{outline:3px solid var(--moss);outline-offset:6px}.material-track figure{margin:0;scroll-snap-align:start;scroll-margin-top:110px}.material-track img{width:100%;height:auto;aspect-ratio:4/3;object-fit:cover}.material-track figcaption{padding-top:16px;font-size:1rem}.material-nav{justify-content:flex-start;margin-top:12px}.material-nav a{padding:10px 16px;background:var(--paper-deep);font-size:14px;letter-spacing:0;text-transform:none}.material-note{font-size:14px;color:var(--muted)}
@keyframes refined-arrive{from{transform:translateY(14px);opacity:.7}to{transform:none;opacity:1}}
@media(prefers-reduced-motion:no-preference){.hero-content{animation:refined-arrive 650ms ease-out both}@supports(animation-timeline:view()){.section-heading,.material-track{animation:refined-arrive linear both;animation-timeline:view();animation-range:entry 0% entry 90%}}}
@media(max-width:760px){.hero{min-height:640px}.hero-content{padding:2rem 1.5rem;gap:1.5rem}.hero h1{font-size:clamp(2.6rem,10.8vw,4rem);max-width:16ch}.hero-bottom{padding-top:0}.section-heading{grid-template-columns:1fr}.about-grid{margin-left:0}.material-track{grid-auto-columns:88%;gap:16px}.section{padding:64px 6vw}.contact h2{font-size:clamp(2.5rem,10vw,4rem)}}
@media(prefers-reduced-motion:reduce){html,.material-track{scroll-behavior:auto}.hero-image,.hero-content,.section-heading,.material-track{animation:none!important}.button{transition:none}}


/* Consistent reading columns and a compact, automatically advancing gallery. */
.section{padding-block:clamp(64px,7vw,104px)}.section-heading{display:block;margin-bottom:36px}.section-heading .eyebrow{margin-bottom:20px}.section-heading h2{max-width:26ch;font-size:clamp(2.3rem,4.2vw,4rem);line-height:1.12;letter-spacing:-.025em;text-wrap:balance}.about-grid{margin-left:0;gap:48px;grid-template-columns:1fr 1fr;max-width:1000px}.about-grid p{max-width:48ch}.principles{margin-top:40px}
.service-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:64px;border:0}.service{display:block;padding:32px 0 0;border-bottom:0;border-top:1px solid rgba(243,240,232,.25)}.service-number,.service .tags{display:none}.service h3{font-size:clamp(1.8rem,2.8vw,2.6rem);line-height:1.15;letter-spacing:-.02em;max-width:22ch}.service p{margin:20px 0 0;max-width:46ch;font-size:1.05rem;line-height:1.7;color:var(--paper)}
.material-gallery{max-width:1000px}.material-viewport{overflow-x:auto;touch-action:pan-y}.is-ready .material-viewport{overflow:hidden}.material-track{display:flex;gap:24px;overflow:visible;padding:0;animation:none!important;scroll-snap-type:none;will-change:transform}.material-track figure{flex:0 0 calc((100% - 24px)/2);min-width:0;scroll-margin-top:110px}.material-track img{width:100%;height:260px;aspect-ratio:auto;object-fit:cover}.material-track figcaption{padding-top:14px;font-size:15px;line-height:1.5}.material-controls{display:none;align-items:center;justify-content:space-between;gap:24px;margin-top:24px}.is-ready .material-controls{display:flex}.material-controls p{font-size:14px;color:var(--muted);margin:0;max-width:45ch}.material-controls>div{display:flex;gap:12px;flex-shrink:0}.material-controls button{width:48px;height:48px;border:1px solid var(--moss);border-radius:50%;background:transparent;color:var(--ink);font-size:24px;cursor:pointer;transition:background 180ms ease,color 180ms ease}.material-controls button:hover{background:var(--ink);color:var(--paper)}.material-controls button:focus-visible,.material-viewport:focus-visible{outline:3px solid var(--clay);outline-offset:4px}.material-note{margin-top:18px}
@media(max-width:760px){.about-grid,.service-list{grid-template-columns:1fr;gap:32px}.section-heading{margin-bottom:28px}.section-heading h2{font-size:clamp(2.1rem,8vw,3rem)}.service{padding-top:24px}.service h3{font-size:1.9rem}.service p{font-size:1rem;margin-top:16px}.material-track figure{flex-basis:100%}.material-track img{height:220px}.material-controls{align-items:flex-start;gap:16px}.material-controls p{max-width:22ch;font-size:13px}.material-track figcaption{font-size:14px}.material-controls button{width:44px;height:44px}}

`;
