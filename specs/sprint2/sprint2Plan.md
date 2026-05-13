# MVP

## Tasks

### CI/CD

One person will create the linter errors, build process, and format checkers that run once there is a push.

### Database

One person will set up a database where they create initial schema tables and define the relationships

- table?
  -users
  -projects
  -project_members
  -tasks
  -checkins
  -blockers
- add in a few mock data points

### Login + Signup

2 people will create the log in and sign up page, that leads them into choosing a project sturcture (scrum ...), naming the project, and adding team members.

### Dashboard + Sidebar

1 frontend person will create the overall look of a page (including side bar and a blank space in the middle for the dashboard to go)
3 frontend & 3 Backend

- make sure to include a place to add tasks (task status, person assigned to task, task details)
- for the task status - if it is a blocker or not will be an API call that checks the database to see on a regular bases have that set up even if database is empty.
- make sure to include a place to have the past two days worth of check-ins present on the dashboard (this allows everyone to see how people are doing). For now the actual check-in input doesn't need to be there, just the UI off it and the route set up to call the data from the database.

### Check-In + Blockers

2 people will create a page where members can put in their updates. This includes what they have done, what they need to do, blockers.
For the blockers they will be able to assign the blockers to a specfic task that has been created, and if there is no specfic task then it will go to general. Also they can add someone who should be notified that could help them for that blocker.

## Timeline

Tuesday Night - All issues are created on github
Wednesday Night - CI/CD Pipeline for errors is set up
Friday Night - Each features is halfway done
Sunday Night - All features are compelete that are mentioned above, and the remaining task is to combine the API calls during the next sprint
