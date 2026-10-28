---
title: Team members and roles
summary: What owners, operators and viewers can do, how to invite someone, and the rules that keep an account from losing its last owner.
category: account
order: 10
keywords:
  [
    team,
    roles,
    owner,
    operator,
    viewer,
    invite,
    invitation,
    member,
    permissions,
    assistant,
    remove,
    leave,
    organization,
    switch,
    access,
  ]
updated: 2026-10-28
related: [devices-and-registration, connect-google-drive, guest-privacy]
---

An account (an **organization**) can have as many members as you need. Each has one of three roles.

## The three roles

| What it lets you do                                     | Owner | Operator | Viewer |
| ------------------------------------------------------- | :---: | :------: | :----: |
| See events, galleries, assets and devices               |  Yes  |   Yes    |  Yes   |
| Export an event's gallery (ZIP)                         |  Yes  |   Yes    |  Yes   |
| Create, change and archive events                       |  Yes  |   Yes    |   No   |
| Run a booth, the Sharing Station and the setup check    |  Yes  |   Yes    |   No   |
| Upload and delete assets                                |  Yes  |   Yes    |   No   |
| Register and rename devices                             |  Yes  |   Yes    |   No   |
| See and delete guests' details; handle privacy requests |  Yes  |   Yes    |   No   |
| Delete an event                                         |  Yes  |    No    |   No   |
| Revoke a device                                         |  Yes  |    No    |   No   |
| Connect or disconnect Google Drive and Dropbox          |  Yes  |    No    |   No   |
| Invite and remove members, change roles                 |  Yes  |    No    |   No   |
| Export all the account's data, delete the account       |  Yes  |    No    |   No   |

In short: the **owner** has full control; an **operator** is an assistant who runs booths and manages events, devices and assets but can't change the team or connect clouds; a **viewer** can look but not change anything. A viewer sees how many guests left their details but not the details themselves.

The server checks the role on every action, so hiding a button is never the only protection.

## Invite someone {#invite}

Owners only. Open **Devices and team** in the Studio and choose the **Team** tab.

1. Under **Invite a member** enter their email address, choose a role and press **Send invitation**.
2. They get an email with a link that works for 7 days.
3. They open it, sign in with **that email address** (a different account is told so and offered **Sign out**) and press **Accept invitation**.

Under **Pending invitations** you can **Resend** or **Revoke** an invitation. A link that was used, cancelled, declined or has expired explains itself and tells the person to ask for a new one.

To stop the form being used to send unwanted email, there are limits: 30 invitations per hour from one account, 5 a day to one address and 60 an hour from one network. An address that is already on the team can't be invited again.

## Change roles, remove, leave

Owners can change a member's role from the **Members** list and **Remove** members; the person loses access to the account right away, and the events and files they created stay. Anyone can **Leave organization** from their own row, except in two cases:

- **The only owner.** An account always needs at least one owner. Make someone else an owner first. This also applies if you try to change your own role: you are asked to confirm that you'll lose the owner's rights, and another owner would have to give them back.
- **Your only organization.** Everyone belongs to at least one account; if this is yours and only yours, you can't leave it.

## Several accounts

A person can be a member of more than one organization, for example your own studio and a client's. When you belong to more than one, an **Organization** menu appears at the top of the Studio's side menu; choosing another one switches which you are working in and takes you back to the start of the Studio.

## Roles and booth devices

A booth device works through its own registration, not through the member who registered it: it keeps uploading even after that member signs out. To cut a device off, revoke it (owners). See [Register and manage booth devices](help:devices-and-registration).
