---
name: alshayeb-motion
description: Plan and implement premium scroll-driven animation and interaction for ALSHAYEB EXPERIENCE.
---

# ALSHAYEB EXPERIENCE — Motion Skill

Use this skill for animation, GSAP, ScrollTrigger, transitions, parallax and interactive motion.

## Motion Direction

Motion should feel:

- cinematic
- controlled
- physical
- smooth
- intentional
- premium

Never animate something just because it can move.

## Preferred Tools

For complex scroll-driven sequences:

- GSAP
- ScrollTrigger

For layout-to-layout card transformations, consider:

- GSAP Flip

Use CSS transitions for simple micro-interactions only.

Do not build complex scroll choreography with dozens of independent CSS animations.

## Experiences Journey

The signature homepage interaction is inspired by the interaction language of the UNVRS residencies section.

Do NOT copy the UNVRS visual design.

Desired sequence:

Hero composition
→ cards begin distributed around the hero
→ scroll transforms the same cards into an Experiences lineup
→ ALSHAYEB EXPERIENCES title reveals
→ section becomes pinned
→ continued vertical scrolling drives horizontal card movement
→ image layers may use subtle internal parallax
→ section releases
→ Enter Your Experience begins

Prefer reusing the same visual elements through the transition rather than visibly destroying and recreating cards.

## Architecture

Keep animation orchestration isolated from presentation components.

Prefer a dedicated hook or module such as:

useExperienceJourney()

or:

experienceJourneyMotion.js

Do not scatter ScrollTrigger logic through many components.

## Performance

Prefer transform and opacity.

Avoid layout thrashing.

Use will-change only where useful.

Clean up GSAP contexts and ScrollTriggers when components unmount.

Support:

prefers-reduced-motion

Never create an experience that requires animation to remain usable.

## Mobile

Do not automatically reproduce the exact desktop choreography on mobile.

Simplify motion when necessary while preserving the concept.