// External Live Audit Runner & Rich Data Seeder for Student Panel
// - Keeps all repository source files under server/, client/, agent/ 100% untouched.
// - Phase A: Reproduces and logs backend/client bugs on the unshimmed PGlite instance.
// - Phase B: Applies runtime OID 1082 (date) & 1186 (interval) parsers on PGlite,
//   seeds diverse test values across every module, and serves the app on PORT=3000.

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ||
  'audit_runner_session_secret_64_chars_minimum_for_student_panel_2026';
process.env.SESSION_COOKIE_SECURE = 'false';
process.env.CSRF_CHECK_ORIGIN = 'false';
process.env.NODE_ENV = 'production';
process.env.PORT = process.env.PORT || '3000';

// Allow embedding in the AI Studio preview iframe while keeping all other Helmet CSP headers intact
const origSetHeader = http.ServerResponse.prototype.setHeader;
http.ServerResponse.prototype.setHeader = function patchedSetHeader(name, value) {
  if (
    typeof name === 'string' &&
    name.toLowerCase() === 'content-security-policy' &&
    typeof value === 'string'
  ) {
    value = value.replace(/;?\s*frame-ancestors\s+'none'/gi, '');
  }
  return origSetHeader.call(this, name, value);
};

import fsSync from 'node:fs';
import { execSync } from 'node:child_process';

if (!fsSync.existsSync(path.join(__dirname, 'server/node_modules'))) {
  console.log('[AUDIT] Installing server dependencies...');
  execSync('npm --prefix server install --no-audit --no-fund', { cwd: __dirname, stdio: 'inherit' });
}
if (!fsSync.existsSync(path.join(__dirname, 'client/node_modules'))) {
  console.log('[AUDIT] Installing client dependencies...');
  execSync('npm --prefix client install --no-audit --no-fund', { cwd: __dirname, stdio: 'inherit' });
}
if (!fsSync.existsSync(path.join(__dirname, 'client/dist/index.html'))) {
  console.log('[AUDIT] Building client bundle...');
  execSync('npm --prefix client run build', { cwd: __dirname, stdio: 'inherit' });
}

const { createPglitePool } = await import('./server/src/db/pglite.js');
const { default: pgPool } = await import('./server/src/db/pool.js');
const { hashPassword } = await import('./server/src/lib/passwords.js');
const { locksAtFor } = await import('./server/src/lib/locks.js');
const { assignPeriods, syncAssignmentPeriods, todayIso } = await import('./server/src/lib/periods.js');
const { generateSessions } = await import('./server/src/lib/sessions.js');
const { generateStudentCode, generateTeacherCode } = await import('./server/src/lib/studentCode.js');
const { buildResults } = await import('./server/src/lib/results.js');
const { getRangeReport } = await import('./server/src/lib/cafeReports.js');
const { applyBalanceChange } = await import('./server/src/lib/cafeBalance.js');
const { createSale, voidSale } = await import('./server/src/lib/cafeSale.js');
const { generateOpeningEntry } = await import('./server/src/lib/accountingJournal.js');
const { formatLocaleDate, jalaliTextFromIso } = await import('./client/src/lib/locale.js');
const { periodView } = await import('./client/src/lib/views.js');

const pglitePool = await createPglitePool().ready();

// Redirect the shared server pool to our in-process PGlite pool
pgPool.query = pglitePool.query.bind(pglitePool);
pgPool.connect = pglitePool.connect.bind(pglitePool);
pgPool.end = pglitePool.end.bind(pglitePool);

// Run all 30 migrations
const migrationsDir = path.join(__dirname, 'server/src/db/migrations');
const migrationFiles = (await fs.readdir(migrationsDir))
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of migrationFiles) {
  const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
  await pglitePool.query(sql);
}
console.log(`[AUDIT] Applied ${migrationFiles.length} migrations (001..030).`);

// ============================================================================
// PHASE C: Seed Rich, Diverse Test Data Across Every Module
// ============================================================================
async function seedEverything() {
  const today = todayIso();

  // Look up system role IDs
  const rolesRes = await pglitePool.query(`SELECT id, lower(name) AS name FROM roles`);
  const roleByName = Object.fromEntries(rolesRes.rows.map((r) => [r.name, r.id]));

  // 1. Users across all roles (admin, staff, viewer, kiosk, plus a temp-password user and inactive user)
  const defaultHash = await hashPassword('Admin12345!');

  const adminRes = await pglitePool.query(
    `INSERT INTO users (username, full_name, role_id, password_hash, is_active, must_change_password)
     VALUES ('admin', 'مدیر سیستم (Admin)', $1, $2, true, false)
     RETURNING id`,
    [roleByName.administrator, defaultHash]
  );
  const adminId = adminRes.rows[0].id;

  const staffRes = await pglitePool.query(
    `INSERT INTO users (username, full_name, role_id, password_hash, is_active, must_change_password)
     VALUES ('staff1', 'مریم رضایی (Staff)', $1, $2, true, false)
     RETURNING id`,
    [roleByName.staff, defaultHash]
  );
  const staffId = staffRes.rows[0].id;

  await pglitePool.query(
    `INSERT INTO users (username, full_name, role_id, password_hash, is_active, must_change_password)
     VALUES
       ('viewer1', 'امیر حسینی (Viewer)', $1, $4, true, false),
       ('cafe-kiosk', 'کیوسک صوتی کافه (Kiosk)', $2, $4, true, false),
       ('newteacher', 'کاربر رمز موقت (Temp)', $3, $4, true, true),
       ('formerstaff', 'همکار غیرفعال (Inactive)', $3, $4, false, false)`,
    [roleByName.viewer, roleByName.kiosk, roleByName.staff, defaultHash]
  );

  // 2. Custom Student Field Definitions (choice, date, yes_no, number, restricted text)
  const fInstrument = (
    await pglitePool.query(
      `INSERT INTO student_field_definitions (label, field_type, choices, sort_order, is_restricted, created_by)
       VALUES ('ساز تخصصی / Instrument', 'choice', '["پیانو / Piano","ویولن / Violin","تار / Tar","سنتور / Santoor","گیتار / Guitar","آواز / Vocal"]'::jsonb, 1, false, $1)
       RETURNING id`,
      [adminId]
    )
  ).rows[0].id;

  const fEnrollDate = (
    await pglitePool.query(
      `INSERT INTO student_field_definitions (label, field_type, choices, sort_order, is_restricted, created_by)
       VALUES ('تاریخ ثبت‌نام / Enrollment Date', 'date', '[]'::jsonb, 2, false, $1)
       RETURNING id`,
      [adminId]
    )
  ).rows[0].id;

  const fScholarship = (
    await pglitePool.query(
      `INSERT INTO student_field_definitions (label, field_type, choices, sort_order, is_restricted, created_by)
       VALUES ('بورسیه / Scholarship', 'yes_no', '[]'::jsonb, 3, false, $1)
       RETURNING id`,
      [adminId]
    )
  ).rows[0].id;

  const fPracticeHours = (
    await pglitePool.query(
      `INSERT INTO student_field_definitions (label, field_type, choices, sort_order, is_restricted, created_by)
       VALUES ('ساعت تمرین هفتگی / Weekly Practice', 'number', '[]'::jsonb, 4, false, $1)
       RETURNING id`,
      [adminId]
    )
  ).rows[0].id;

  const fMedicalNote = (
    await pglitePool.query(
      `INSERT INTO student_field_definitions (label, field_type, choices, sort_order, is_restricted, created_by)
       VALUES ('یادداشت محرمانه مشاور / Confidential Note', 'text', '[]'::jsonb, 5, true, $1)
       RETURNING id`,
      [adminId]
    )
  ).rows[0].id;

  // 3. Student Groups (nested hierarchy: Conservatory -> Strings / Piano, plus Traditional)
  const gMain = (
    await pglitePool.query(
      `INSERT INTO student_groups (name, code, parent_id, sort_order, created_by)
       VALUES ('هنرجویان دوره عالی / Advanced Conservatory', 'adv-main', NULL, 10, $1) RETURNING id`,
      [adminId]
    )
  ).rows[0].id;
  const gPiano = (
    await pglitePool.query(
      `INSERT INTO student_groups (name, code, parent_id, sort_order, created_by)
       VALUES ('کارگاه پیانو و هارمونی / Piano & Harmony', 'adv-piano', $1, 20, $2) RETURNING id`,
      [gMain, adminId]
    )
  ).rows[0].id;
  const gStrings = (
    await pglitePool.query(
      `INSERT INTO student_groups (name, code, parent_id, sort_order, created_by)
       VALUES ('گروه سازهای زهی / Strings Ensemble', 'adv-strings', $1, 30, $2) RETURNING id`,
      [gMain, adminId]
    )
  ).rows[0].id;
  const gTraditional = (
    await pglitePool.query(
      `INSERT INTO student_groups (name, code, parent_id, sort_order, created_by)
       VALUES ('گروه موسیقی ایرانی / Persian Traditional', 'trad-ens', NULL, 40, $1) RETURNING id`,
      [adminId]
    )
  ).rows[0].id;

  // 4. Students (12 active students + 1 soft-deleted student with negative cafe balance)
  const studentRows = [
    ['ST23456A', 'سارا احمدی — Sara Ahmadi', 'female', '2003-05-14', 'حمید', '0012345671', 'پیانو / Piano', '2025-09-23', true, 14, 'حساسیت فصلی خفیف', gPiano],
    ['ST23456B', 'امیرعلی فرهادی — Amirali Farhadi', 'male', '2001-08-20', 'مسعود', '0012345672', 'ویولن / Violin', '2025-10-01', false, 18, 'بدون مورد خاص', gStrings],
    ['ST23456C', 'نگار موسوی — Negar Mousavi', 'female', '2006-02-11', 'سیدرضا', '0012345673', 'تار / Tar', '2025-10-15', true, 12, '', gTraditional],
    ['ST23456D', 'کیارش رستمی — Kiarash Rostami', 'male', '2004-11-03', 'بهروز', '0012345674', 'سنتور / Santoor', '2025-11-02', false, 10, '', gTraditional],
    ['ST23456E', 'پریسا صادقی — Parisa Sadeghi', 'female', '2000-07-19', 'محمود', '0012345675', 'پیانو / Piano', '2025-11-12', false, 8, '', gPiano],
    ['ST23456F', 'ماهان کریمی — Mahan Karimi', 'male', '2005-01-29', 'پرویز', '0012345676', 'ویولن / Violin', '2025-12-01', true, 16, 'نیاز به استراحت مچ دست', gStrings],
    ['ST23456G', 'آوا نوری — Ava Nouri', 'female', '2002-09-08', 'فرهاد', '0012345677', 'آواز / Vocal', '2026-01-05', false, 9, '', gPiano],
    ['ST23456H', 'دانیال شریفی — Danial Sharifi', 'male', '2001-03-17', 'کریم', '0012345678', 'گیتار / Guitar', '2026-01-18', false, 11, '', gStrings],
    ['ST23456J', 'روژان کاظمی — Rojan Kazemi', 'female', '2007-04-25', 'ناصر', '0012345679', 'ویولن / Violin', '2026-01-25', true, 15, '', gStrings],
    ['ST23456K', 'آرش بهرامی — Arash Bahrami', 'male', '1999-12-12', 'داریوش', '0012345680', 'تار / Tar', '2026-02-01', false, 13, '', gTraditional],
    ['ST23456L', 'هلیا رحیمی — Helia Rahimi', 'female', '2003-10-05', 'بیژن', '0012345681', 'پیانو / Piano', '2026-02-10', false, 7, '', gPiano],
    ['ST23456M', 'سینا توکلی — Sina Tavakoli', 'male', '2002-06-30', 'جواد', '0012345682', 'سنتور / Santoor', '2026-02-15', true, 14, '', gTraditional],
  ];

  const students = [];
  const membershipsByGroup = { [gPiano]: [], [gStrings]: [], [gTraditional]: [] };

  for (const [code, fullName, gender, birthDate, fatherName, nationalId, inst, enrollDate, schol, hours, note, groupId] of studentRows) {
    const extra = {
      [fInstrument]: inst,
      [fEnrollDate]: enrollDate,
      [fScholarship]: schol,
      [fPracticeHours]: hours,
    };
    if (note) extra[fMedicalNote] = note;

    const stRes = await pglitePool.query(
      `INSERT INTO students (student_code, full_name, gender, birth_date, father_name, national_id, extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, student_code AS "code", full_name AS "fullName"`,
      [code, fullName, gender, birthDate, fatherName, nationalId, JSON.stringify(extra)]
    );
    const st = stRes.rows[0];
    students.push({ ...st, groupId });

    const memRes = await pglitePool.query(
      `INSERT INTO student_group_members (student_id, group_id, added_at)
       VALUES ($1, $2, '2026-01-10T09:00:00Z')
       RETURNING id`,
      [st.id, groupId]
    );
    membershipsByGroup[groupId].push({
      membershipId: memRes.rows[0].id,
      studentId: st.id,
      code: st.code,
      fullName: st.fullName,
    });
  }

  // Also add a PAST membership (with left_on set) so GroupsPage MemberPanel displays past members!
  await pglitePool.query(
    `INSERT INTO student_group_members (student_id, group_id, added_at, left_on)
     VALUES ($1, $2, '2025-10-01T08:00:00Z', '2026-01-05')`,
    [students[0].id, gStrings]
  );

  // Soft-deleted student with negative cafe balance (triggers the soft-deleted debtor bug in getRangeReport & generateOpeningEntry)
  const deletedSt = (
    await pglitePool.query(
      `INSERT INTO students (student_code, full_name, gender, birth_date, national_id, deleted_at)
       VALUES ('ST99999Z', 'فرهاد مرادی (حذف‌شده) — Deleted Student', 'male', '2001-01-01', '0099999999', NOW() - INTERVAL '5 days')
       RETURNING id`
    )
  ).rows[0];

  // 5. Parameters (5 active + 1 archived)
  const paramDefs = [
    ['tech', 'تکنیک و صدادهی / Technique & Tone', 0, 100, 10, true],
    ['rhythm', 'ریتم و زمان‌بندی / Rhythm & Timing', 0, 100, 20, true],
    ['sight', 'دشیفراژ (خوانش) / Sight Reading', 0, 100, 30, true],
    ['expr', 'بیان موسیقایی / Musical Expression', 0, 100, 40, true],
    ['ensemble', 'هم‌نوازی و نظم / Ensemble & Discipline', 0, 20, 50, true],
    ['theory-old', 'تئوری مقدماتی (آرشیو) / Basic Theory', 0, 100, 60, false],
  ];
  const parameters = [];
  for (const [code, name, minVal, maxVal, sortOrder, active] of paramDefs) {
    const pRes = await pglitePool.query(
      `INSERT INTO parameters (code, name, min_value, max_value, sort_order, archived_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, code, name, (archived_at IS NULL) AS "active"`,
      [code, name, minVal, maxVal, sortOrder, active ? null : new Date().toISOString()]
    );
    parameters.push(pRes.rows[0]);
  }
  const activeParams = parameters.filter((p) => p.active);

  // 6. Intervals (already seeded by 018: Weekly, Every 2 weeks, Every 3 days, Monthly)
  const intRows = (await pglitePool.query(`SELECT id, name FROM intervals ORDER BY sort_order`)).rows;
  const intWeekly = intRows.find((r) => r.name === 'Weekly')?.id ?? intRows[0].id;
  const intBiweekly = intRows.find((r) => r.name === 'Every 2 weeks')?.id ?? intRows[1].id;
  const intMonthly = intRows.find((r) => r.name === 'Monthly')?.id ?? intRows[2].id;

  // 7. Teachers
  const t1 = (
    await pglitePool.query(
      `INSERT INTO teachers (code, full_name, birth_date, national_id)
       VALUES ('TC23456A', 'استاد بهرام مشایخی — Prof. Bahram Mashayekhi', '1978-05-14', '0011223341')
       RETURNING id`
    )
  ).rows[0].id;
  const t2 = (
    await pglitePool.query(
      `INSERT INTO teachers (code, full_name, birth_date, national_id)
       VALUES ('TC23456B', 'استاد تهمینه سپهری — Prof. Tahmineh Sepehri', '1984-11-22', '0011223342')
       RETURNING id`
    )
  ).rows[0].id;
  const t3 = (
    await pglitePool.query(
      `INSERT INTO teachers (code, full_name, birth_date, national_id)
       VALUES ('TC23456C', 'استاد سهراب ذوالفقاری — Prof. Sohrab Zolfaghari', '1980-03-30', '0011223343')
       RETURNING id`
    )
  ).rows[0].id;

  function addDaysIso(iso, days) {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  }

  // 8. Assignments (Group & Member-specific) anchored 56 days ago so we have 2+ full periods
  const aPiano = (
    await pglitePool.query(
      `INSERT INTO assignments (code, name, teacher_id, interval_id, group_id, anchor_date, sort_order)
       VALUES ('ASG-PIANO', 'کارگاه هفتگی پیانو و هارمونی / Piano Weekly', $1, $2, $3, $4::date, 10)
       RETURNING id`,
      [t1, intWeekly, gPiano, addDaysIso(today, -56)]
    )
  ).rows[0].id;

  const aStrings = (
    await pglitePool.query(
      `INSERT INTO assignments (code, name, teacher_id, interval_id, group_id, anchor_date, sort_order)
       VALUES ('ASG-STRINGS', 'تمرین گروه سازهای زهی / Strings Weekly', $1, $2, $3, $4::date, 20)
       RETURNING id`,
      [t2, intWeekly, gStrings, addDaysIso(today, -49)]
    )
  ).rows[0].id;

  const aTrad = (
    await pglitePool.query(
      `INSERT INTO assignments (code, name, teacher_id, interval_id, group_id, anchor_date, sort_order)
       VALUES ('ASG-TRAD', 'کارگاه موسیقی ایرانی / Traditional Biweekly', $1, $2, $3, $4::date, 30)
       RETURNING id`,
      [t3, intBiweekly, gTraditional, addDaysIso(today, -70)]
    )
  ).rows[0].id;

  // Individual member assignment for Sara Ahmadi
  const aIndiv = (
    await pglitePool.query(
      `INSERT INTO assignments (code, name, teacher_id, interval_id, membership_id, anchor_date, sort_order)
       VALUES ('ASG-SOLO-01', 'درس خصوصی سارا احمدی / Solo Coaching', $1, $2, $3, $4::date, 40)
       RETURNING id`,
      [t1, intMonthly, membershipsByGroup[gPiano][0].membershipId, addDaysIso(today, -45)]
    )
  ).rows[0].id;

  // Generate sessions up to today + 21 days & materialize periods
  const until = addDaysIso(today, 21);
  const client = await pglitePool.connect();
  try {
    await client.query('BEGIN');
    for (const assignmentId of [aPiano, aStrings, aTrad, aIndiv]) {
      await generateSessions(client, { until, assignmentId });
      await syncAssignmentPeriods(client, assignmentId);
    }
    await client.query('COMMIT');
  } finally {
    client.release();
  }

  // Mark one session of aPiano as moved_to (to demonstrate the movedTo vs movedToDate bug on SessionsPage)
  // and add descriptive notes to past sessions
  const pianoSessions = (
    await pglitePool.query(
      `SELECT id, seq, planned_date AS "plannedDate", session_date AS "sessionDate"
       FROM sessions WHERE assignment_id = $1 ORDER BY seq`,
      [aPiano]
    )
  ).rows;

  if (pianoSessions.length >= 3) {
    const movedDate = addDaysIso(pianoSessions[2].plannedDate, 2);
    await pglitePool.query(
      `UPDATE sessions SET moved_to = $1::date, note = 'جلسه سوم (انتقال یافته به دلیل تعطیلی رسمی)' WHERE id = $2`,
      [movedDate, pianoSessions[2].id]
    );
  }
  if (pianoSessions.length >= 1) {
    await pglitePool.query(
      `UPDATE sessions SET note = 'جلسه اول - بررسی گام‌ها و اتودهای چرنی' WHERE id = $1`,
      [pianoSessions[0].id]
    );
  }
  if (pianoSessions.length >= 2) {
    await pglitePool.query(
      `UPDATE sessions SET note = 'جلسه دوم - تمرین باخ دوصدایی و کنترل ریتم' WHERE id = $1`,
      [pianoSessions[1].id]
    );
  }

  // 9. Evaluations on past sessions across all group assignments
  const allGroupRuns = [
    { assignmentId: aPiano, groupId: gPiano },
    { assignmentId: aStrings, groupId: gStrings },
    { assignmentId: aTrad, groupId: gTraditional },
  ];

  for (const { assignmentId, groupId } of allGroupRuns) {
    const pastSessions = (
      await pglitePool.query(
        `SELECT id, seq, session_date AS "sessionDate"
         FROM sessions
         WHERE assignment_id = $1 AND canceled_at IS NULL AND session_date <= $2::date
         ORDER BY session_date, seq`,
        [assignmentId, today]
      )
    ).rows;

    const members = membershipsByGroup[groupId];
    for (let sIdx = 0; sIdx < pastSessions.length; sIdx++) {
      const sess = pastSessions[sIdx];
      const locksAt = locksAtFor({ sessionDate: sess.sessionDate, today });

      // Whole-group evaluation on parameter 4 (Ensemble & Discipline, range 0..20)
      await pglitePool.query(
        `INSERT INTO evaluations
           (session_id, membership_id, parameter_id, quality_value, quantity_value, quality_comment, quantity_comment, locks_at)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)`,
        [
          sess.id,
          activeParams[4].id,
          15 + (sIdx % 5),
          12 + (sIdx % 6),
          'هماهنگی کلی گروه در این جلسه مطلوب بود',
          'تعداد دفعات تکرار دسته‌جمعی استاندارد',
          locksAt,
        ]
      );

      for (let mIdx = 0; mIdx < members.length; mIdx++) {
        const mem = members[mIdx];
        for (let pIdx = 0; pIdx < 4; pIdx++) {
          const param = activeParams[pIdx];
          // Leave some selected cells unanswered (null) on the newest session so Dashboard Needs Scoring rail shows them
          const isNewestSession = sIdx === pastSessions.length - 1;
          if (isNewestSession && mIdx >= members.length - 2 && pIdx >= 2) {
            await pglitePool.query(
              `INSERT INTO evaluations
                 (session_id, membership_id, parameter_id, quality_value, quantity_value, locks_at)
               VALUES ($1, $2, $3, NULL, NULL, $4)`,
              [sess.id, mem.membershipId, param.id, locksAt]
            );
            continue;
          }

          const baseQual = 64 + ((mIdx * 7 + pIdx * 5 + sIdx * 4) % 33);
          const baseQuant = 55 + ((mIdx * 5 + pIdx * 6 + sIdx * 3) % 40);
          const qualComment =
            pIdx === 0 && sIdx % 2 === 0
              ? 'کنترل انگشت‌گذاری و وضوح جمله‌بندی پیشرفت محسوسی دارد.'
              : null;
          const quantComment =
            pIdx === 1 && sIdx === 2 ? 'تمرین با مترونوم سرعت ۱۱۲ انجام شد.' : null;

          await pglitePool.query(
            `INSERT INTO evaluations
               (session_id, membership_id, parameter_id, quality_value, quantity_value, quality_comment, quantity_comment, locks_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              sess.id,
              mem.membershipId,
              param.id,
              baseQual,
              baseQuant,
              qualComment,
              quantComment,
              locksAt,
            ]
          );
        }
      }
    }
  }

  // 10. Task Templates & Tasks
  const tt1 = (
    await pglitePool.query(
      `INSERT INTO task_templates (title, description, parameter_id, sort_order)
       VALUES ('تمرین گام‌های ماژور و مینور با مترونوم', 'سرعت پایه ۹۶، دو اکتاو دست‌جمع', $1, 10)
       RETURNING id`,
      [activeParams[0].id]
    )
  ).rows[0].id;
  const tt2 = (
    await pglitePool.query(
      `INSERT INTO task_templates (title, description, parameter_id, sort_order)
       VALUES ('اتودهای ریتمیک و دشیفراژ روزانه', 'خوانش بدون توقف در میزان‌های ترکیبی ۶/۸', $1, 20)
       RETURNING id`,
      [activeParams[2].id]
    )
  ).rows[0].id;

  if (pianoSessions.length >= 2) {
    await pglitePool.query(
      `INSERT INTO tasks (session_id, template_id, parameter_id, membership_id, title, description, done, done_at, sort_order)
       VALUES
         ($1, $3, $5, $7, 'تمرین گام‌های ماژور و مینور با مترونوم', 'کامل و دقیق اجرا شد', true, NOW() - INTERVAL '3 days', 10),
         ($1, $4, $6, $8, 'اتودهای ریتمیک و دشیفراژ روزانه', 'نیاز به تمرین بیشتر در میزان ۶/۸', false, NULL, 20),
         ($2, $3, $5, NULL, 'تمرین گروهی گام دو ماژور', 'تمرین ابتدای جلسه', false, NULL, 10)`,
      [
        pianoSessions[0].id,
        pianoSessions[1].id,
        tt1,
        tt2,
        activeParams[0].id,
        activeParams[2].id,
        membershipsByGroup[gPiano][0].membershipId,
        membershipsByGroup[gPiano][1].membershipId,
      ]
    );
  }

  // 11. Session Alerts (open + resolved)
  if (pianoSessions.length >= 5) {
    await pglitePool.query(
      `INSERT INTO alerts (kind, session_id, message, resolved_at)
       VALUES
         ('session_unconfirmed', $1, 'جلسه برگزار شده اما یادداشت یا تکلیف پایانی ثبت نشده است.', NULL),
         ('session_unconfirmed', $2, 'تأیید و ثبت شده توسط آموزش.', NOW() - INTERVAL '2 days')`,
      [pianoSessions[4].id, pianoSessions[0].id]
    );
  }

  // 12. Cafe Catalog (Products, Suppliers, Purchases, Inventory Movements, Balances, Sales)
  const prodDefs = [
    ['اسپرسو دبل / Double Espresso', 65000, true, 10, 25000],
    ['کاپوچینو / Cappuccino', 85000, true, 20, 32000],
    ['چای زعفرانی / Saffron Tea', 45000, true, 30, 15000],
    ['آیس لاته / Iced Latte', 95000, true, 40, 38000],
    ['کیک شکلاتی روز / Chocolate Cake', 110000, true, 50, 52000],
    ['کروسان کره‌ای / Butter Croissant', 75000, true, 60, 35000],
    ['دمنوش بهارنارنج (فصلی) / Orange Blossom', 55000, false, 70, 20000],
  ];

  const products = [];
  for (const [name, price, isActive, sortOrder, avgCost] of prodDefs) {
    const pRes = await pglitePool.query(
      `INSERT INTO cafe_products (name, price, is_active, sort_order, avg_cost)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, price`,
      [name, price, isActive, sortOrder, avgCost]
    );
    products.push(pRes.rows[0]);
  }

  const sup1 = (
    await pglitePool.query(
      `INSERT INTO cafe_suppliers (name, phone, note, is_active)
       VALUES ('برشته‌کاری قهوه روستر تهران / Tehran Roasters', '021-88776655', 'تأمین دانه قهوه عربیکا و شیر روزانه', true)
       RETURNING id`
    )
  ).rows[0].id;
  const sup2 = (
    await pglitePool.query(
      `INSERT INTO cafe_suppliers (name, phone, note, is_active)
       VALUES ('قنادی و نان فرانسوی لوف / Loaf Bakery', '021-22334455', 'تحویل کیک و کروسان هر روز ساعت ۸ صبح', true)
       RETURNING id`
    )
  ).rows[0].id;

  // Record 2 purchases + stock movements
  const pur1 = (
    await pglitePool.query(
      `INSERT INTO cafe_purchases (supplier_id, purchased_at, note, created_by)
       VALUES ($1, '2026-04-01', 'INV-1405-01 — خرید اولیه قهوه و چای هفته اول فروردین', $2)
       RETURNING id`,
      [sup1, adminId]
    )
  ).rows[0].id;

  const purItems = [
    [products[0].id, 50, 25000],
    [products[1].id, 40, 32000],
    [products[2].id, 48, 15000],
  ];
  for (const [prodId, qty, unitCost] of purItems) {
    await pglitePool.query(
      `INSERT INTO cafe_purchase_items (purchase_id, product_id, qty, unit_cost)
       VALUES ($1, $2, $3, $4)`,
      [pur1, prodId, qty, unitCost]
    );
    await pglitePool.query(
      `INSERT INTO cafe_stock_movements (product_id, kind, qty, unit_cost, reference_type, reference_id, note, created_by)
       VALUES ($1, 'purchase', $2, $3, 'purchase', $4, 'INV-1405-01', $5)`,
      [prodId, qty, unitCost, pur1, adminId]
    );
  }

  const pur2 = (
    await pglitePool.query(
      `INSERT INTO cafe_purchases (supplier_id, purchased_at, note, created_by)
       VALUES ($1, '2026-04-03', 'INV-1405-02 — خرید کیک شکلاتی، کروسان و آیس‌لاته', $2)
       RETURNING id`,
      [sup2, adminId]
    )
  ).rows[0].id;

  const pur2Items = [
    [products[3].id, 15, 38000],
    [products[4].id, 8, 52000],
    [products[5].id, 4, 35000],
  ];
  for (const [prodId, qty, unitCost] of pur2Items) {
    await pglitePool.query(
      `INSERT INTO cafe_purchase_items (purchase_id, product_id, qty, unit_cost)
       VALUES ($1, $2, $3, $4)`,
      [pur2, prodId, qty, unitCost]
    );
    await pglitePool.query(
      `INSERT INTO cafe_stock_movements (product_id, kind, qty, unit_cost, reference_type, reference_id, note, created_by)
       VALUES ($1, 'purchase', $2, $3, 'purchase', $4, 'INV-1405-02', $5)`,
      [prodId, qty, unitCost, pur2, adminId]
    );
  }

  // Record a Waste movement and an Adjustment movement so Inventory page shows all movement types
  await pglitePool.query(
    `INSERT INTO cafe_stock_movements (product_id, kind, qty, unit_cost, note, created_by)
     VALUES
       ($1, 'waste', -1, 52000, 'آسیب دیدن یک برش کیک در یخچال', $3),
       ($2, 'adjustment', 2, 15000, 'اصلاح شمارش انبارگردانی پایان هفته', $3)`,
    [products[4].id, products[2].id, staffId]
  );

  // Student Cafe Balances & Sales using the real domain functions inside a transaction
  const saleClient = await pglitePool.connect();
  try {
    await saleClient.query('BEGIN');

    // Top-up Sara Ahmadi (+500,000) and Amirali Farhadi (+300,000)
    await applyBalanceChange(saleClient, {
      studentId: students[0].id,
      delta: 500000,
      kind: 'topup',
      note: 'شارژ حساب ماه فروردین (نقدی)',
      createdBy: adminId,
    });
    await applyBalanceChange(saleClient, {
      studentId: students[1].id,
      delta: 300000,
      kind: 'topup',
      note: 'شارژ کیف پول کافه',
      createdBy: adminId,
    });
    // Negative balance (overdraft) for Negar Mousavi (-120,000)
    await applyBalanceChange(saleClient, {
      studentId: students[2].id,
      delta: -120000,
      kind: 'adjustment',
      note: 'بدهی انتقالی از ماه قبل',
      createdBy: adminId,
    });
    // Negative balance for soft-deleted student (-85,000) to demonstrate the soft-deleted debtor bug
    await applyBalanceChange(saleClient, {
      studentId: deletedSt.id,
      delta: -85000,
      kind: 'adjustment',
      note: 'بدهی دانش‌آموز حذف‌شده (تست گزارش بدهکاران)',
      createdBy: adminId,
    });

    // Sale 1: Student sale (Sara Ahmadi)
    await createSale(saleClient, {
      user: { id: staffId, username: 'staff1' },
      customer: 'student',
      studentId: students[0].id,
      items: [
        { productId: products[0].id, qty: 2 },
        { productId: products[4].id, qty: 1 },
      ],
      note: 'سفارش بین کلاس پیانو',
    });

    // Sale 2: Walk-in cash sale
    await createSale(saleClient, {
      user: { id: staffId, username: 'staff1' },
      customer: 'walk_in',
      items: [
        { productId: products[1].id, qty: 2 },
        { productId: products[2].id, qty: 3 },
      ],
      note: 'مهمان جلسه اجرا',
    });

    // Sale 3: Voice kiosk sale (note starts with 'voice:') so AgentPage shows voice sales too!
    await createSale(saleClient, {
      user: { id: adminId, username: 'admin' },
      customer: 'student',
      studentId: students[1].id,
      items: [{ productId: products[3].id, qty: 1 }],
      note: 'voice: stage-3',
    });

    // Sale 4: A sale that gets voided so POS & Accounting Journal show a voided sale + voided journal entry
    const s4 = await createSale(saleClient, {
      user: { id: staffId, username: 'staff1' },
      customer: 'walk_in',
      items: [{ productId: products[5].id, qty: 1 }],
      note: 'ثبت اشتباه - ابطال شد',
    });
    await voidSale(saleClient, {
      user: { id: adminId, username: 'admin' },
      saleId: s4.saleId,
    });

    await saleClient.query('COMMIT');
  } finally {
    saleClient.release();
  }

  // 13. Voice Agent Transcripts (so AgentPage & AgentTranscriptsPage have realistic bilingual sessions)
  await pglitePool.query(
    `INSERT INTO voice_transcripts (session_id, role, text, meta, audio_kept, created_at)
     VALUES
       ('sess-kiosk-101', 'agent', 'سلام! سفارش کافه رو بفرمایید.', '{"lang":"fa"}'::jsonb, false, NOW() - INTERVAL '40 minutes'),
       ('sess-kiosk-101', 'user', 'یک آیس لاته به حساب امیرعلی فرهادی', '{"lang":"fa"}'::jsonb, false, NOW() - INTERVAL '39 minutes'),
       ('sess-kiosk-101', 'agent', 'یک آیس لاته اضافه شد به حساب امیرعلی فرهادی، جمع ۹۵٬۰۰۰ تومان. ثبت بشه؟', '{"lang":"fa"}'::jsonb, false, NOW() - INTERVAL '39 minutes'),
       ('sess-kiosk-101', 'user', 'بله ثبت کن', '{"lang":"fa"}'::jsonb, false, NOW() - INTERVAL '38 minutes'),
       ('sess-kiosk-101', 'agent', 'ثبت شد. جمع ۹۵٬۰۰۰ تومان، مانده حساب ۲۰۵٬۰۰۰ تومان.', '{"lang":"fa"}'::jsonb, false, NOW() - INTERVAL '38 minutes'),
       ('sess-kiosk-102', 'user', 'What is on the menu today?', '{"lang":"en"}'::jsonb, false, NOW() - INTERVAL '15 minutes'),
       ('sess-kiosk-102', 'agent', 'Menu: Double Espresso 65,000, Cappuccino 85,000, Saffron Tea 45,000, Iced Latte 95,000, Chocolate Cake 110,000.', '{"lang":"en"}'::jsonb, false, NOW() - INTERVAL '15 minutes')`
  );

  // 14. Accounting: add an open current period (1405), a closed historical period (1404), a posted manual entry, and a draft manual entry
  await pglitePool.query(
    `INSERT INTO acct_fiscal_periods (name, start_date, end_date, status)
     VALUES ('1405 (سال مالی جاری)', '2026-03-21', '2027-03-20', 'open')`
  );
  await pglitePool.query(
    `INSERT INTO acct_fiscal_periods (name, start_date, end_date, status, closed_at, closed_by)
     VALUES ('1404 (سال مالی گذشته)', '2025-03-21', '2026-03-20', 'closed', NOW() - INTERVAL '20 days', $1)`,
    [adminId]
  );

  const cashAcct = (await pglitePool.query(`SELECT id FROM acct_accounts WHERE code = '1100'`)).rows[0].id;
  const bankAcct = (await pglitePool.query(`SELECT id FROM acct_accounts WHERE code = '1110'`)).rows[0].id;
  const equityAcct = (await pglitePool.query(`SELECT id FROM acct_accounts WHERE code = '3000'`)).rows[0].id;

  const acctClient = await pglitePool.connect();
  try {
    await acctClient.query('BEGIN');
    // Draft entry first, then post it so the deferred balance trigger and lifecycle trigger run cleanly
    const jePosted = (
      await acctClient.query(
        `INSERT INTO acct_journal_entries (entry_date, status, source_type, memo, created_by)
         VALUES ('2026-03-25', 'draft', 'manual', 'واریز سرمایه اولیه صندوق و بانک هنرستان', $1)
         RETURNING id, entry_no`,
        [adminId]
      )
    ).rows[0];
    await acctClient.query(
      `INSERT INTO acct_journal_lines (entry_id, account_id, debit, credit, memo)
       VALUES
         ($1, $2, 15000000, 0, 'موجودی نقد صندوق کافه'),
         ($1, $3, 35000000, 0, 'موجودی حساب جاری بانک'),
         ($1, $4, 0, 50000000, 'سرمایه اولیه دوره ۱۴۰۵')`,
      [jePosted.id, cashAcct, bankAcct, equityAcct]
    );
    await acctClient.query(
      `UPDATE acct_journal_entries SET status = 'posted', posted_by = $2, posted_at = NOW() - INTERVAL '10 days' WHERE id = $1`,
      [jePosted.id, adminId]
    );

    // Draft manual entry (editable / postable in AccountingJournalPage)
    const jeDraft = (
      await acctClient.query(
        `INSERT INTO acct_journal_entries (entry_date, status, source_type, memo, created_by)
         VALUES ('2026-04-12', 'draft', 'manual', 'انتقال وجه از صندوق به بانک (پیش‌نویس جهت بررسی)', $1)
         RETURNING id`,
        [adminId]
      )
    ).rows[0];
    await acctClient.query(
      `INSERT INTO acct_journal_lines (entry_id, account_id, debit, credit, memo)
       VALUES
         ($1, $2, 2000000, 0, 'واریز به بانک'),
         ($1, $3, 0, 2000000, 'برداشت از صندوق')`,
      [jeDraft.id, bankAcct, cashAcct]
    );
    await acctClient.query('COMMIT');
  } finally {
    acctClient.release();
  }

  // 15. Audit Log entries across categories (including cafe_waste and accounting_entry to demonstrate the category filter bug)
  await pglitePool.query(
    `INSERT INTO audit_log (user_id, actor, action, entity_type, entity_id, details)
     VALUES
       ($1::uuid, 'admin', 'auth.login', 'user', $1::text, '{"username":"admin"}'::jsonb),
       ($1::uuid, 'admin', 'student.create', 'student', $3::text, '{"code":"ST23456A","fullName":"سارا احمدی"}'::jsonb),
       ($2::uuid, 'staff1', 'evaluation.save', 'session', $4::text, '{"saved":20}'::jsonb),
       ($2::uuid, 'staff1', 'cafe_waste.create', 'cafe_stock_movement', 'waste-1', '{"productName":"کیک شکلاتی روز","qty":1}'::jsonb),
       ($1::uuid, 'admin', 'accounting_entry.post', 'acct_journal_entry', '1000', '{"entryNo":1000}'::jsonb)`,
    [adminId, staffId, students[0].id, pianoSessions[0].id]
  );

  console.log('[AUDIT] Seeded complete bilingual dataset across all modules.');
  console.log('[AUDIT] Login credentials for preview: username = admin | password = Admin12345!');
}

await seedEverything();

// Finally, import server/src/index.js which mounts Express and starts listening on PORT=3000
await import('./server/src/index.js');
