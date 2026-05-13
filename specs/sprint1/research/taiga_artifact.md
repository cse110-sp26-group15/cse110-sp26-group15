# Taiga UX/UI

## Homepage

- Features a description of the website with clickable buttons to Log in or Sign up.
- Advertises the website with quotes from notable companies about its effectiveness.
- Gives overviews of website benefits to projects/companies.
- Gives lists of website features with links to an FAQ page where you can learn more.
- Has clickable tabs which take you to the features section, to a pricing page that details different subscription plans, to an about page that talks about the project development, and to the FAQ page.
- Bottom of home page has help links, social links, and legal links like terms and conditions and privacy policy.

## Sign Up

- Has spaces for you to input a username, your full name, a password, and your email.
- Checks if the email is valid and the password meets requirements.
- Creates default profile picture with the new account.
- All changes made on the website will be saved to your account.

## Projects Dashboard

- Upon logging in or signing up the project dashboard is loaded which shows projects you are working on and stories, tasks, or issues you are watching.
- If nothing is in these sections there's helpful tasks for how you can get things in these sections.
- Clickable button to go to manage projects.
- No matter what page of the website you are on there is a bar at the top of the screen with a Projects, Discover, Help, Events, and Profile button. Each of these tells you what they are when you hover over them.

## My Projects

- Clicking the Projects button at the top of the screen takes you to the My Projects page.
- Shows all of the projects you've created with the privacy setting and description.
- Allows you to click and drag projects up or down to order them by priority, top projects will appear when hovering over the Projects button.
- Has a New Project button to create a new project.
- Hovering over the Projects button at the top of the screen will show a list of your projects, clicking on one will take you to the Projects page. It will also show a New Project button which if you click on will take you to the Create Project page.

## Create Project

- There are four options for creating a project, Scrum, Kanban, Duplicate Project, and Import Project with short descriptions for each. Clicking any will take you to a page for it.
- For Scrum and Kanban you must set the project name and description and decide whether its a public or private project.
- For Duplicate Project you must set the project name and description, decide whether its a public or private project, and choose which project you want to duplicate.
- For Import Project it gives you a list of options that you can import your project from, Taiga, Jira, Github, Trello, or Asana.
- On any of these pages pressing the Create Project button will take you to the Projects page.

## Projects

This website features two agile methodologies, Kanban and Scrum, that you can choose between when you create a new project.

- The Projects page has a description of the project, a like button that allows you to like or unlike a project and shows the number of people that have liked this project, a watching button that allows you to change your watching notifications or to watch/unwatch a project and shows the number of people watching this project, and an email button to contact the team. Each of these buttons tell you what they do if you hover over them.
- There is a sidebar with a Search, Team, and Settings tab. If it's a Scrum project there will also be a Scrum, Wiki, and Issues tab, if it's a Kanban project there will be a Kanban tab instead. There's an option to collapse the sidebar, tabs are still clickable when collapsed.
- The **Search** tab lets you type your query in a search box and when you press the Search button it will search Epics, User Stories, Issues, Tasks, and Wiki Pages for your query, showing any matches under those categories.
- The **Settings** tab contains a vertical list of tabs:
  - _Project_: Has its own vertical list of tabs; Project Details, Presets, Modules, Export, and Reports.
    - Project Details lets you change the project name, description, logo picture, and privacy. You can toggle whether the project is looking for people and if you want to receieve feedback from Taiga users. It tells you who the project owner is, and allows you to delete the project. A save button saves all changes.
    - Presets lets you change the default values for Epic status, User story status, Points, Task status, Issue type, Issue status, Priority, and Severity
    - Modules lets you toggle whether Epics, Scrum, Kanban, Issues, Wiki, and Meet Up are on or off. Turning on Epics and Kanban will add a tab for them in the sidebar. Turning off Issues and Wiki will remove the tabs for them in the sidebar.
    - Export has an Export button that lets you export your project to save a backup.
    - Reports lets you generate a url for Epic Reports, User Stories Reports, Tasks Reports, and Issues Reports. You can download the CSV or copy the link for each to easily edit project data.
  - _Attributes_: Has its own vertical list of tabs; Statuses, Points, Priorities, Severities, Custom Fields, Tags, and Due Dates.
    - The Statuses tab lets you add or delete statuses for epics, user stories, tasks, and issues. When adding a new status you can set the name and color of it.
    - The Points tab lets you add more points names and values for use in your user sories.
    - The Priorities tab lets you add or delete priorities for the issues. You can set the color and name when creating one.
    - The Severities tab lets you add or delete severities for the issues. You can set the color and name when creating one.
    - The Types tab lets you add or delete types for the issues. You can set the color and name when creating one.
    - The Custom Fields tab allows you to create custom fields for epics, user stories, tasks, and issues. You can set the name, description, and type for each.
    - The Tags tab lets you create tags. You can set the color and name when creating them.
    - The Due Dates tab lets you create or delete due date statuses of user stories, tasks, and issues. When creating a new status you can set the name, color, days to due date, and whether the status is before or after.
  - _Members_: Allows you to manage members by adding or deleting a new member or changing their role. You add members by inviting them via email with a chosen role and optional message.
  - _Permissions_: Has its own vertical list of tabs; UX, Design, Front, Back, Product Owner, Stakeholder, and External User. Each of these is a role someone can be assigned. You can add or delete roles, change their names and toggle whether the role is involved in estimating user story points. For each role you can toggle whether they can view, add, modify, comment, or delete Epics, User Stories, Tasks, Issues, and Wiki pages and links, and view, add, modify, or delete Sprints.
  - _Integrations_: Has its own vertical list of tabs; Webhooks, Github, Gitlab, Bitbucket, and Gogs.
    - The Webhooks tab lets you add or delete web links. When creating a webhook you add a name and a link.
    - The Github tab lets you create a secret key and add the project github url. A copy button copies the url, and a save button saves all changes.
    - The Gitlab tab lets you create a secret key and add the project gitlab url and valid source IPs. A copy button copies the url, and a save button saves all changes.
    - The Bitbucket tab lets you create a secret key and add the project bitbucket url and valid source IPs. A copy button copies the url, and a save button saves all changes.
    - The Gogs tab lets you create a secret key and add the project gogs url. A copy button copies the url, and a save button saves all changes.
  - _Plugins_: Has one tab, Slack. Provides space for a Slack webhook url, and webhook channel. Allows you to toggle notifications for when Epics, User Stories, Tasks, Issues, Wiki, are created, changed or deleted. A save button saves all changes.

### Scrum

- The **Wiki** tab allows you to add or delete bookmark titles, in each bookmark tab there's a markdown style text box, a description of who made the last modification with a date and time and the number of edits made, and a section where you can add or drop attachements.
- The **Team** tab has a list of the team members' names, each can be clicked on to open up their profile. There is a search option that allows you to search the list of names. The profiles contain the member's name, profile picture, project role, and stats such as number of closed issues, closed tasks, resported issues, and a number of points.
- The **Issues** tab lets you create new issues. Pressing the New Issue button opens a pop up menu with a space to write the issue subject, add a tag and description, add or drop an attachment, choose who to assign the issue to, choose the type - bug, question, or enhancement, choose the severity - wishlist, minor, normal, important, or critical, choose the priority - low, normal, or high, pick the date from a calendar, block the issue, and choose the status - new, in progress, ready for test, closed, needs info, rejected, or postoned. The create button will add the new issue to the issues tab. The issues appear as a bar with color indicators for the type, severity, and priority, the issue number, the issue name, status, last date modified, and who it's assigned to. There's an option to toggle tags, and filter by including or excluding specific types, priorities, statuses, who its assigned to, roles, and/or who its created by. A search bar lets you search for specific issues. There are up and down arrows next to keywords that allow you to put issues in increasing or decreasing order based on Type, Severity, Priority, Issue, Status, Date Modified, and person Assigned to. Clicking on a created issue lets you change the initial settings but also add assigned people and watchers, promote it to user story, attach the issue to a sprint, or delete the issue.
- The **Scrum** tab has three main sections: Sprints, Backlog, and Scrum.
  - In the _Sprints_ section there's a button to add a Sprint, clicking it opens a menu that allows you to set the Sprint name and choose the start and end date, the save button will create the sprint. It will then be listed in the Sprints section with its name, dates, how many tasks have been closed, how many total tasks, and with a Sprint Taskboard button.
  - The _Backlog_ section has an add user story button that opens a pop up menu. You can add a subject, tags, a description, drop attachments, choose a status - new, ready, in progress, ready for test, done, and archived, choose to put the user story at the top or bottom, choose who to assign the user story to, assign point values to UX, Design, Front, and Back, choose whether the user story is a team requirement and/or client requirement, choose a due date, and choose whether to block it. The create button adds the user story to the backlog section respresented by its name, status, and points. The Backlog sections shows how many user stories there are, has a search bar to search the user stories, a toggle for turning on or off tags, and an option to filter by including or excluding specific statuses, who its assigned to, roles, epics and/or who its created by. Each user story has a checkbox that when checked gives the option to move the story to the current sprint.
  - The _Scrum_ section has a graph representing project points over the project timeline with an optimal project point line and a completion percentage. Tasks and Stories have three dot menus that allow you to edit the card, assign it, delete it, or move it to the top.
  - _Sprint Taskboard_: Has a progress bar with a completion percentage, total points, completed points, open tasks, and closed tasks. Any user stories added to the sprint will appear here under their status column, in the user story row. There is also a button to add a storyless task. This opens a pop up menu where you can set the name, description, status, who its assigned to, date, whether its blocked, and can drop attachments. The create button adds this task to the Sprint Taskboard under its set status column and in the task row. Both storyless tasks and user stories appear as card with their name, who they're assigned to, and a 3 dot menu that allows you to edit the card, assign it, delete it, or move it to the top. There are zoom options for the taskboard that compress or expand the tasks under their statuses with options of Compact, Default, Detailed, and Expanded. At the bottom of the Sprint Taskboard there's a list of associated issues and an option to create new ones.

### Kanban

- The **Team** tab has a list of the team members' names, each can be clicked on to open up their profile. There is a search option that allows you to search the list of names. The profiles contain the member's name, profile picture, project role, and stats such as number of tasks closed, and total points.
- The **Kanban** tab has a similar layout to the Sprint Taskboard with columns for different statuses. Each column has a plus button that triggers a pop up menu where you can add a new user story. These are the same format as Scrum user stories so see the Backlog section under the Scrum tab for details. User stories appear as card in the column it was created in with their name, who they're assigned to, and a 3 dot menu that allows you to edit the card, assign it, or delete it. There is a search bar to search the user stories and an option to filter by including or excluding who its assigned to, roles, epics and/or who its created by. There are zoom options for the Kanban board that compress or expand the user stories under their statuses with options of Compact, Default, Detailed, and Expanded. There is also a button in each column that will collapse that column, showing only the status name and number of user stories in that column.

### Epics

- The **Epics** tab does not appear with either the Scrum or Kanban project style, it must be added from the Settings tab. It has an Add Epic button that when pressed opens a pop up menu where you can set the color, subject, status, and description of the Epic. You can add tags and add or drop attachments, and choose whether the Epic is a team requirement, a client requirement, and/or blocked, with a text box appearing if you choose blocked to provide an explanation for why. Pressing the Create Epic button will add the Epic to the Epics tab, appearing with its name, status, progress, color, and who its assigned to. When there are multiple Epics you can click and drag them up or down to order them. Clicking on the Epic name lets you edit the Epic, changing the color associated with it, changing its status, adding tags, related user stories, attachments, a markdown style description, comments, people assigned to it, and watchers, and changing whether its a team requirement, a client requirement, or blocked. You can also delete the Epic from this menu.

## Profile

When hovering over profile there is a drop down menu with a clickable logout button which immediately logs you out and takes you to the website home page. There are also clickable options of Edit Profile, Paid Plans, Account Settings, and Notifications which open up a menu with different tabs:

- The **User Settings** tab allows the user to change the language, theme, bio, username, full name, profile photo, and to verify their email which sends an email to their inbox. There's a save button to save profile settings.
- The **Change Password** tab asks for your current password, new password, and to retype the new password. The save button will change your password if all information is correct.
- The **Email Notifications** tab allows you to change your email notification settings. You can check receive all, only involved (for only projects/tasks you’re involved in), or no notifications sent to your email.
- The **Desktop Notifications** tab allows you to change your desktop notification settings. They use browser alerts. You can check receive all, only involved (for only projects/tasks you’re involved in), or no notifications.
- The **Events** tab allows you to turn on or off notifications for specific events like mentions, updates, etc. on each project that you are a part of
- The **Paid Plans** tab lets you know your limit of free projects (one private and one public) and how much of that you are using so far. If you have a paid plan will tell you information about your plan. It has a link to a separate plan and billing page and a link to the FAQ page.

Pop up text boxes let you know when changes have been successfully made.

## Design

- The website sticks to a black, white, gray, and blue color scheme with two main shades of blue for text and icons.
- The website is bright with a straightforward, more plain look that makes it easy to understand and not overwhelming to look at
- One font is used for all text and icons match style.
- Colors outside of the color scheme are used for indicators for visualizing status of project elements.
- Default images are assigned to your profile and to each project to visually differentiate them.
- Nearly the entire webpage fits the screen of your device, no scrolling necessary.

---

**Takeaways**: It would make the most sense to pick one project style to implement. Focus on the features of that project style and creating a clear visual organization for them (likely by status). Make sure that each element can be added, edited, and deleted. People should be able to be added to the project, and assigned to specific tasks.
