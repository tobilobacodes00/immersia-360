import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createEvent, e2eHeaders, open, signIn, uniqueEmail } from './helpers';

/**
 * Team members (ACC-3) and screen 21, "Devices and team": invite an assistant as operator or
 * viewer, the invitee's accept flow, read-only viewers, the last-owner rule, and switching between
 * organizations. Mail never leaves the machine: the app's dev mailbox is read through the e2e route.
 */

async function axeClean(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${label} ${v.id}: ${v.nodes.length}`)).toEqual([]);
}

/** The invitation email addressed to `to` (newer than `after`), and the invitation id in its link. */
async function invitationMail(page: Page, to: string, after = 0) {
  let mail: { subject: string; text: string; at: number } | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/test/mailbox?to=${encodeURIComponent(to)}`, { headers: e2eHeaders });
        if (!res.ok()) return false;
        const m = (await res.json()) as { subject: string; text: string; at: number };
        if (m.at <= after || !/\/invite\//.test(m.text)) return false;
        mail = m;
        return true;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const id = /\/invite\/([\w-]+)/.exec(mail!.text)![1]!;
  return { id, subject: mail!.subject, at: mail!.at };
}

/** Fill in the invite form on the team page and send. */
async function invite(page: Page, email: string, role: 'Operator' | 'Viewer' | 'Owner') {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption({ label: role });
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${email}.`)).toBeVisible();
}

const newPage = async (browser: Browser) => {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
};

/** An owner who is signed in, and a second account that has accepted their invitation. */
async function joinTeam(browser: Browser, owner: Page, email: string, role: 'Operator' | 'Viewer') {
  await open(owner, '/studio/devices/team');
  await invite(owner, email, role);
  const { id } = await invitationMail(owner, email);
  const guest = await newPage(browser);
  await signIn(guest.page, email, `/invite/${id}`);
  await guest.page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(guest.page).toHaveURL(/\/studio$/);
  return { ...guest, id };
}

test.describe('team (ACC-3, screen 21)', () => {
  test('an owner invites a viewer, who accepts and sees the studio read-only', async ({ browser }) => {
    test.setTimeout(180_000);
    const ownerSide = await newPage(browser);
    const owner = ownerSide.page;
    const contexts: BrowserContext[] = [ownerSide.context];
    try {
      const ownerEmail = await signIn(owner);
      const orgName = ownerEmail.split('@')[0]!;
      const eventId = await createEvent(owner, 'Team event');

      await test.step('the team section is part of "Devices and team"', async () => {
        await owner.getByRole('link', { name: 'Devices and team', exact: true }).click();
        await expect(owner.getByRole('heading', { level: 1, name: 'Devices and team' })).toBeVisible();
        await owner.getByRole('link', { name: 'Team', exact: true }).click();
        await expect(owner).toHaveURL(/\/studio\/devices\/team$/);
        const members = owner.getByRole('region', { name: 'Members' });
        await expect(members.getByRole('listitem')).toHaveCount(1);
        await expect(members.getByText('You', { exact: true })).toBeVisible();
        await expect(owner.getByText('No invitations waiting.')).toBeVisible();
      });

      const viewerEmail = uniqueEmail('viewer');
      const viewerSide = await newPage(browser);
      const viewer = viewerSide.page;
      contexts.push(viewerSide.context);
      let invitationId = '';

      await test.step('the owner invites a viewer; the email names the organization and links to the invitation', async () => {
        await invite(owner, viewerEmail, 'Viewer');
        const pending = owner.getByRole('listitem').filter({ hasText: viewerEmail });
        await expect(pending).toContainText('Viewer');
        await expect(pending).toContainText(/Expires in [67] days/);
        const mail = await invitationMail(owner, viewerEmail);
        invitationId = mail.id;
        expect(mail.subject).toBe(`Join ${orgName} on Immersia 360`);
        await axeClean(owner, 'team (owner, pending invitation)');
      });

      await test.step('a signed-out visitor goes to sign-in and comes back to the invitation', async () => {
        await viewer.goto(`/invite/${invitationId}`);
        await expect(viewer).toHaveURL(new RegExp(`/sign-in\\?next=%2Finvite%2F${invitationId}`));
        await expect(viewer.getByText('Sign in with the email address your invitation was sent to.')).toBeVisible();
        await signIn(viewer, viewerEmail, `/invite/${invitationId}`);
        await expect(viewer.getByRole('heading', { level: 1, name: `Join ${orgName}` })).toBeVisible();
        await expect(viewer.getByRole('main')).toContainText(`${ownerEmail} invited you to ${orgName} as Viewer.`);
        await expect(viewer.getByText('Read-only: sees events, galleries and devices')).toBeVisible();
        await axeClean(viewer, 'invitation');
      });

      await test.step('accepting lands in the studio of the inviting organization, as a viewer', async () => {
        await viewer.getByRole('button', { name: 'Accept invitation' }).click();
        await expect(viewer).toHaveURL(/\/studio$/);
        await expect(viewer.getByRole('heading', { level: 1, name: 'What are we running?' })).toBeVisible();
        await expect(viewer.getByText(orgName, { exact: true }).first()).toBeVisible();
        await expect(viewer.getByText('Viewer', { exact: true })).toBeVisible();
        await expect(viewer.getByRole('link', { name: /New event/ })).toHaveCount(0);
        // Two organizations now (their own, and this one): the switcher is there, on this one.
        const switcher = viewer.getByRole('combobox', { name: 'Organization' });
        await expect(switcher.locator('option:checked')).toHaveText(`${orgName} (Viewer)`);
      });

      await test.step('the viewer sees events but every control that changes something is off', async () => {
        await open(viewer, '/studio/events');
        await expect(viewer.getByRole('link', { name: 'Team event' })).toBeVisible();
        await expect(viewer.getByRole('link', { name: 'New event' })).toHaveCount(0);
        await open(viewer, `/studio/events/${eventId}/setup`);
        await expect(viewer.getByText('View only')).toBeVisible();
        await expect(viewer.getByRole('textbox', { name: 'Spin length' })).toBeDisabled();
        await open(viewer, '/studio/devices');
        await expect(viewer.getByRole('button', { name: 'Register device' })).toHaveCount(0);
      });

      await test.step('the viewer cannot reach a mutating page, route or API call', async () => {
        // A bookmarked "new event" page is a polite redirect with a note, not an error page.
        await viewer.goto('/studio/events/new');
        await expect(viewer).toHaveURL(/\/studio\?denied=1$/);
        await expect(viewer.getByText('Your role here is Viewer')).toBeVisible();
        // Connecting a cloud is the owner's.
        await viewer.goto('/api/integrations/drive/connect');
        await expect(viewer).toHaveURL(/\/studio\/integrations\?error=forbidden&provider=drive$/);
        await expect(
          viewer.getByRole('alert').filter({ hasText: 'Only the account owner can connect a cloud.' }),
        ).toBeVisible();

        // Straight at the auth API (what a script would do), no page involved.
        const origin = new URL(viewer.url()).origin;
        const owned = await owner.request.get('/api/auth/organization/get-active-member');
        const ownerMember = (await owned.json()) as { id: string; organizationId: string };
        const post = (path: string, data: object) =>
          viewer.request.post(`/api/auth/organization/${path}`, { data, headers: { origin } });
        const invited = await post('invite-member', { email: uniqueEmail('x'), role: 'viewer' });
        expect(invited.status()).toBe(403);
        const promoted = await post('update-member-role', {
          memberId: ownerMember.id,
          role: 'viewer',
          organizationId: ownerMember.organizationId,
        });
        expect(promoted.ok()).toBe(false);
        const removed = await post('remove-member', {
          memberIdOrEmail: ownerMember.id,
          organizationId: ownerMember.organizationId,
        });
        expect(removed.ok()).toBe(false);
      });

      await test.step('the viewer sees the team read-only, and may leave', async () => {
        await open(viewer, '/studio/devices/team');
        await expect(viewer.getByRole('heading', { level: 2, name: 'Members' })).toBeVisible();
        await expect(viewer.getByText('Only owners can change the team.')).toBeVisible();
        await expect(viewer.getByRole('heading', { name: 'Invite a member' })).toHaveCount(0);
        await expect(viewer.getByRole('heading', { name: 'Pending invitations' })).toHaveCount(0);
        await expect(viewer.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
        await expect(viewer.getByRole('combobox', { name: /^Role for/ })).toHaveCount(0);
        await expect(viewer.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
        const members = viewer.getByRole('region', { name: 'Members' });
        await expect(members.getByRole('listitem')).toHaveCount(2);
        await expect(members.getByRole('button', { name: 'Leave organization' })).toBeEnabled();
        await axeClean(viewer, 'team (viewer)');
      });

      await test.step('the owner makes the viewer an operator, who can then create events but still not manage the team', async () => {
        await open(owner, '/studio/devices/team');
        await expect(owner.getByText('No invitations waiting.')).toBeVisible();
        await owner.getByRole('combobox', { name: `Role for ${viewerEmail}` }).selectOption({ label: 'Operator' });
        await expect(owner.getByText(`${viewerEmail} is now Operator.`)).toBeVisible();

        await open(viewer, '/studio');
        await expect(viewer.getByText('Operator', { exact: true })).toBeVisible();
        await expect(viewer.getByRole('link', { name: /360 Booth/ })).toBeVisible();
        await open(viewer, '/studio/devices/team');
        await expect(viewer.getByText('Only owners can change the team.')).toBeVisible();
        await expect(viewer.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
      });

      await test.step('the only owner can neither step down, be removed, nor leave — in the UI or through the API', async () => {
        await open(owner, '/studio/devices/team');
        const ownerRow = owner.getByRole('listitem').filter({ hasText: ownerEmail });
        await expect(ownerRow.getByRole('button', { name: 'Leave organization' })).toBeDisabled();
        await expect(
          ownerRow.getByText("You're the only owner. Make someone else an owner before you leave."),
        ).toBeVisible();
        await expect(ownerRow.getByRole('combobox')).toHaveCount(0);

        const origin = new URL(owner.url()).origin;
        const me = (await (await owner.request.get('/api/auth/organization/get-active-member')).json()) as {
          id: string;
          organizationId: string;
        };
        const post = (path: string, data: object) =>
          owner.request.post(`/api/auth/organization/${path}`, { data, headers: { origin } });
        expect((await post('leave', { organizationId: me.organizationId })).status()).toBe(400);
        expect(
          (
            await post('update-member-role', { memberId: me.id, role: 'viewer', organizationId: me.organizationId })
          ).status(),
        ).toBe(400);
        expect(
          (await post('remove-member', { memberIdOrEmail: me.id, organizationId: me.organizationId })).status(),
        ).toBe(400);

        await owner.reload();
        await expect(ownerRow.getByText('Owner', { exact: true })).toBeVisible();
        await expect(owner.getByRole('region', { name: 'Members' }).getByRole('listitem')).toHaveCount(2);
      });

      await test.step('with a second owner, the first can step down — but not leave their only organization', async () => {
        await owner.getByRole('combobox', { name: `Role for ${viewerEmail}` }).selectOption({ label: 'Owner' });
        await expect(owner.getByText(`${viewerEmail} is now Owner.`)).toBeVisible();
        const ownerRow = owner.getByRole('listitem').filter({ hasText: ownerEmail });
        await expect(ownerRow.getByRole('combobox', { name: `Role for ${ownerEmail}` })).toBeVisible();
        await expect(ownerRow.getByRole('button', { name: 'Leave organization' })).toBeDisabled();
        await expect(ownerRow.getByText("This is your only organization, so you can't leave it.")).toBeVisible();

        await open(viewer, '/studio/devices/team');
        await expect(viewer.getByRole('button', { name: 'Send invitation' })).toBeVisible();
        await axeClean(viewer, 'team (owner)');
      });
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test('an owner can resend and revoke invitations; a cancelled or misdirected link explains itself', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const ownerSide = await newPage(browser);
    const owner = ownerSide.page;
    const contexts: BrowserContext[] = [ownerSide.context];
    try {
      await signIn(owner);
      await open(owner, '/studio/devices/team');
      const first = uniqueEmail('first');
      const second = uniqueEmail('second');

      await invite(owner, first, 'Operator');
      const sent = await invitationMail(owner, first);
      await invite(owner, second, 'Viewer');
      const secondMail = await invitationMail(owner, second);

      await test.step('resending keeps the same link and sends the email again', async () => {
        await owner.getByRole('button', { name: `Resend the invitation to ${first}` }).click();
        await expect(owner.getByText(`Invitation sent again to ${first}.`)).toBeVisible();
        const again = await invitationMail(owner, first, sent.at);
        expect(again.id).toBe(sent.id);
      });

      await test.step('revoking removes it from the list, and its link says it was cancelled', async () => {
        await owner.getByRole('button', { name: `Revoke the invitation to ${first}` }).click();
        await expect(owner.getByText(`Invitation to ${first} revoked.`)).toBeVisible();
        await expect(owner.getByRole('listitem').filter({ hasText: first })).toHaveCount(0);
        await expect(owner.getByRole('listitem').filter({ hasText: second })).toBeVisible();

        const invitee = await newPage(browser);
        contexts.push(invitee.context);
        await signIn(invitee.page, first, `/invite/${sent.id}`);
        await expect(
          invitee.page.getByRole('heading', { level: 1, name: 'This invitation was cancelled' }),
        ).toBeVisible();
        await expect(invitee.page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
        await axeClean(invitee.page, 'invitation (cancelled)');
      });

      await test.step('a link opened by the wrong account says so without naming the organization, and offers to sign out', async () => {
        const stranger = await newPage(browser);
        contexts.push(stranger.context);
        const strangerEmail = await signIn(stranger.page);
        await stranger.page.goto(`/invite/${secondMail.id}`);
        await expect(
          stranger.page.getByRole('heading', { level: 1, name: 'This invitation is for a different account' }),
        ).toBeVisible();
        await expect(stranger.page.getByRole('main')).toContainText(`${second[0]}***@example.com`);
        await expect(stranger.page.getByRole('main')).toContainText(`you're signed in as ${strangerEmail}`);
        await expect(stranger.page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
        await axeClean(stranger.page, 'invitation (wrong account)');

        await stranger.page.getByRole('button', { name: 'Sign out' }).click();
        await expect(stranger.page).toHaveURL(new RegExp(`/sign-in\\?next=%2Finvite%2F${secondMail.id}`));
      });

      await test.step('an unknown invitation is a clear page, not an error', async () => {
        const visitor = await newPage(browser);
        contexts.push(visitor.context);
        await signIn(visitor.page);
        await visitor.page.goto('/invite/0000000000000000000000000000dead');
        await expect(
          visitor.page.getByRole('heading', { level: 1, name: "We can't find this invitation" }),
        ).toBeVisible();
      });
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test('a member of two organizations switches between them, and each one shows only its own events', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const ownerSide = await newPage(browser);
    const owner = ownerSide.page;
    const contexts: BrowserContext[] = [ownerSide.context];
    try {
      const ownerEmail = await signIn(owner);
      const sharedOrg = ownerEmail.split('@')[0]!;
      await createEvent(owner, 'Shared event');

      const memberEmail = uniqueEmail('member');
      const joined = await joinTeam(browser, owner, memberEmail, 'Operator');
      contexts.push(joined.context);
      const member = joined.page;
      const ownOrg = memberEmail.split('@')[0]!;
      const switcher = member.getByRole('combobox', { name: 'Organization' });

      await open(member, '/studio/events');
      await expect(member.getByRole('link', { name: 'Shared event' })).toBeVisible();

      await test.step('switching to their own organization makes them its owner, with their own (empty) events', async () => {
        await switcher.selectOption({ label: `${ownOrg} (Owner)` });
        await expect(member).toHaveURL(/\/studio$/);
        await expect(switcher.locator('option:checked')).toHaveText(`${ownOrg} (Owner)`);
        await expect(member.getByText('Owner', { exact: true })).toBeVisible();
        await createEvent(member, 'Mine');
        await open(member, '/studio/events');
        await expect(member.getByRole('link', { name: 'Mine' })).toBeVisible();
        await expect(member.getByRole('link', { name: 'Shared event' })).toHaveCount(0);
      });

      await test.step('switching back shows the shared organization again, and the choice survives a reload', async () => {
        await switcher.selectOption({ label: `${sharedOrg} (Operator)` });
        await expect(member).toHaveURL(/\/studio$/);
        await open(member, '/studio/events');
        await expect(member.getByRole('link', { name: 'Shared event' })).toBeVisible();
        await expect(member.getByRole('link', { name: 'Mine' })).toHaveCount(0);
        await member.reload();
        await expect(switcher.locator('option:checked')).toHaveText(`${sharedOrg} (Operator)`);
        await axeClean(member, 'events with the organization switcher');
      });

      await test.step('leaving the shared organization lands them in their own', async () => {
        await open(member, '/studio/devices/team');
        await member.getByRole('button', { name: 'Leave organization' }).click();
        await member.getByRole('dialog').getByRole('button', { name: 'Leave organization' }).click();
        await expect(member).toHaveURL(/\/studio$/);
        await expect(member.getByText('Owner', { exact: true })).toBeVisible();
        // One organization left: no switcher.
        await expect(member.getByRole('combobox', { name: 'Organization' })).toHaveCount(0);
        await open(member, '/studio/events');
        await expect(member.getByRole('link', { name: 'Shared event' })).toHaveCount(0);
        // And the owner's team is down to one.
        await open(owner, '/studio/devices/team');
        await expect(owner.getByRole('region', { name: 'Members' }).getByRole('listitem')).toHaveCount(1);
      });
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });
});
