# Player feedback — Ludum Dare 60

Collected on the [LD60 entry](https://ldjam.com/) during judging. Verbatim, newest first.

## Comments

**Viktoria** — roughly 2 days after submission

> A calm, pleasant game. I enjoyed the feeling of being a telegraph operator.

**Gevernus** — 15 hours after submission (edited)

> a morse rhythm game that sneakily teaches you letters, neat. the play area is
> narrow on desktop and the notes are small, a bit of scale-up would help

**Noble Goose** — 11 hours after submission

> Very meditative, simple, and nicely done. I really got into the rhythm. But it
> took me a little while :)

**mikeware** — 1 day after submission

> Cool to see someone else make a Morse Code game!

**Alexandru Barbanoua** — 1 day after submission

> Bro really cool game like gameplay a lot really feel like an old war teleprathis
> or something like that!

## What it tells us

| Theme | Votes | Reading |
| --- | --- | --- |
| Identity lands | 3 | "old war teleprinter", "morse rhythm game", "feeling of being a telegraph operator" — keep the CRT/phosphor look and the tap-and-hold verb |
| Desktop presentation | 1 | **Defect**: 480×720 portrait stage with `Scale.FIT` leaves huge gutters at 1080p, and hit objects are 12 physical pixels wide |
| Onboarding | 1 | **Gap**: a miss only subtracts quality silently; nothing says early/late/too short. The tutorial is text, not practice |

## Post-jam changes

The submitted build is tagged `ldjam-60-submission`; everything below is on
`main`.

1. **Wide desktop stage** — fixed height, aspect-driven width (up to 1280×720),
   1.5× note geometry, gate centred, scroll speed derived from track length.
2. **Teachability** — interactive practice (E, T, A), per-note
   PERFECT/GOOD/MISS plus EARLY/LATE/TOO LONG, visible beat grid, softer
   opening tempo, persisted letter stats.
3. **Correctness** — audio on keyboard start, filtered send keys, fixed
   `MEET`→`MET` history bug, ambience gated to Play, faster quality recovery.
4. **Full-width dressing** — the office painting covers the whole stage on wide
   screens (extended walls/desk instead of a centred 480-wide postcard), and
   the page behind the letterboxed portrait stage picks up the same warm wall
   tone.
5. **Morse chart** — `H` or the pause menu opens "Operator's Morse Chart" on a
   telegram-form panel; the run's clock is paused while it is open.
6. **Legibility on landscape phones** — short wide screens keep a 0.7× minimum
   physical scale (the logical stage shrinks), note geometry scales up, and
   the pause control became a real button with generous touch targets.
