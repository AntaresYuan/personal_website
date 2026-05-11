# vendored: vis-timeline

[vis-timeline](https://visjs.github.io/vis-timeline/) — interactive timeline /
2d-graph library, used by the Roadmap → **Timeline** view (`scripts/render.js`,
`buildTimelineView`). It's loaded *lazily* (only when the Timeline tab is first
opened) by injecting the two files below; nothing here is on the critical path
for the rest of the site.

- `vis-timeline-graph2d.min.js` — the **standalone UMD bundle** (bundles
  moment.js, hammer.js, etc.), `vis-timeline@8.5.1`.
- `vis-timeline-graph2d.min.css` — its stylesheet, `vis-timeline@8.5.1`. Our
  own overrides live in `styles/main.css` under "Timeline view".
- `LICENSE-MIT` — vis-timeline is dual-licensed **MIT OR Apache-2.0**; the MIT
  text is included here. © 2011–2017 Almende B.V. and contributors; 2017–
  vis.js contributors.

To update: bump the version in
`https://unpkg.com/vis-timeline@<version>/standalone/umd/vis-timeline-graph2d.min.js`
(and `.../styles/vis-timeline-graph2d.min.css`), re-download into this folder,
and bump the `?v=` query in `scripts/render.js` (`VIS_TIMELINE_VER`).
