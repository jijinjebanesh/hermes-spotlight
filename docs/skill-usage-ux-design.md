# Skill usage UX design

## Goal

Make it clear when Hermes uses a skill, what the skill is doing, and what it produced, without turning a compact desktop conversation into a log viewer.

## Design decision

Show one **skill run** as the parent activity and group the individual tools underneath it. A skill represents the approach Hermes chose; a tool represents a concrete action. Keep those labels distinct.

The activity should answer these questions in order:

1. What skill is active?
2. What is happening now, or what happened?
3. What can I inspect or open next?

## Conversation layout

Keep the current prompt and response layout. Replace a bare tool row with a compact parent card. Put the assistant's useful answer in the normal conversation flow after the card; do not repeat the same result inside the card.

### Running

```text
┌ ◌  Web research                                  Working · 4.5s ┐
│    Searching Brave for AI engineering and Flutter roles          │
│    ✓ Opened a new tab        ·        Searching…       Details ▾ │
└─────────────────────────────────────────────────────────────────┘
```

### Completed

```text
┌ ✓  Web research                                 Done · 4.5s   ▾ ┐
│    Searched in Brave · 1 page opened                View in Brave │
└─────────────────────────────────────────────────────────────────┘

Hermes's concise findings appear here as regular assistant text.
```

The completed card contracts to one or two lines. “View in Brave” appears only when the run has a real destination. “Details” expands the grouped action list, with durations and errors attached to the relevant step.

## Skill discovery and selection

Use the existing **+** composer menu as the entry point, with a searchable **Skills** section. Do not add a permanent toolbar button to the narrow input surface.

- Keep **Automatic** selected by default; Hermes may choose a suitable skill for the request.
- Let a user pin a skill for the next prompt from the picker. Show the selection as a removable chip in the composer so it is visible before sending.
- Each picker result gets a plain-language description and a small category label. Selecting a skill should not send the prompt or open a second modal.
- Keep the current slash-command flow intact. The picker is the discoverable path; keyboard users can navigate it and filter by typing.

## States and behavior

| State | Activity presentation | Available action |
|---|---|---|
| Automatic choice | “Using **Web research**” with a short reason such as “This request needs current web results.” | Expand details |
| Running | Active skill name, current action, completed/current step count, elapsed time | Stop only when the run can actually be cancelled; expand details |
| Completed | Skill name, short outcome, total duration | Open destination when available; expand steps |
| Needs user input | Plain request for the specific permission or missing choice, attached to the relevant step | Approve, decline, or choose |
| Failed | Skill name and the failed step in human language | Retry when supported; inspect the error |

Use both a short status word and an icon for state. Color is supplementary. Do not show fabricated percentage progress when the skill cannot report it.

## Visual direction

- Preserve the existing cool, translucent overlay surface and muted cyan accent.
- Give the parent skill a clear title and status; use smaller, quieter text for tool steps and timing.
- Keep the parent card close to the current tool row height while collapsed. Expand details in place so the conversation does not jump to a separate panel.
- Reserve monospace text for raw arguments or output in the expanded view. Use normal UI text for summaries.
- Make the entire summary row keyboard-operable, expose expanded state to assistive technology, and keep visible focus styling.

## Why this is clearer

The current pattern makes the underlying tool name and a clipped command the main signal. Grouping steps under a skill gives users a stable label for the capability, while the concise outcome and optional destination explain what they gained. The details remain available for trust and debugging without making every run feel technical.

## Scope for the implementation phase

1. Add the skill run presentation and expanded step list to conversation rendering.
2. Add a searchable Skills section to the existing composer menu and a removable next-prompt chip.
3. Map existing start, complete, error, duration, and result events into the states above. Keep unsupported actions hidden instead of displaying dead controls.

No production UI has been changed yet; this is the design proposal for review before implementation.
