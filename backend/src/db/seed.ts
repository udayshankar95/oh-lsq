import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

import { query, queryOne, initSchema } from './database';

async function seed() {
  console.log('🌱 Initializing schema...');
  await initSchema();

  console.log('🧹 Clearing existing data...');
  await query(`
    TRUNCATE call_attempts, tasks, orders, leads, agent_sessions,
             agent_group_members, agent_groups, priority_buckets, users
    RESTART IDENTITY CASCADE
  `);

  const hash = (pw: string) => bcrypt.hashSync(pw, 10);

  // ─── Users ──────────────────────────────────────────────────────────────────
  const insertUser = async (name: string, email: string, role: string, city: string, punched: boolean) => {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, city, is_punched_in) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [name, email, hash('password123'), role, city, punched]
    );
    return row!.id;
  };

  const m1 = await insertUser('Priya Nair', 'manager1@oh.in', 'manager', 'Bangalore', false);
  await insertUser('Vikram Sethi', 'manager2@oh.in', 'manager', 'Bangalore', false);
  const a1 = await insertUser('Anjali Rao', 'agent1@oh.in', 'agent', 'Bangalore', true);
  const a2 = await insertUser('Rohit Mehta', 'agent2@oh.in', 'agent', 'Bangalore', true);
  const a3 = await insertUser('Sneha Pillai', 'agent3@oh.in', 'agent', 'Bangalore', true);
  await insertUser('Kiran Bhat', 'agent4@oh.in', 'agent', 'Bangalore', false);
  const a5 = await insertUser('Meena Iyer', 'agent5@oh.in', 'agent', 'Bangalore', true);

  // ─── Agent sessions ──────────────────────────────────────────────────────────
  const addSession = async (agentId: number, offsetHoursIn: number, offsetHoursOut?: number) => {
    const punchedIn = dt(offsetHoursIn);
    if (offsetHoursOut !== undefined) {
      const punchedOut = dt(offsetHoursOut);
      const mins = (new Date(punchedOut).getTime() - new Date(punchedIn).getTime()) / 60000;
      await query(
        `INSERT INTO agent_sessions (agent_id, punched_in_at, punched_out_at, duration_minutes) VALUES ($1,$2,$3,$4)`,
        [agentId, punchedIn, punchedOut, mins]
      );
    } else {
      await query(`INSERT INTO agent_sessions (agent_id, punched_in_at) VALUES ($1,$2)`, [agentId, punchedIn]);
    }
  };

  await addSession(a1, -6, -2);
  await addSession(a1, -1.5);
  await addSession(a2, -3);
  await addSession(a3, -2);
  await addSession(a5, -0.5);

  // ─── Leads ────────────────────────────────────────────────────────────────────
  const leadsData = [
    { req: 'REQ-1001', doc: 'Dr. Arvind Kumar', partner: 'Apollo Clinic', state: 'NEW', attempts: 0, offset: -5 },
    { req: 'REQ-1002', doc: 'Dr. Sunita Reddy', partner: 'Fortis Diagnostics', state: 'NEW', attempts: 0, offset: -3 },
    { req: 'REQ-1003', doc: 'Dr. Mohan Das', partner: 'Manipal Hospital', state: 'NEW', attempts: 0, offset: -1 },
    { req: 'REQ-1004', doc: 'Dr. Kavitha Sharma', partner: 'Columbia Asia', state: 'ATTEMPTING', attempts: 1, offset: -6 },
    { req: 'REQ-1005', doc: 'Dr. Rahul Joshi', partner: 'Narayana Health', state: 'ATTEMPTING', attempts: 2, offset: -8 },
    { req: 'REQ-1006', doc: 'Dr. Lakshmi Nair', partner: 'Sakra Premium', state: 'ATTEMPTING', attempts: 1, offset: -4 },
    { req: 'REQ-1007', doc: 'Dr. Arvind Kumar', partner: 'Apollo Clinic', state: 'ATTEMPTING', attempts: 1, offset: -26 },
    { req: 'REQ-1008', doc: 'Dr. Priya Menon', partner: 'Cloudnine', state: 'CALLBACK_SCHEDULED', attempts: 1, offset: -2 },
    { req: 'REQ-1009', doc: 'Dr. Suresh Babu', partner: 'BGS Gleneagles', state: 'CALLBACK_SCHEDULED', attempts: 1, offset: -5 },
    { req: 'REQ-1010', doc: 'Dr. Anita Singh', partner: 'Aster CMI', state: 'CONNECTED', attempts: 1, offset: -1 },
    { req: 'REQ-1011', doc: 'Dr. Venkat Raman', partner: 'Vikram Hospital', state: 'SCHEDULED', attempts: 1, offset: -4 },
    { req: 'REQ-1012', doc: 'Dr. Sunita Reddy', partner: 'Fortis Diagnostics', state: 'SCHEDULED', attempts: 2, offset: -7 },
    { req: 'REQ-1013', doc: 'Dr. Mohan Das', partner: 'Manipal Hospital', state: 'UNREACHABLE', attempts: 3, offset: -10 },
    { req: 'REQ-1014', doc: 'Dr. Kavitha Sharma', partner: 'Columbia Asia', state: 'CANCELLED', attempts: 1, offset: -9 },
    { req: 'REQ-1015', doc: 'Dr. Rahul Joshi', partner: 'Narayana Health', state: 'NEW', attempts: 0, offset: -0.5 },
    { req: 'REQ-1016', doc: 'Dr. Lakshmi Nair', partner: 'Sakra Premium', state: 'NEW', attempts: 0, offset: -2 },
    { req: 'REQ-1017', doc: 'Dr. Priya Menon', partner: 'Cloudnine', state: 'ATTEMPTING', attempts: 1, offset: -5 },
    { req: 'REQ-1018', doc: 'Dr. Anita Singh', partner: 'Aster CMI', state: 'NEW', attempts: 0, offset: -0.2 },
    { req: 'REQ-1019', doc: 'Dr. Venkat Raman', partner: 'Vikram Hospital', state: 'ATTEMPTING', attempts: 2, offset: -12 },
    { req: 'REQ-1020', doc: 'Dr. Arvind Kumar', partner: 'Apollo Clinic', state: 'CALLBACK_SCHEDULED', attempts: 1, offset: -3 },
  ];

  const prescriptions = ['https://storage.orangehealth.in/rx/sample1.jpg', 'https://storage.orangehealth.in/rx/sample2.jpg', null];
  const ohNotes = ['Patient prefers morning slots', 'Doctor has requested priority processing', null, 'Corporate account — high priority', 'Patient elderly, may need assistance', null];

  const leadIds: number[] = [];
  for (let i = 0; i < leadsData.length; i++) {
    const l = leadsData[i];
    const row = await queryOne<{ id: number }>(
      `INSERT INTO leads (request_id, doctor_name, partner_name, prescription_url, oh_notes, state, attempt_count, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
      [l.req, l.doc, l.partner, prescriptions[i % 3], ohNotes[i % 6], l.state, l.attempts, dt(l.offset)]
    );
    leadIds.push(row!.id);
  }

  // ─── Orders ──────────────────────────────────────────────────────────────────
  const sampleTests = [['CBC','Lipid Profile'],['HbA1c','FBS','PPBS'],['Thyroid Profile T3 T4 TSH'],['CBC','LFT','KFT','Lipid Profile'],['Vitamin D','Vitamin B12'],['CBC','ESR','CRP'],['Complete Blood Count','Urine Routine'],['Dengue NS1 Antigen','CBC'],['Iron Studies','Serum Ferritin'],['HbA1c','Lipid Profile','LFT']];
  const samplePkgs = [[],['Full Body Checkup'],[],['Diabetes Care Package'],['Thyroid Package'],[],[],['Fever Package'],[],['Cardiac Risk Package']];
  const patients = [
    { c:'Rahul Sharma', p:'Rahul Sharma', ph:'9876543210', age:38, g:'Male' },
    { c:'Meena Pillai', p:'Meena Pillai', ph:'9845123456', age:52, g:'Female' },
    { c:'Suresh Kumar', p:'Priya Kumar', ph:'9731234567', age:28, g:'Female' },
    { c:'Anand Raj', p:'Anand Raj', ph:'9901234567', age:45, g:'Male' },
    { c:'Divya Menon', p:'Arun Menon', ph:'9812345678', age:14, g:'Male' },
    { c:'Ravi Shankar', p:'Ravi Shankar', ph:'9823456789', age:61, g:'Male' },
    { c:'Kavitha Reddy', p:'Kavitha Reddy', ph:'9834567890', age:33, g:'Female' },
    { c:'Mohan Lal', p:'Sunita Lal', ph:'9845678901', age:41, g:'Female' },
    { c:'Sita Devi', p:'Sita Devi', ph:'9856789012', age:67, g:'Female' },
    { c:'Arjun Nair', p:'Arjun Nair', ph:'9867890123', age:25, g:'Male' },
    { c:'Lakshmi Iyer', p:'Lakshmi Iyer', ph:'9878901234', age:49, g:'Female' },
    { c:'Venkat Rao', p:'Venkat Rao', ph:'9889012345', age:55, g:'Male' },
    { c:'Priya Singh', p:'Priya Singh', ph:'9890123456', age:30, g:'Female' },
    { c:'Deepak Joshi', p:'Deepak Joshi', ph:'9901234568', age:43, g:'Male' },
    { c:'Usha Bhat', p:'Usha Bhat', ph:'9912345679', age:58, g:'Female' },
    { c:'Rajesh Verma', p:'Rajesh Verma', ph:'9823456780', age:36, g:'Male' },
    { c:'Nirmala Das', p:'Nirmala Das', ph:'9734567891', age:22, g:'Female' },
    { c:'Sunil Mehta', p:'Sunil Mehta', ph:'9845678902', age:47, g:'Male' },
    { c:'Geeta Pillai', p:'Geeta Pillai', ph:'9856789013', age:39, g:'Female' },
    { c:'Ashok Nair', p:'Ashok Nair', ph:'9867890124', age:62, g:'Male' },
  ];
  const slots = [null,'2026-03-19T08:00:00+05:30','2026-03-19T10:00:00+05:30',null,'2026-03-20T07:00:00+05:30',null,'2026-03-19T14:00:00+05:30',null,'2026-03-21T09:00:00+05:30',null,null,'2026-03-19T07:30:00+05:30',null,null,null,'2026-03-22T08:00:00+05:30',null,null,null,null];

  const orderIds: number[] = [];
  for (let i = 0; i < leadsData.length; i++) {
    const p = patients[i];
    const tests = sampleTests[i % sampleTests.length];
    const pkgs = samplePkgs[i % samplePkgs.length];
    const value = tests.length * 350 + pkgs.length * 1200;
    const row = await queryOne<{ id: number }>(
      `INSERT INTO orders (lead_id, oms_order_id, customer_name, patient_name, patient_phone, patient_age, patient_gender, tests, packages, preferred_slot, order_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [leadIds[i], `ORD-${2001+i}`, p.c, p.p, p.ph, p.age, p.g, JSON.stringify(tests), JSON.stringify(pkgs), slots[i], value]
    );
    orderIds.push(row!.id);
  }

  // ─── Tasks ────────────────────────────────────────────────────────────────────
  const addTask = async (leadIdx: number, orderIdx: number, type: string, status: string, agentId: number | null, dueAt: string | null, createdOffset: number) => {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO tasks (lead_id, order_id, type, status, assigned_to, due_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
      [leadIds[leadIdx-1], orderIds[orderIdx-1], type, status, agentId, dueAt, dt(createdOffset)]
    );
    return row!.id;
  };

  // NEW leads → PENDING
  await addTask(1,1,'FIRST_CALL','PENDING',null,null,-5);
  await addTask(2,2,'FIRST_CALL','PENDING',null,null,-3);
  await addTask(3,3,'FIRST_CALL','PENDING',null,null,-1);
  await addTask(15,15,'FIRST_CALL','PENDING',null,null,-0.5);
  await addTask(16,16,'FIRST_CALL','PENDING',null,null,-2);
  await addTask(18,18,'FIRST_CALL','PENDING',null,null,-0.2);

  // ATTEMPTING leads
  await addTask(4,4,'FIRST_CALL','COMPLETED',a1,null,-6);
  const t8 = await addTask(4,4,'RETRY_CALL','ASSIGNED',a1,dt(-5.75),-5.75);
  await addTask(5,5,'FIRST_CALL','COMPLETED',a2,null,-8);
  await addTask(5,5,'RETRY_CALL','COMPLETED',a2,null,-7);
  const t11 = await addTask(5,5,'RETRY_CALL','ASSIGNED',a2,dt(-6),-6);
  await addTask(6,6,'FIRST_CALL','COMPLETED',a3,null,-4);
  const t13 = await addTask(6,6,'RETRY_CALL','ASSIGNED',a3,dt(-3.5),-3.5);
  await addTask(7,7,'FIRST_CALL','COMPLETED',a1,null,-26);
  const t15 = await addTask(7,7,'RETRY_CALL','ASSIGNED',a1,dt(-25),-25);
  await addTask(17,17,'FIRST_CALL','COMPLETED',a5,null,-5);
  const t17 = await addTask(17,17,'RETRY_CALL','ASSIGNED',a5,dt(-4),-4);
  await addTask(19,19,'FIRST_CALL','COMPLETED',a1,null,-12);
  await addTask(19,19,'RETRY_CALL','COMPLETED',a2,null,-11);
  const t20 = await addTask(19,19,'RETRY_CALL','ASSIGNED',a3,dt(-10),-10);

  // CALLBACK_SCHEDULED
  const cbSoon = new Date(Date.now() + 30*60*1000).toISOString();
  const cbLater = new Date(Date.now() + 2*60*60*1000).toISOString();
  const cbOverdue = new Date(Date.now() - 1*60*60*1000).toISOString();

  await addTask(8,8,'FIRST_CALL','COMPLETED',a1,null,-2);
  const cb1 = await addTask(8,8,'CALLBACK','PENDING',null,cbSoon,-1.9);
  await addTask(9,9,'FIRST_CALL','COMPLETED',a2,null,-5);
  const cb2 = await addTask(9,9,'CALLBACK','PENDING',null,cbOverdue,-4.8);
  await addTask(20,20,'FIRST_CALL','COMPLETED',a5,null,-3);
  const cb3 = await addTask(20,20,'CALLBACK','PENDING',null,cbLater,-2.8);

  // CONNECTED/SCHEDULED/etc.
  await addTask(10,10,'FIRST_CALL','COMPLETED',a3,null,-1);
  await addTask(11,11,'FIRST_CALL','COMPLETED',a1,null,-4);
  await addTask(12,12,'FIRST_CALL','COMPLETED',a2,null,-7);
  await addTask(12,12,'RETRY_CALL','COMPLETED',a2,null,-6.5);
  await addTask(13,13,'FIRST_CALL','COMPLETED',a3,null,-10);
  await addTask(13,13,'RETRY_CALL','COMPLETED',a1,null,-9.5);
  await addTask(13,13,'RETRY_CALL','COMPLETED',a2,null,-9);
  await addTask(14,14,'FIRST_CALL','COMPLETED',a3,null,-9);

  // ─── Call Attempts ─────────────────────────────────────────────────────────
  const addAttempt = async (taskId: number, leadIdx: number, agentId: number, outcome: string, notes: string | null, cbTime: string | null, calledAt: string) => {
    await query(
      `INSERT INTO call_attempts (task_id, lead_id, agent_id, outcome, notes, callback_time, called_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [taskId, leadIds[leadIdx-1], agentId, outcome, notes, cbTime, calledAt]
    );
  };

  await addAttempt(t8, 4, a1, 'NO_ANSWER', 'Phone rang, no response', null, dt(-6));
  await addAttempt(t11, 5, a2, 'NO_ANSWER', null, null, dt(-8));
  await addAttempt(t11, 5, a2, 'BUSY', 'Line was busy', null, dt(-7));
  await addAttempt(t13, 6, a3, 'SWITCHED_OFF', null, null, dt(-4));
  await addAttempt(t15, 7, a1, 'NO_ANSWER', 'Patient not picking', null, dt(-26));
  await addAttempt(t17, 17, a5, 'NO_ANSWER', null, null, dt(-5));
  await addAttempt(t20, 19, a1, 'NO_ANSWER', null, null, dt(-12));
  await addAttempt(t20, 19, a2, 'BUSY', null, null, dt(-11));
  await addAttempt(cb1, 8, a1, 'CALL_LATER', 'Patient in meeting, callback in 30 min', cbSoon, dt(-2));
  await addAttempt(cb2, 9, a2, 'CALL_LATER', 'Patient travelling', cbOverdue, dt(-5));
  await addAttempt(cb3, 20, a5, 'CALL_LATER', 'Patient at doctor, callback in 2h', cbLater, dt(-3));

  // ─── Priority Buckets ──────────────────────────────────────────────────────
  const buckets = [
    ['Overdue Callbacks', JSON.stringify({ task_type: ['CALLBACK'], due_before: 'now' }), 1],
    ['Callbacks Due Soon', JSON.stringify({ task_type: ['CALLBACK'], due_before: 'now+2h' }), 2],
    ['Stale New Requests (>4h)', JSON.stringify({ task_type: ['FIRST_CALL'], created_before: 'now-4h' }), 3],
    ['In-Progress Stale (>24h)', JSON.stringify({ lead_state: ['ATTEMPTING'], created_before: 'now-24h' }), 4],
    ['All New Requests', JSON.stringify({ task_type: ['FIRST_CALL'] }), 5],
    ['Retry Calls', JSON.stringify({ task_type: ['RETRY_CALL'] }), 6],
  ];
  for (const [name, conds, order] of buckets) {
    await query(
      `INSERT INTO priority_buckets (name, conditions, display_order, is_active, created_by) VALUES ($1,$2,$3,TRUE,$4)`,
      [name, conds, order, m1]
    );
  }

  // ─── Agent Groups ──────────────────────────────────────────────────────────
  const g1 = await queryOne<{ id: number }>(
    `INSERT INTO agent_groups (name, description, created_by) VALUES ($1,$2,$3) RETURNING id`,
    ['Morning Shift', 'Agents working 7AM-2PM', m1]
  );
  const g2 = await queryOne<{ id: number }>(
    `INSERT INTO agent_groups (name, description, created_by) VALUES ($1,$2,$3) RETURNING id`,
    ['Evening Shift', 'Agents working 2PM-10PM', m1]
  );

  await query(`INSERT INTO agent_group_members (group_id, agent_id) VALUES ($1,$2),($1,$3)`, [g1!.id, a1, a2]);
  await query(`INSERT INTO agent_group_members (group_id, agent_id) VALUES ($1,$2),($1,$3)`, [g2!.id, a3, a5]);

  console.log('✅ Seed complete!');
  console.log('');
  console.log('📋 Login credentials:');
  console.log('  Managers: manager1@oh.in / manager2@oh.in  (password: password123)');
  console.log('  Agents:   agent1@oh.in … agent5@oh.in      (password: password123)');

  process.exit(0);
}

function dt(offsetHours: number): string {
  return new Date(Date.now() + offsetHours * 60 * 60 * 1000).toISOString();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
