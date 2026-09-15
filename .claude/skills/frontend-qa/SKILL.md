---
name: frontend-qa
description: Review ALSHAYEB frontend implementation for responsive behavior, regressions, usability, motion and integration issues.
---

# ALSHAYEB Frontend QA

Use after implementing or modifying frontend work.

Check:

- desktop
- tablet
- mobile
- overflow
- layout shifts
- broken scroll
- horizontal scroll leaks
- form usability
- loading states
- error states
- empty states
- image upload
- API failures
- disabled states
- keyboard accessibility
- prefers-reduced-motion
- animation cleanup
- navigation regressions

For GSAP / ScrollTrigger work verify:

- triggers are not duplicated
- resize does not break the timeline
- component unmount cleans triggers
- fast scrolling does not leave elements in broken states
- refresh restores correct measurements
- mobile does not inherit inappropriate desktop pinning

Do not declare a task complete only because the code compiles.