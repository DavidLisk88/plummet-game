# Guided Tour System Spec

## Goal

Add a new top-level guided tour system that gives players a hands-on, hardcoded walkthrough of the app.

This is not a video player, not a GIF carousel, and not a random tutorial sandbox.

It is a scripted, interactive simulation layer that:

- uses the real app screens and real visual language
- darkens the screen around the focused control
- highlights buttons, panels, and grid cells with callouts
- advances on user input with Tap to Continue
- allows Exit at any time
- teaches by controlled interaction rather than passive reading
- remains deterministic with no randomness

## Product Requirements

The new tutorial selection screen should have a new section at the top for guided tours.

The guided tour catalog should include:

- General Tour
- Target Word Tour
- Speed Round Tour
- Word Category Tour
- Word Search Tour
- Word Runner Tour
- Bonuses Tour
- Leaderboards and Skill Rating Tour

Each tour must be replayable at any time.

Each tour must look like the real app, so players do not learn one interface and then encounter another.

## Current Code Reality

The app already has the right primitives for this feature, but not the right tutorial model.

Relevant current pieces:

- Tutorial menu and slide viewer exist in index.html and script.js.
- Tutorial content is currently category-based, canvas-drawn, and passive.
- Screen changes are centralized through `_showScreen(name)`.
- Challenge selection and challenge setup are centralized.
- Challenge types are already canonicalized in `CHALLENGE_TYPES`.
- The main app, Word Search, Word Runner, pause menus, dictionary, shop, music, and leaderboard all already exist as real screens and overlays.

Implication:

The correct solution is to extend the current tutorial system into a second mode: scripted guided tours.

The wrong solution is to build a separate fake app just for tutorials.

## First-Principles Model

### Facts

- Players learn faster when they can act, not just watch.
- The app already has a stable visual shell and reusable screens.
- Tutorials that diverge from production UI create confusion.
- Random gameplay is bad for education because it reduces script control.
- Full gameplay logic is too noisy for a tour if players can break the lesson flow.

### Reconstructed solution from those facts

We need a deterministic simulation mode that mounts the real screen shell, but uses scripted state and constrained input.

That means the tutorial system should be built around:

- real screen navigation
- scripted screen state snapshots
- selective interaction gates
- spotlight overlays and anchored callouts
- a tour runner with step-by-step progression rules

## Scientific Method

### Question

How do we teach the full app clearly without forcing players to infer functionality from static slides?

### Hypothesis

If we replace passive slide tutorials with deterministic, guided, touch-driven simulations on top of the real app UI, then players will understand controls, game flow, bonuses, and the skill system faster and with less confusion.

### Predictions

- Fewer first-session abandonment points after entering a game.
- Fewer misclicks on pause, hint, shop, and dictionary flows.
- Better comprehension of challenge differences.
- Better comprehension of why leaderboard rank is skill-based rather than score-only.
- Higher likelihood that players try multiple modes because they now understand them.

### Experiments to validate after launch

Track these metrics before and after rollout:

- tutorial open rate
- tutorial completion rate by tour type
- tutorial exit step distribution
- first game started after tutorial rate
- first session length after tutorial completion
- challenge adoption rate after challenge-specific tour completion
- leaderboard open rate after leaderboard tour completion

### Minimum experiment design

Phase 1 should ship General Tour plus one challenge tour and one leaderboard tour.

Success threshold:

- at least 40 percent completion on General Tour
- noticeable reduction in immediate pause-menu confusion and accidental exits
- no measurable rise in stuck-session or broken-navigation bugs

## Core Design Principle

### Real UI, scripted state

Every tour should render the actual app screen chrome, but the underlying state should be locked to a tutorial script.

Example:

- show the real main play screen
- freeze score and timers into a scripted snapshot
- only allow tapping the highlighted cell or button
- when the user taps correctly, advance to the next step

This gives authenticity without letting gameplay randomness destroy the lesson.

## High-Level Architecture

Build the guided tour system as five layers.

### 1. Tour Catalog Layer

Extends the current tutorial menu.

Responsibilities:

- show a new Guided Tours section above existing passive tutorials
- group tours by category
- show progress and replay status later if desired

### 2. Tour Runner Layer

A state machine that owns the active guided tutorial.

Responsibilities:

- load tour definition
- move through steps
- manage Tap to Continue
- validate required actions
- support exit and restart
- restore previous app state safely when the tour ends

### 3. Screen Simulation Layer

Applies deterministic tutorial state to whichever app screen is currently in focus.

Responsibilities:

- open real screens with `_showScreen(...)`
- populate scripted values for score, timers, buttons, grid contents, challenge cards, leaderboard rows, and modal states
- disable non-allowed actions

### 4. Spotlight and Annotation Layer

Renders the guided overlay.

Responsibilities:

- dim everything except the target region
- draw ring, pulse, arrow, label, body text, and Tap to Continue affordance
- reposition intelligently on mobile
- scroll target into view when needed

### 5. Input Gate Layer

Controls what the player is allowed to do during the current step.

Responsibilities:

- allow only highlighted actions when a step requires interaction
- swallow non-allowed taps
- optionally show subtle feedback for blocked areas

## Proposed Data Model

Create a dedicated guided tour data structure instead of mixing this into the current passive slide schema.

```js
const GUIDED_TOURS = [
  {
    id: 'general-tour',
    label: 'General Tour',
    description: 'Learn the main grid game, controls, menus, and tools.',
    group: 'guided',
    startScreen: 'menu',
    steps: [
      {
        id: 'intro-menu',
        screen: 'menu',
        mode: 'tap-to-continue',
        target: '#play-btn',
        title: 'Start Here',
        body: 'This is where you start a regular game.',
        action: null,
        continueLabel: 'Tap to Continue'
      },
      {
        id: 'open-play',
        screen: 'menu',
        mode: 'required-action',
        target: '#play-btn',
        title: 'Open the Main Game',
        body: 'Tap Play to see the main grid game.',
        action: { type: 'tap', selector: '#play-btn' },
        onComplete: { type: 'showScreen', screen: 'play' }
      }
    ]
  }
];
```

## Step Types

Every guided step should be one of a small number of deterministic primitives.

### Narrative step

Used when we only need to explain something.

Behavior:

- spotlight target
- no required action
- continue via Tap to Continue button or overlay tap

### Required tap step

Used when the player must tap a specific button, card, cell, or chip.

Behavior:

- only target tap is accepted
- progress immediately after success

### Required sequence step

Used when the player must perform a scripted mini-sequence.

Example:

- tap one letter
- tap a second letter
- then tap a third letter

### Simulated result step

Used after a required step to show the consequence.

Example:

- score pops up
- word validates
- combo increments
- pause overlay appears

### Choice explanation step

Used when explaining a set of options, such as bonuses or leaderboard class filters.

Behavior:

- multiple hotspots visible
- one target active at a time
- step advances through the sequence manually

### Modal walkthrough step

Used when opening pause, shop, dictionary, or leaderboard analysis overlays.

Behavior:

- open real modal
- freeze dismiss behavior except for allowed controls

## State Machine

Use an explicit tour runner state machine.

States:

- idle
- preparing-step
- waiting-for-tap-to-continue
- waiting-for-required-action
- animating-result
- paused-by-system
- exiting
- complete

Transitions must be explicit. Do not rely on incidental DOM state.

## Simulation Strategy

### Main grid game tours

Do not run the normal random gameplay loop.

Instead:

- inject a fixed board layout
- inject fixed next letters
- inject fixed score values
- inject fixed combo values
- disable time pressure unless the step is teaching time pressure
- disable random bonus generation

This avoids tutorial drift and makes QA possible.

### Word Search tour

Use a fully fixed puzzle with known word locations.

Teach:

- drag or tap selection behavior
- discovering a placed word
- how bonus words differ from placed words
- pause and dictionary access

### Word Runner tour

Use a scripted lane/platform sequence.

Teach:

- tap to jump
- collect letters
- tap boxes to validate a word
- what happens on bad validation
- how pause and words-so-far work

Do not teach with a live endless run during the tutorial.

## Guided Overlay Design

The overlay should feel like a premium app tour, not a debug layer.

Required visual components:

- full-screen dim mask
- cutout spotlight around target
- pulsing ring around target
- arrow or tether line from callout card to target
- title text
- explanatory body copy
- step counter
- Tap to Continue button when step type uses manual advance
- Exit Tour button always visible

Overlay behavior rules:

- must adapt to safe areas and mobile sizes
- must not hide the target under the callout card
- must animate gently, not noisily
- must survive orientation change and resize

## Tour Catalog Structure

The guided section at the top should be grouped like this.

### Group 1: Start Here

- General Tour

### Group 2: Challenge Tours

- Target Word
- Speed Round
- Word Category
- Word Search
- Word Runner

### Group 3: Systems Tours

- Bonuses
- Leaderboards and Skill Rating

## Detailed Tour Outlines

### 1. General Tour

Purpose:

Teach the main grid-based game loop and the app-wide tools.

Must cover:

- menu layout
- Play entry point
- score bar and HUD
- hints button
- pause button
- pause menu buttons
- dictionary access
- shop access
- music access
- words found view
- how letters score points
- how one letter can contribute to more than one word

Recommended step flow:

1. Menu overview
2. Tap Play
3. Explain score, timer or mode bar, and coin bar
4. Spotlight hints button
5. Spotlight pause button
6. Open pause menu and explain Resume, Dictionary, Music, Shop, Save and Quit or End Game
7. Resume into scripted board
8. Tap one highlighted letter placement or interaction point
9. Show a simple word result and score popup
10. Show how one placed letter can complete multiple words
11. Open words-found view
12. Return and explain dictionary and music access
13. End with prompt to try a real game

### 2. Target Word Tour

Purpose:

Teach target progression and level-based word objectives.

Must cover:

- where target word is shown
- how to build toward it
- what happens when target word is completed
- level-up pacing and next target

### 3. Speed Round Tour

Purpose:

Teach pressure escalation.

Must cover:

- falling speed increases over time
- fast decision making matters
- pause behavior during a high-pressure mode
- score versus survival mindset

### 4. Word Category Tour

Purpose:

Teach category matching and bonus scoring.

Must cover:

- category selection
- valid category match example
- invalid but normal word example
- difference between ordinary score and category bonus

### 5. Word Search Tour

Purpose:

Teach discovery-based search.

Must cover:

- how selection works
- how to find hidden words without a visible list
- difference between placed words and bonus discoveries
- pause, dictionary, and words found behaviors for this mode

### 6. Word Runner Tour

Purpose:

Teach movement and word validation in runner format.

Must cover:

- tap to jump
- collect letters
- fill word boxes
- validate a word
- what invalid attempts look like
- pause and words-so-far access

### 7. Bonuses Tour

Purpose:

Teach bonus discovery, slot usage, and outcomes.

Must cover:

- how bonuses unlock
- what the bonus button means
- radial slots if unlocked
- letter pick
- bomb
- wildcard
- line clear
- freeze
- shuffle
- score 2x

Important design rule:

This should use isolated scripted vignettes, not one giant session. Each bonus should be demonstrated in a controlled mini-scene.

### 8. Leaderboards and Skill Rating Tour

Purpose:

Teach the meta system clearly.

Must cover:

- how to open leaderboard
- difference between overall and challenge tabs
- skill rating versus raw high score
- class tiers
- player analysis cards
- why improvement and consistency matter

This tour should align with the current skill engine weights and class thresholds so the explanation is true to the product.

## Creative Guidance Patterns

Use multiple teaching patterns so the tours do not all feel identical.

### Spotlight mode

Best for buttons and menus.

### Ghost-hand mode

Show a subtle animated fingertip or trail for the first required interaction when needed.

Best for:

- first grid tap
- first jump in Word Runner
- first word-search drag

### Controlled before-and-after mode

Freeze the screen, then show an action result.

Best for:

- bonus activation
- word scoring
- leaderboard analysis expansion

### Mistake-and-correction mode

Intentionally show one incorrect action, then explain the right one.

Best for:

- invalid Word Runner validation
- non-category word in Word Category mode
- leaderboard misunderstanding that score alone determines rank

### Layer peel mode

Move through one feature stack one layer at a time.

Best for:

- pause menu explanations
- bonuses menu explanations
- leaderboard tabs and filters

## UX Rules

- Every step must have a clear next action.
- Every step must have an exit path.
- Never auto-advance after a long timer unless the step is explicitly an animation reveal.
- If the player taps outside the target during a required-action step, do not break the tour.
- If the player exits, return them safely to the prior real screen.
- The tour must never write real scores, coins, XP, stats, or leaderboard updates.

## Technical Execution Plan

### Phase 1: Foundation

Build the guided tour engine.

Deliverables:

- `guided-tour-overlay` DOM shell in index.html
- `GuidedTourRunner` inside script.js or a new module
- guided tour catalog data structure
- step targeting by CSS selector or rect provider
- action gating and restore logic

### Phase 2: General Tour

Build the first end-to-end interactive tour.

Deliverables:

- menu steps
- main play screen scripted board
- pause menu walkthrough
- dictionary, music, shop callouts
- words-found example

This is the proving ground. If this is solid, the rest become content and adapters.

### Phase 3: Challenge Adapters

Build one adapter per challenge type.

Deliverables:

- scripted challenge state factories
- challenge-specific step validators
- challenge-specific UI focus maps

### Phase 4: Bonuses and Meta Tours

Build the bonuses tour and leaderboard tour.

Deliverables:

- bonus vignette scenes
- leaderboard simulation state
- skill explanation cards tied to real thresholds and challenge tabs

### Phase 5: Analytics and Polish

Deliverables:

- tutorial started/completed/exited analytics
- resumed-from-exit support if desired
- accessibility pass
- mobile layout edge-case fixes

## Threat Model

Treat this as both a technical and product threat model.

### Spoofing

Risk:

Tutorial UI drifts from production UI and effectively teaches a fake app.

Mitigation:

- reuse real screens and components
- use shared selectors and existing DOM
- avoid standalone mock screens unless a feature absolutely cannot be safely simulated

### Tampering

Risk:

Normal gameplay systems mutate tutorial scenes or tutorial state leaks into production state.

Mitigation:

- isolate tutorial state in a dedicated object
- block score persistence, profile writes, save writes, XP writes, and leaderboard updates during tours
- make all tutorial mutations reversible and local-only

### Repudiation

Risk:

Hard to diagnose where players drop or where the tour breaks.

Mitigation:

- log tour ID, step ID, exit step, and action validation failures
- record completion and abandonment analytics

### Information Disclosure

Risk:

Leaderboard tour accidentally exposes real player data when a controlled example should be shown.

Mitigation:

- use simulated leaderboard rows for tutorial mode
- do not fetch live analysis data during guided examples

### Denial of Service

Risk:

Overlay traps input or leaves the app stuck in a blocked state after exit.

Mitigation:

- centralized cleanup method that always restores listeners, overlays, paused states, and screen target
- kill switch on Escape, close button, and app backgrounding

### Elevation of Privilege

Risk:

Tutorial mode grants players free bonus usage, score state, or inventory state in real gameplay.

Mitigation:

- never route tutorial actions through reward-granting code without a tutorial-mode guard
- reject profile mutations when `guidedTour.active === true`

## Failure Modes to Design Against

- highlighted selector not found because screen is not ready yet
- overlay card covers the highlighted element on small screens
- orientation change invalidates target geometry
- user exits while a modal is open
- user opens tutorial from one screen and is restored to the wrong screen
- real timers continue running under tutorial mode
- pause overlays and music dropdown interactions conflict with action gating
- challenge-specific screens differ enough that generic step logic breaks

## Acceptance Criteria

The feature is only done when all of these are true.

- Guided Tours appear above passive tutorials in the tutorial menu.
- General Tour is fully interactive and uses the real app shell.
- Each challenge has its own separate guided tour.
- Bonuses has its own dedicated guided tour.
- Leaderboards and skill rating have their own dedicated guided tour.
- Every tour is deterministic and replayable.
- Every tour supports Tap to Continue and Exit Tour.
- No tutorial action modifies persistent player progress.
- Exiting a tour restores the app to a sane screen and input state.
- Mobile layout works without clipped callouts or unreachable targets.

## Test Plan

### Functional tests

- launch each tour from the tutorial menu
- complete each tour
- exit each tour from early, middle, and final step
- rotate screen during a highlighted step
- background and foreground app during a tour
- verify no XP, coins, score history, or inventory changes persist

### Screen coverage tests

- menu
- play
- pause overlay
- words found
- dictionary
- shop
- music
- challenge selection
- challenge setup
- word search
- word runner
- leaderboard

### Input validation tests

- correct tap advances when required
- wrong tap is blocked without breaking the tour
- Tap to Continue only advances narrative steps
- exit button always works

## Recommended Build Order

1. Build the guided overlay shell and step runner.
2. Convert General Tour first.
3. Add one challenge adapter using Target Word.
4. Reuse the adapter pattern for the other challenge tours.
5. Add Bonuses tour.
6. Add Leaderboards and Skill Rating tour.
7. Add analytics and polish.

## Strong Recommendation

Do not try to build every tour at once.

Build one generalized guided-tour engine and prove it with the General Tour. If that engine can handle:

- screen changes
- overlays
- button spotlighting
- constrained taps
- scripted board state

then the remaining tours become content work plus a few mode-specific adapters instead of eight separate one-off systems.

## Immediate Next Implementation Slice

The next coding slice should be:

1. add the guided-tour overlay DOM
2. add a `guidedTour` controller object
3. add new top-of-menu Guided Tours entries
4. implement General Tour with 10 to 12 scripted steps
5. harden exit and cleanup behavior before adding more tours

That is the highest-leverage path with the lowest architectural risk.