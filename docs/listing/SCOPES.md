# Scope justifications

| Scope | Why Roadworthy needs it |
|---|---|
| `read:jira-work` | Read requests (status, transitions, fields) and site info for links. |
| `write:jira-work` | Set priority, due date, labels and description on recall requests, add internal notes, move them to In progress / Done, delete sample requests when an admin removes the sample fleet. |
| `read:jira-user` | Check whether the signed-in user is a Jira admin (settings, sample data) and show who acted in the audit trail. |
| `storage:app` | Forge KVS: vehicle mirror, NHTSA cache, remediation records, settings. |
| `read:servicedesk-request` / `write:servicedesk-request` | List service projects and request types; raise one JSM request per recall and vehicle. |
| `read:servicemanagement-insight-objects` | Find the site's Assets workspace id (`/rest/servicedeskapi/assets/workspace`). |
| `read:cmdb-schema:jira` / `write:cmdb-schema:jira` | Find or create the "Fleet" object schema. |
| `read:cmdb-type:jira` / `write:cmdb-type:jira` | Find or create the "Vehicle" object type. |
| `read:cmdb-attribute:jira` / `write:cmdb-attribute:jira` | Read and add the Vehicle attributes (VIN, Status, Equipment, ...). |
| `read:cmdb-object:jira` / `write:cmdb-object:jira` | Read vehicles; write decoded make/model/year, status, open-recall count and last check. |
| `delete:cmdb-object:jira` | Delete sample vehicles when an admin removes the sample fleet. |
| `read:cmdb-icon:jira` | Pick an icon for the Vehicle object type. |

Product: **Jira only** (Jira Service Management is part of Jira). No Confluence or other product modules.
