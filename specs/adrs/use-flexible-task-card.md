# ADR: Use a Shared Task Card Component Across Project Types

## Context and Problem Statement

Our application supports multiple project management methodologies: Kanban, Scrum, and XP, each of which displays different kinds of task information. We need to decide how to build the task card component that works across all three types, while also minimizing the amount of work we need to do in order to connect to the backend.

## Decision Drivers

- Must be able to be used across three product management methodologies
- Should minimize duplicate code and components
- Must be easy to connect to a single backend schema
- Should keep the UI consistent across views

## Considered Options

- One shared card component with conditional fields per project type
- Separate card components for each methodology
- One card that displays all fields regardless of project type

## Decision Outcome

Chosen option: "One shared card component with conditonal fields per project type", because all three product management methodologies all share a lot of things in common of which they would need to display on each card. They only differ by like 2-3 extra fields. Having seperate components for every project type would require duplicating a lot of the code, and require maintaining three seperate backend connections. Showing all of the fields at once would clutter the UI with irrelvant information depending on the project type.

### Consequences

- Good, because it keeps the codebase simpler with only one component to maintain
- Good, because it maps to a single backend data model instead of three
- Good, because it ensures visual consistency across all project types
- Bad, because conditional rendering logic adds some complexity to the component
- Bad, because adding a new methodology in the future means modifying the shared component rather than creating an independent one
