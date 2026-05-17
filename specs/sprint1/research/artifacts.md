# Research

## Artificats

### Application 1 - steady

- Features:
  - Smart Check Ins:
    - Every day, teammates fill out a short form — what did you do, what are you planning, any blockers? What makes it work is that Steady automatically pulls in activity from tools like GitHub and Jira to pre-fill the form, so you're not starting from scratch every time. The whole thing is designed to take under 2 minutes.
  - Blocker Surfacing:
    - When someone flags a blocker, it gets surfaced prominently on the dashboard and the right people get notified. This is a UX decision we need to make intentionally — blockers should be loud and visible, not buried in a list of updates.
  - Team Dashboard:
    - The dashboard shows everyone's status in one place — who checked in, what they're working on, who's blocked. This is just as important as the check-in form itself. The whole point of collecting status is so the team can actually see it at a glance without having to ask around.
  - Echoes - AI Agent:
    - Echoes are configurable AI agents that answer questions about your team on a schedule. Things like "who's blocked right now?", "what did the team ship last week?", or "summarize what the design team worked on." Instead of a manager digging through Slack and GitHub to get context, an agent does it automatically.
  - Async-First Design:
    - Steady is built for teams across time zones — not everyone checks in at the same time, and the app handles that gracefully. Our team is probably all in the same time zone, but async design is still good practice. Someone might check in at 9am, someone else at midnight. The dashboard should still make sense either way

Takeaways from Steady:

- Keep check-ins fast. If it takes more than 2 minutes, participation drops.
- Blockers need to be loud, do not let them be drowned out.
- The dashboard is only useful if teammates can actually see other statuses easily.
- Design async from day one. Don't assume everyone is online at the same time.

### Application 2 - taiga

[Taiga Research](taiga_artifact.md)

### Application 3 - range

- Features:
  - Sign in asks if Range has access to edit calander
  - Has a create goal functionality, which you can assign to different people and update status
  - Report function: Shows how often the team used various flags within the app
  - Meetings: connects to calander, can create new events, and has various templates which the meeting can follow
  - A person can have multiple teams

**Takeaways**

- Have a functionality which shows status of each task, and who is assigned to it.
- Have it be able to connect to different applications which user uses like calander and github

### UI/UX

After researching modern productivity and collaboration applications such as Notion, Slack, Linear, Trello, Figma, and Duolingo, several common UI/UX patterns were identified:

- Minimal and uncluttered interfaces improve usability.
- Clear visual hierarchy helps users focus on important tasks.
- Real-time collaboration improves team productivity.
- Gamification and feedback systems increase engagement.
- Fast and responsive interactions create smoother user experiences.
- Consistent layouts and navigation reduce user confusion.
- Integrating multiple tools into one platform reduces workflow friction.
- Personalization and customization allow users to adapt the interface to their own workflow and preferences, improving overall user satisfaction.
- Accessibility features such as dark mode, keyboard shortcuts, and colorblind settings help create a more inclusive experience for a wider range of users.

### Different project types the app can handle

### Color Research

**Color Psychology**

- Blue is heavily associated with reliability and trust, they are commonly used in fintech and corporate apps
  - This color should be used to convey reliability and efficency in UI Elements
- Red is used for urgency, excitement, and danger. It is used in a lot of entertainment apps like Youtube, and Netflix
  - This used be used to signify to the user a type of danger or something urgent that needs to be addressed in the UI
- Green is associated with growth, health, and success. Its used in apps like spotify, and duolingo.
  - This color should be used to signify an achievement of some kind
- Yellow is associated with optimism, clarity, and attention. Its used in apps like snapchat
  - This is typically used for tips or warnings
- Black and white is typically associated with power and minimalism, its typically used to convey a premium feel. Companies like apple do this a lot
- You should use the 60-30-10 rule when distributing colors across your UI
  - 60% should be your primary color
    - This is the color that should be associated with your brand identity
    - This color should also be based on the color you want to evoke to the user
  - 30% should be your secondary color
    - This color should complement your primary color
    - Should be used for secondary elements
  - 10% should be your accent color
    - This is a high contrast color
    - Should be used for stuff like call to action buttons
- You can use semanic colors to instantly convey meanings to people
  - Green - success, confirmation
  - Red - error, warning, negative feedback
  - Yellow/Orange - caution, warning, pending action
  - Blue - informational links, primary actions
- What should you avoid
  - Don't use too many colors, try to keep a consistent color pallete
  - Low and unpleasant contrast
  - Not being consistent with color usage in UI elements
  - Trying to use every single color in color pallete for every feature
  - Don't use neon colors or heavy blacks
  - You shouldn't use purple for UI because it can get confused with links

### Task Card Research

**Features seen on Kanban Cards**

- Task Name
- Who is assigned to the task
- Attachements
- Comments
- Adding tags to cards to show what task the card is related to
- Due Date
- Priority

**Features seen on Scrum Cards**

- Task Name
- Who is assigned to the task
- Attaching tags to cards to show what the task the card is related to
- Due Date
- Priority
- User Story
- Story Points
- Sprint Label

**Features seen on XP Cards**

- Task Name
- Person 1 asigned
- Person 2 assigned
- Adding tags to cards to show what task the card is related to
- Due Date
- Priority
- Iteration
- Estimate in ideal developer hours
- Story card reference

**What are the most important visual elements?**

- Title: 1
- Priority: 2
- Category/Type: 5
- Who is assigned/: 3
- Status: 4
