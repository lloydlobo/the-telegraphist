Vague recollections of how this came about:

- Brainstormed on day 1
- Played around with Phaser and tried out different game ideas
- Satisfied with the current rhythm based morse code learn+play gameplay
- There is too much left to polish and fix

Thanks to everyone that are participating. Your energy rubs off, with each moment spent on the game!

Hope you enjoy it:

---

## Problems Faced

- Import `phaser.min.js` directly to the js file
  - development a bit weird because of the missing types
- Emotional Damage: Not in the best of states
  - First day spent in coming up with the best idea

## Phaser Primitives

- Create a Menu scene by extending Phaser.Scene and passing "Menu" to super() in its constructor to register the scene key.
- Create a scene with `class Menu extends Phaser.Scene` and name it `constructor() { super("Menu"); }`
- For each scene we set a Graphics Background with `this.cameras.main.setBackgroundColor(COLOR.BG);
- Add text with `this.add.text(x, y, text, { fontFamily, fontSize, color, fontStyle }).setOrigin(0.5)
- Start a scene with `this.scene.start("SceneName")`
- Register a callback with `this.input.keyboard.once("keydown-SPACE", fn)`
-

## Entry Point

```javascript
new Phaser.Game({
  type: Phaser.AUTO,
  width: w,
  height: H,
  backgroundColor: COLOR.BG,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [Menu, Tutorial, Play, Pause, Over],
});
```

## Scenes

### Menu

- create()

### Tutorial

- create()

### Play

- create()
- update()
- scheduleWord()
- handlePress()
- handleRelease()
- resolveNote()
- gameTimeFromEvent()

### Helpers

- statsFor()
- isMastered()

### Pause

- create()

### Over

- create()

## Audio and SFX

### Audio

### SFX

---

## Pre game mind dump / Brainstorming

Had quite the list of ideas for theme within the theme. After a quick google
lens and categorizing with gippity, we had a collection of old technologies,
techological evolution, and obsolete system that could serve as inspiration for
the Old Tech game-jam theme; the strongest organizing principle is how humans
solve the same problem differently as technology evolves.

- **Mechanical**: abacus, horse cart, pinball, manual cars, water mills.
- **Communication**: Enigma, HAM radio, dial-up, IRC, pigeons, smoke signals.
- **Computing and media**: mainframes → chips, tape programming, VHS, Walkman, iPod.
- **Energy and infrastructure**: electricity lines, boilers, satellite phones, Chernobyl.

## Generating small mini-games "Old Tech" collections

- Passed these collections to a local llm
- Brainstormed with it
  - Discussion about Phaser
  - game jam constrainsts
- Decided to go with Arcade styled games with a retro feel
- Had it build directories for each game ideas

### Breakdown

**Theme:** Technology changes. The problem does not. — every row is a problem humans never stopped re-solving; each cell is one era's answer.

**Glue**: Fourteen games, one row each. Every row is a problem humans never stopped re-solving — reaching someone far away, keeping a secret, getting an answer, holding a machine inside its safe band. Each cell is one era's answer.

| #   | Game           | Folder / Link     | Family   | Problem (family theme)                    | Era                | Tech Chain (family progression)                                | Description (from card)                                                            |
| --- | -------------- | ----------------- | -------- | ----------------------------------------- | ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Pigeon Post    | `pigeon-post/`    | Reach    | message a distant person                  | pre-electric       | smoke signal → pigeon → telegraph → switchboard → radio        | Slingshot a carrier pigeon across the rooftops and keep it flying.                 |
| 2   | Dit Dah        | `dit-dah/`        | Reach    | message a distant person                  | telegraph          | smoke signal → pigeon → telegraph → switchboard → radio        | Key Morse onto paper tape, in rhythm, without dropping a character.                |
| 3   | Switchboard    | `oldtech/`        | Reach    | message a distant person                  | manual exchange    | smoke signal → pigeon → telegraph → switchboard → radio        | Drag a lead from a ringing jack to its numbered socket before the board overloads. |
| 4   | Skip           | `skip/`           | Reach    | message a distant person                  | radio              | smoke signal → pigeon → telegraph → switchboard → radio        | One antenna. One storm. One SOS. The ionosphere is the only wire left.             |
| 5   | Daily Key      | `daily-key/`      | Secrecy  | only the recipient can read it            | rotor cipher       | Caesar shift → cipher wheel → Enigma → one-time pad            | Set the wheels and the plugs, then break the intercept before the watch ends.      |
| 6   | Ready Reckoner | `ready-reckoner/` | Compute  | get an answer                             | abacus             | tally stick → abacus → ready reckoner → punch card → mainframe | It is 1961. The firm has bought a machine. Add the old money on the beads anyway.  |
| 7   | Card Reader    | `card-reader/`    | Compute  | get an answer                             | punch cards        | tally stick → abacus → ready reckoner → punch card → mainframe | Ten tickets. One shift. No second shift.                                           |
| 8   | Pianola        | `pianola/`        | Remember | replay a performance that is already gone | paper roll         | pin drum → music box → piano roll → celluloid → tape           | Punch a player-piano roll so the automaton plays the tune.                         |
| 9   | Reel Trouble   | `reel-trouble/`   | Remember | replay a performance that is already gone | celluloid          | pin drum → music box → piano roll → celluloid → tape           | Splice tears, wipe dust, hold the vent. If the audience walks out, you are fired.  |
| 10  | Night Shift    | `night-shift/`    | Power    | keep a system inside its safe band        | steam control room | water mill → steam plant → national grid → reactor             | Control room, 03:00. Hold four coupled gauges and log every reading.               |
| 11  | Brownout       | `brownout/`       | Power    | keep a system inside its safe band        | national grid      | water mill → steam plant → national grid → reactor             | Keep the grid at 50 Hz through the evening peak.                                   |
| 12  | Cold Start     | `cold-start/`     | Move     | body or cargo, here to there              | manual car         | horse cart → hand crank → foot brake                           | Crank, choke and double-declutch a 1934 delivery across town.                      |
| 13  | Phosphor       | `phosphor/`       | Amuse    | waste time on purpose                     | CRT vector         | penny arcade → vector CRT → console                            | A vector tunnel on a phosphor screen. Keep them off the near ring.                 |

### Playing through all games 

TLDR; The standouts were **Dit Dah** and **Reel Trouble**

Skipped **Reel Trouble** :
  - Primary, for the immediate complexity required to make it all work
  - Secondly, as progression of skill level and clear game progression required adding too many impediments
  - Finally, with some of my preferred game jams submissions, and as pointed by others, they love it when they can play and learn at the same time
    So, the reel trouble would act more as a simulation, or "history gazing" or "going down memory lane" even if that is a word

Chose **Dit Dah**:
  - Previous submission was about **mixed signals** - where the waves moved
    horizontally to the screen and one had to match the target wave's
    properties. 
    - The musical nature, and going with the flow of the wave - was quite appealing

#### Honorable Mentions

**Phosphor**

Silly, radial and amusing `A vector tunnel on a phosphor screen. Keep them off the near ring.`
Never understood the scoring system and the movement of the enemies were bit wonky...
Also, the controls of the player ship was freaking amazing!!

**Cold Start**

This for me can be a great game for the generation that never got to learn
clutch and even more so for the generation that rave about manual transmission
- but, don't know the pains the generation before had to go through
