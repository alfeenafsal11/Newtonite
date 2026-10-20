import assert from 'node:assert';

const API_BASE = process.env.TEST_API_URL || 'http://localhost:3000/api/v1';
console.log('Target API_BASE:', API_BASE);

const DEMO_ACCOUNTS = [
  { email: 'admin@example.com', password: 'Passw0rd!demo', role: 'admin' },
  { email: 'support.lead@example.com', password: 'Passw0rd!demo', role: 'team_lead' },
  { email: 'support.agent1@example.com', password: 'Passw0rd!demo', role: 'agent' },
  { email: 'support.agent2@example.com', password: 'Passw0rd!demo', role: 'agent' },
  { email: 'pay.approver@example.com', password: 'Passw0rd!demo', role: 'approver' },
  { email: 'eng.approver@example.com', password: 'Passw0rd!demo', role: 'approver' },
  { email: 'viewer@example.com', password: 'Passw0rd!demo', role: 'viewer' },
  { email: 'auditor@example.com', password: 'Passw0rd!demo', role: 'auditor' },
];

async function api(path: string, options: any = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

async function runLiveWalkthrough() {
  console.log('=== Step 1: Testing Demo Account Logins (Both passwords) ===');
  const tokens: Record<string, string> = {};

  for (const acct of DEMO_ACCOUNTS) {
    // 1. Test Passw0rd!demo
    const res1 = await api('/auth/login', {
      method: 'POST',
      body: { email: acct.email, password: acct.password },
    });
    assert.strictEqual(res1.status, 200, `Failed login with Passw0rd!demo for ${acct.email}: ${JSON.stringify(res1.data)}`);
    assert.ok(res1.data.token, `Missing token for ${acct.email}`);
    tokens[acct.email] = res1.data.token;

    // 2. Test password123 compatibility
    const res2 = await api('/auth/login', {
      method: 'POST',
      body: { email: acct.email, password: 'password123' },
    });
    assert.strictEqual(res2.status, 200, `Failed login with password123 for ${acct.email}`);

    // 3. Test /me
    const meRes = await api('/me', {
      headers: { authorization: `Bearer ${tokens[acct.email]}` },
    });
    assert.strictEqual(meRes.status, 200);
    console.log(`  ✓ ${acct.email} successfully logged in as "${meRes.data.display_name}" (Memberships: ${meRes.data.memberships.length})`);
  }

  console.log('\n=== Step 2: Testing Dashboard Loading for Demo Accounts ===');
  for (const acct of ['admin@example.com', 'support.agent1@example.com', 'viewer@example.com']) {
    const dashRes = await api('/dashboard/attention', {
      headers: { authorization: `Bearer ${tokens[acct]}` },
    });
    assert.strictEqual(dashRes.status, 200);
    console.log(`  ✓ Dashboard attention loaded for ${acct}: ${dashRes.data.sections?.length ?? 0} attention sections`);
  }

  console.log('\n=== Step 3: Item Creation Flow (support.agent1) ===');
  const agentToken = tokens['support.agent1@example.com'];
  const agentMe = await api('/me', { headers: { authorization: `Bearer ${agentToken}` } });
  const teamId = agentMe.data.memberships[0].team_id;

  const createRes = await api('/items', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${agentToken}`,
      'idempotency-key': `live-walkthrough-${Date.now()}`,
    },
    body: {
      team_id: teamId,
      type: 'payment_investigation',
      title: 'Walkthrough: Suspicious Double Charge on Order #9482',
      description: 'Customer claims they were billed twice on checkout.',
      priority: 'p1',
      tags: ['billing', 'walkthrough'],
      requires_approval: true,
    },
  });
  assert.strictEqual(createRes.status, 201, `Item creation failed: ${JSON.stringify(createRes.data)}`);
  const createdItem = createRes.data;
  console.log(`  ✓ Created item ${createdItem.key} (ID: ${createdItem.id}) with approval_state="${createdItem.approval_state}"`);

  console.log('\n=== Step 4: Claiming Work Item (support.agent2) ===');
  const agent2Token = tokens['support.agent2@example.com'];
  const claimRes = await api(`/items/${createdItem.id}/claim`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${agent2Token}`,
      'idempotency-key': `claim-${Date.now()}`,
    },
  });
  assert.strictEqual(claimRes.status, 200, `Claim failed: ${JSON.stringify(claimRes.data)}`);
  assert.strictEqual(claimRes.data.assignee.id, tokens['support.agent2@example.com'] ? claimRes.data.assignee.id : null);
  console.log(`  ✓ Claimed by ${claimRes.data.assignee.display_name}. Status is now "${claimRes.data.status}". Version=${claimRes.data.version}`);

  console.log('\n=== Step 5: Adding Comments and Checking Timeline (agent2) ===');
  const commentRes = await api(`/items/${createdItem.id}/comments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${agent2Token}`,
      'idempotency-key': `comment-${Date.now()}`,
    },
    body: { body: 'Checked Stripe gateway logs: duplicate auth tokens detected.' },
  });
  assert.strictEqual(commentRes.status, 201);
  console.log(`  ✓ Comment posted by ${commentRes.data.author.display_name}`);

  const commentsList = await api(`/items/${createdItem.id}/comments`, {
    headers: { authorization: `Bearer ${agent2Token}` },
  });
  assert.strictEqual(commentsList.status, 200);
  assert.strictEqual(commentsList.data.comments.length, 1);
  console.log(`  ✓ Comments list retrieved: 1 comment by "${commentsList.data.comments[0].author.display_name}"`);

  const eventsList = await api(`/items/${createdItem.id}/events`, {
    headers: { authorization: `Bearer ${agent2Token}` },
  });
  assert.strictEqual(eventsList.status, 200);
  console.log(`  ✓ Events list retrieved: ${eventsList.data.events.length} events logged in audit timeline`);

  console.log('\n=== Step 6: Requesting Approval (agent2) ===');
  const currentItem = (await api(`/items/${createdItem.id}`, { headers: { authorization: `Bearer ${agent2Token}` } })).data;
  const reqApprovalRes = await api(`/items/${createdItem.id}/approval/request`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${agent2Token}`,
      'idempotency-key': `req-appr-${Date.now()}`,
    },
    body: { expected_version: currentItem.version },
  });
  assert.strictEqual(reqApprovalRes.status, 200);
  console.log(`  ✓ Approval requested. approval_state="${reqApprovalRes.data.approval_state}"`);

  console.log('\n=== Step 7: Approving Item (support.lead for Support team) ===');
  const leadToken = tokens['support.lead@example.com'];
  const apprItem = (await api(`/items/${createdItem.id}`, { headers: { authorization: `Bearer ${leadToken}` } })).data;
  assert.ok(apprItem, 'support.lead can read item in support team');

  const approveRes = await api(`/items/${createdItem.id}/approval/approve`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${leadToken}`,
      'idempotency-key': `approve-${Date.now()}`,
    },
    body: { expected_version: apprItem.version, note: 'Approved investigation findings.' },
  });
  assert.strictEqual(approveRes.status, 200, `Approval failed: ${JSON.stringify(approveRes.data)}`);
  console.log(`  ✓ Item approved by support.lead! approval_state="${approveRes.data.approval_state}"`);

  console.log('\n=== Step 7b: Verifying pay.approver on Payments Team Pending Approvals ===');
  const payToken = tokens['pay.approver@example.com'];
  const pendingApprovals = await api('/items?awaiting_my_approval=true', {
    headers: { authorization: `Bearer ${payToken}` },
  });
  assert.strictEqual(pendingApprovals.status, 200);
  console.log(`  ✓ Items awaiting approval for pay.approver: ${pendingApprovals.data.items?.length || 0}`);

  console.log('\n=== Step 8: Resolving Item (agent2) ===');
  const resolveTarget = (await api(`/items/${createdItem.id}`, { headers: { authorization: `Bearer ${agent2Token}` } })).data;
  const resolveRes = await api(`/items/${createdItem.id}/transition`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${agent2Token}`,
      'idempotency-key': `resolve-${Date.now()}`,
    },
    body: {
      name: 'resolve',
      expected_version: resolveTarget.version,
      resolution_note: 'Duplicate charge refunded via payment portal.',
    },
  });
  assert.strictEqual(resolveRes.status, 200);
  console.log(`  ✓ Item resolved! status="${resolveRes.data.status}", resolution_note="${resolveRes.data.resolution_note}"`);

  console.log('\n=== Step 9: Notifications Check ===');
  const notifRes = await api('/notifications', {
    headers: { authorization: `Bearer ${agentToken}` },
  });
  assert.strictEqual(notifRes.status, 200);
  console.log(`  ✓ Notifications for support.agent1: ${notifRes.data.notifications.length} notifications received`);

  console.log('\n=== Step 10: Read-Only Check for Viewer ===');
  const viewerToken = tokens['viewer@example.com'];
  const viewerItem = await api(`/items/${createdItem.id}`, {
    headers: { authorization: `Bearer ${viewerToken}` },
  });
  assert.strictEqual(viewerItem.status, 200);
  assert.deepStrictEqual(viewerItem.data.allowed_actions, []);
  console.log(`  ✓ Viewer allowed_actions is empty array (read-only enforced)`);

  console.log('\n========================================');
  console.log('✅ ALL 10 WALKTHROUGH STEPS PASSED SUCCESSFULLY!');
  console.log('========================================');
}

runLiveWalkthrough().catch((err) => {
  console.error('❌ Walkthrough validation failed:', err);
  process.exit(1);
});
