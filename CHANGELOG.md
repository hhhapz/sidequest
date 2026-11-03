# Changelog

## 0.2.3 (2026-10-11)

- fix(questsearch): handle commas properly when searching
- fix(questsearch): preserve search types and terms when restoring searches
- fix(questsearch): recognize instructor surnames without autocomplete
- fix(questsearch): skip searches queued before the current search
- fix(questsearch): fetch fresh class details and add a refresh button
- fix(quest): validate search terms and class numbers before opening details
- fix(quest): decode form values and handle selected options properly
- fix(quest): read prerequisites after the enrollment requirements label
- fix(quest): distinguish connection failures from sign-in failures
- fix(background): keep relay searches in one tab and container
- fix(background): separate caches by container and private session
- fix(background): retain search limits across worker restarts
- fix(questtab): report sign-in from Quest iframes
- fix(options): apply settings to open pages without overwriting other settings
- fix(uwflow): use the selected term and reject ambiguous class numbers
- fix(uwflow): show failed requests and allow retries
- fix(uwflow): restore observers after rendering errors
- fix(uwflow): make the status button work with a keyboard
- fix(questpage): allow review retries and report clipboard failures
- chore(questpage): use system fonts
- chore(release): pin the manual Firefox submission tool to the CI version
- docs(sidequest): update request and release instructions
