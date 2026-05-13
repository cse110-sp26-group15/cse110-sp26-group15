# Research

## Personas and User Stories

### Persona 1: Tech Intern

#### Brief Identity

Wayne is a 21 year old college student

#### Background and Goals

Wayne is a college student who got his first internship at a big tech company Boogle. He has practically no experience using any kind of team tracker application. He has no idea of how the different workflows work, and also has limited experience collaborating with another person in a group.

He is given a laptop and his team lead tells him to download a team tracker application. His goal is to leave a positive impact on the team so that he gets a return offer.

#### Painpoints

Wayne has very limited experience collaborating with other people in a professional environment. He is overwhelmed by the constant messages that are sent to him on a daily basis. He also doesn't know how often to submit task updates.

**User Story 1**

As a tech intern, I want a way to filter messages based on urgency and project relevance, so that I can focus on my coding tasks without feeling like I’m missing a critical update

**User Story 2**

As a tech intern, I want a step-by-step walkthrough of the team tracker’s specific Boogle configuration, so that I don't feel incompetent or behind on my first day

**User Story 3**

As a tech intern, I want my contributions to be tracked, so that I can show my manager I am contributing to the team even when I haven't finished a major task

### Persona 2: AI Native Startup SWE

#### Brief Identity

Alex is an software engineer for an up and coming AI-native startup

#### Background and Goals

Alex works in a highly technical environment where the team heavily follows modern AGILE methods. His team is looking for an app that can ensure seamless synchronization between human tasks and AI agent outputs to prevent blockers in the development pipeline.

Alex and his SWE peers need a way to track the SitRep of the entire team, including the status of automated agents, to keep everyone on track with the final architectural vision.

#### Painpoints

The team struggles to track whether AI agents or human teammates are currently blocked (and what the issue is), leading to opaque processes and inefficient sprint planning. They already use multiple technologies (Slack, Notion, GH), and are tired of having to repetitively create sync information across all of them. Furthermore, the team runs standups daily, they are unable to communicate info that comes up throughout the workday without having to wait for the next meeting.

**User Story 1**

As an AI Native SWE, I want to see a unified SitRep dashboard of both human and AI agent activities so that I can identify if an automated process is causing a blocker for my current task.

**User Story 2**

As an AI Native SWE, I want to log my daily check-ins and stressors directly through Slack so that the team knows when I need someone to cover for me without having to holding an extra meeting.

**User Story 3**

As an AI Native SWE, I want major technical decisions made by my AI agents to be automatically captured in a markdown ADR both for my own observability and for other/future developers.

### Persona 3: The Engineering Manager

#### Brief Identity

An Engineering Manager at a rapidly scaling SaaS company managing a hybrid workforce of software engineers and AI coding agents.

#### Background and Goals

The Engineering Manager leads a team of 8–12 engineers supported by multiple AI coding agents integrated directly into development workflows. In a fast-moving environment where delivery speed and reliability are equally important, they need constant visibility into both human and AI-generated work. They are highly outcome-driven and have little tolerance for ambiguity, making proactive observability a top priority. Their goal is to understand what everyone is working on in real time, detect blockers before they are reported, and ensure AI systems are not introducing silent failures, risky code, or architectural drift into production systems.

#### Pain Points

The Engineering Manager struggles with fragmented visibility across tools like Slack, GitHub, Jira, and AI agent dashboards. Engineers often communicate blockers too late, while AI-generated work can be difficult to audit and validate at scale. Traditional standups also fail to provide real-time awareness, leaving them without a reliable operational picture of the team throughout the workday.

**User Story 1**

As an Engineering Manager, I want to see a real-time breakdown of what each engineer and AI agent is actively working on so that I can understand team progress without asking for manual updates.

**User Story 2**

As an Engineering Manager, I want the platform to proactively detect blockers and stalled work so that I can intervene before issues impact sprint delivery timelines.

**User Story 3**

As an Engineering Manager, I want a complete trace of every AI agent action, including its reasoning and code changes, so that I can ensure risky or low-quality work does not silently enter production.
